// =============================================================================
//  GEMINI ARCHITECT — Module C: Planetary Studio
//  Body file editor: render data, POI list, 3D sphere preview with pin dropper
// =============================================================================

const PlanetaryStudio = (() => {

    // ── State ──────────────────────────────────────────────────────────────────
    let bodyData    = null;
    let activeFile  = null;
    let selectedPOI = null;  // index into bodyData.pois
    let isAddingPOI = false;
    let currentSystemData = null;  // loaded system JSON for system→body flow

    // ── Three.js 3D state ──────────────────────────────────────────────────────
    let renderer = null, scene = null, camera = null;
    let sphereMesh = null, atmoMesh = null;
    let poiGroup = null;            // THREE.Group for POI marker meshes
    let threeAnimId = null;
    let autoRotateSpeed = 0.002;    // radians / frame

    // Orbit control state
    const orbit = { phi: Math.PI * 0.4, theta: 0, dist: 3.2 };
    let orbDrag = false, orbPrev = { x: 0, y: 0 };

    // Texture loader
    const texLoader = typeof THREE !== 'undefined' ? new THREE.TextureLoader() : null;
    let loadedDiffuse = null; // THREE.Texture
    let loadedBump    = null;

    // ── DOM refs ───────────────────────────────────────────────────────────────
    const els = {};

    function cacheEls() {
        ['ps-system-select','ps-body-select','ps-new-body','ps-save-body','ps-delete-body',
         'ps-render-editor','ps-tex-diffuse','ps-tex-bump','ps-atmo-color',
         'ps-atmo-picker','ps-rot-speed','ps-render-apply',
         'ps-poi-editor','ps-poi-id','ps-poi-name','ps-poi-type',
         'ps-poi-desc','ps-poi-link','ps-poi-lat','ps-poi-lon',
         'ps-poi-apply','ps-poi-delete',
         'ps-placeholder','ps-body-container',
         'ps-poi-list','ps-add-poi','ps-canvas',
        ].forEach(id => { els[id] = document.getElementById(id); });
    }

    // ── System list (new flow: system → body selection) ───────────────────────
    async function refreshSystemList() {
        const sel = els['ps-system-select'];
        sel.innerHTML = '<option value="">— select system —</option>';
        try {
            const files = await API.listDir('data/systems');
            files.filter(f => !f.isDir && f.name.endsWith('.json')).forEach(f => {
                const opt = document.createElement('option');
                opt.value = `data/systems/${f.name}`;
                opt.textContent = f.name.replace('.json', '');
                sel.appendChild(opt);
            });
        } catch (e) {
            // No systems yet — that's OK
        }
    }

    async function loadSystem(rel) {
        try {
            currentSystemData = await API.getFile(rel);
            populateBodyListFromSystem(currentSystemData);
        } catch (e) {
            notify(`Failed to load system: ${e.message}`, 'error');
        }
    }

    function populateBodyListFromSystem(sysData) {
        const sel = els['ps-body-select'];
        sel.innerHTML = '<option value="">— select body —</option>';
        const orbitals = (sysData.orbitals || [])
            .filter(o => o.file && o.type !== 'Asteroid Belt' && o.type !== 'Companion Star')
            .sort((a, b) => (a.orbit_index || 0) - (b.orbit_index || 0));
        for (const orb of orbitals) {
            const opt = document.createElement('option');
            opt.value = orb.file;
            opt.textContent = orb.name || orb.id;
            sel.appendChild(opt);
        }
        if (activeFile) sel.value = activeFile;
    }

    // ── File list (fallback: list all bodies directly) ─────────────────────────
    async function refreshBodyList() {
        const sel = els['ps-body-select'];
        sel.innerHTML = '<option value="">— select body —</option>';
        try {
            const files = await API.listDir('data/bodies');
            files.filter(f => !f.isDir && f.name.endsWith('.json')).forEach(f => {
                const opt = document.createElement('option');
                opt.value = `data/bodies/${f.name}`;
                opt.textContent = f.name.replace('.json', '');
                sel.appendChild(opt);
            });
            if (activeFile) sel.value = activeFile;
        } catch (e) {
            notify(`Could not list bodies: ${e.message}`, 'error');
        }
    }

    async function loadBodyFile(rel) {
        try {
            bodyData   = await API.getFile(rel);
            activeFile = rel;
            if (!bodyData.pois)        bodyData.pois = [];
            if (!bodyData.render_data) bodyData.render_data = {
                texture_diffuse:  '',
                texture_bump:     '',
                texture_specular: '',
                atmosphere_color: '#88aaff',
                rotation_speed:   0.005,
            };
            populateRenderEditor();
            loadTexture3D(
                bodyData.render_data.texture_diffuse,
                bodyData.render_data.texture_bump,
                bodyData.render_data.texture_specular,
                bodyData.render_data.texture_emissive
            );
            updateAtmosphere();
            renderPOIList();
            updatePOIMarkers();
            els['ps-placeholder'].style.display    = 'none';
            els['ps-body-container'].style.display  = 'flex';
            setStatus(`Body loaded: ${bodyData.id}`, rel);
        } catch (e) {
            notify(`Failed to load body: ${e.message}`, 'error');
        }
    }

    // ── Render editor ──────────────────────────────────────────────────────────
    function populateRenderEditor() {
        const r = bodyData.render_data;
        els['ps-tex-diffuse'].value  = r.texture_diffuse  || '';
        els['ps-tex-bump'].value     = r.texture_bump     || '';
        els['ps-atmo-color'].value   = r.atmosphere_color || '#88aaff';
        els['ps-rot-speed'].value    = r.rotation_speed   ?? 0.005;
        try { els['ps-atmo-picker'].value = r.atmosphere_color || '#88aaff'; } catch(_) {}
        els['ps-render-editor'].style.display = '';
    }

    function applyRenderEdit() {
        bodyData.render_data.texture_diffuse  = els['ps-tex-diffuse'].value.trim();
        bodyData.render_data.texture_bump     = els['ps-tex-bump'].value.trim();
        bodyData.render_data.atmosphere_color = els['ps-atmo-color'].value.trim();
        bodyData.render_data.rotation_speed   = parseFloat(els['ps-rot-speed'].value) || 0.005;
        loadTexture3D(
            bodyData.render_data.texture_diffuse,
            bodyData.render_data.texture_bump,
            bodyData.render_data.texture_specular,
            bodyData.render_data.texture_emissive
        );
        updateAtmosphere();
        updatePOIMarkers();
        notify('Render data updated.', 'success');
    }

    // ── Three.js 3D Scene ──────────────────────────────────────────────────────
    function init3DScene() {
        if (typeof THREE === 'undefined') return;
        const container = document.getElementById('ps-sphere-preview');
        const width = 320, height = 320;

        renderer = new THREE.WebGLRenderer({ antialias: true });
        renderer.setSize(width, height);
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setClearColor(0x000000);

        // Replace old canvas
        const oldCanvas = els['ps-canvas'];
        if (oldCanvas && oldCanvas.parentNode) {
            oldCanvas.parentNode.insertBefore(renderer.domElement, oldCanvas);
            oldCanvas.style.display = 'none';
        }
        renderer.domElement.id = 'ps-3d-canvas';
        renderer.domElement.style.cursor = 'grab';

        scene  = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
        updateCamera();

        // Lights
        scene.add(new THREE.AmbientLight(0x444444));
        const sun = new THREE.DirectionalLight(0xffffff, 1.4);
        sun.position.set(5, 3, 5);
        scene.add(sun);

        // Planet sphere
        const geo = new THREE.SphereGeometry(1, 64, 64);
        const mat = new THREE.MeshPhongMaterial({ color: 0x888888 });
        sphereMesh = new THREE.Mesh(geo, mat);
        scene.add(sphereMesh);

        // Atmosphere shell (slightly larger, transparent)
        const atmoGeo = new THREE.SphereGeometry(1.04, 48, 48);
        const atmoMat = new THREE.MeshPhongMaterial({
            color: 0x88aaff, transparent: true, opacity: 0.12,
            side: THREE.FrontSide, depthWrite: false,
        });
        atmoMesh = new THREE.Mesh(atmoGeo, atmoMat);
        scene.add(atmoMesh);

        // POI marker group
        poiGroup = new THREE.Group();
        scene.add(poiGroup);

        // Manual orbit controls
        setupOrbitControl(renderer.domElement);

        // Start animation loop
        animate3D();
    }

    function updateCamera() {
        if (!camera) return;
        const sp = Math.sin(orbit.phi);
        camera.position.set(
            orbit.dist * sp * Math.sin(orbit.theta),
            orbit.dist * Math.cos(orbit.phi),
            orbit.dist * sp * Math.cos(orbit.theta)
        );
        camera.lookAt(0, 0, 0);
    }

    function setupOrbitControl(el) {
        let dragDist = 0;
        el.addEventListener('mousedown', e => {
            if (isAddingPOI) {
                // In POI placement mode we don't orbit, but we still reset drag
                // state so click-to-place is never blocked by a previous drag.
                dragDist = 0;
                return;
            }
            orbDrag = true;
            dragDist = 0;
            orbPrev = { x: e.clientX, y: e.clientY };
            el.style.cursor = 'grabbing';
        });
        el.addEventListener('mousemove', e => {
            if (!orbDrag) return;
            const dx = e.clientX - orbPrev.x;
            const dy = e.clientY - orbPrev.y;
            dragDist += Math.abs(dx) + Math.abs(dy);
            orbit.theta -= dx * 0.005;
            orbit.phi   -= dy * 0.005;
            orbit.phi    = Math.max(0.1, Math.min(Math.PI - 0.1, orbit.phi));
            orbPrev = { x: e.clientX, y: e.clientY };
            updateCamera();
        });
        const endDrag = () => { orbDrag = false; el.style.cursor = isAddingPOI ? 'crosshair' : 'grab'; };
        window.addEventListener('mouseup', endDrag);
        el.addEventListener('wheel', e => {
            e.preventDefault();
            orbit.dist = Math.max(1.5, Math.min(8, orbit.dist + e.deltaY * 0.005));
            updateCamera();
        }, { passive: false });

        // Click for POI placement / selection (only if not a drag)
        el.addEventListener('click', e => {
            if (!isAddingPOI && dragDist > 5) return; // was a drag, not a click
            handle3DClick(e);
        });
    }

    function handle3DClick(e) {
        if (orbDrag) return; // was dragging
        if (!renderer || !camera || !sphereMesh) return;

        const rect = renderer.domElement.getBoundingClientRect();
        const mouse = new THREE.Vector2(
            ((e.clientX - rect.left) / rect.width) * 2 - 1,
            -((e.clientY - rect.top) / rect.height) * 2 + 1
        );

        const raycaster = new THREE.Raycaster();
        raycaster.setFromCamera(mouse, camera);
        const intersects = raycaster.intersectObject(sphereMesh);

        if (isAddingPOI && intersects.length > 0) {
            const point = intersects[0].point;
            // Convert world point to lat/lon (sphere is centered at origin, radius 1)
            const lat = Math.asin(Math.max(-1, Math.min(1, point.y))) * 180 / Math.PI;
            const lon = Math.atan2(point.x, point.z) * 180 / Math.PI;
            placePOIAt(parseFloat(lat.toFixed(2)), parseFloat(lon.toFixed(2)));
        } else {
            // Try to select nearest POI via raycasting on markers
            if (poiGroup && poiGroup.children.length > 0) {
                const poiHits = raycaster.intersectObjects(poiGroup.children, false);
                if (poiHits.length > 0) {
                    const idx = poiHits[0].object.userData.poiIdx;
                    if (idx !== undefined) { selectPOI(idx); return; }
                }
            }
            // Click on sphere surface but no POI
            if (intersects.length > 0) {
                selectedPOI = null;
                els['ps-poi-editor'].style.display = 'none';
                renderPOIList();
                updatePOIMarkers();
            }
        }
    }

    function placePOIAt(lat, lon) {
        if (!bodyData) {
            notify('Load a body before adding POIs.', 'warning');
            isAddingPOI = false;
            if (renderer?.domElement) renderer.domElement.style.cursor = 'grab';
            return;
        }
        const id = `loc_${Date.now()}`;
        bodyData.pois.push({
            id,
            name:           'New POI',
            type:           'Settlement',
            coordinates_3d: { lat, lon },
            description:    '',
            link_to_map:    `data/locations/${id}.json`,
        });
        isAddingPOI = false;
        document.getElementById('ps-sphere-hint').textContent = 'Click on the sphere to pin a POI';
        if (renderer?.domElement) renderer.domElement.style.cursor = 'grab';
        selectedPOI = bodyData.pois.length - 1;
        els['ps-poi-editor'].style.display = '';
        renderPOIList();
        updatePOIMarkers();
        selectPOI(selectedPOI);
        notify('POI placed. Edit its properties in the sidebar.', 'info');
    }

    function animate3D() {
        threeAnimId = requestAnimationFrame(animate3D);
        if (!renderer || !scene || !camera) return;
        renderer.render(scene, camera);
    }

    // ── 3D Texture loader ──────────────────────────────────────────────────────
    function loadTexture3D(diffusePath, bumpPath, specPath, emissivePath) {
        if (!texLoader || !sphereMesh) return;

        const mat = sphereMesh.material;

        // Diffuse
        if (diffusePath) {
            const url = `/campaign-assets/${diffusePath.replace(/^\//, '')}`;
            texLoader.load(url, tex => {
                mat.map = tex;
                mat.color.set(0xffffff);
                mat.needsUpdate = true;
            }, undefined, () => {
                mat.map = null;
                mat.color.set(0x888888);
                mat.needsUpdate = true;
            });
        } else {
            mat.map = null;
            mat.color.set(0x888888);
            mat.needsUpdate = true;
        }

        // Bump map
        if (bumpPath) {
            const bUrl = `/campaign-assets/${bumpPath.replace(/^\//, '')}`;
            texLoader.load(bUrl, tex => {
                mat.bumpMap = tex;
                mat.bumpScale = 0.04;
                mat.needsUpdate = true;
            });
        } else {
            mat.bumpMap = null;
            mat.needsUpdate = true;
        }

        // Specular map
        if (specPath) {
            const sUrl = `/campaign-assets/${specPath.replace(/^\//, '')}`;
            texLoader.load(sUrl, tex => {
                mat.specularMap = tex;
                mat.specular = new THREE.Color(0x333333);
                mat.needsUpdate = true;
            });
        } else {
            mat.specularMap = null;
            mat.needsUpdate = true;
        }

        // Emissive map (e.g. city lights, lava glow)
        if (emissivePath) {
            const eUrl = `/campaign-assets/${emissivePath.replace(/^\//, '')}`;
            texLoader.load(eUrl, tex => {
                mat.emissiveMap = tex;
                mat.emissive = new THREE.Color(0xffffff);
                mat.emissiveIntensity = 0.6;
                mat.needsUpdate = true;
            });
        } else {
            mat.emissiveMap = null;
            mat.emissive = new THREE.Color(0x000000);
            mat.needsUpdate = true;
        }
    }

    function updateAtmosphere() {
        if (!atmoMesh || !bodyData) return;
        const hex = bodyData.render_data?.atmosphere_color || '#88aaff';
        atmoMesh.material.color.set(hex);
    }

    function updatePOIMarkers() {
        if (!poiGroup) return;
        // Clear old markers
        while (poiGroup.children.length) poiGroup.remove(poiGroup.children[0]);

        (bodyData?.pois || []).forEach((poi, i) => {
            const lat = (poi.coordinates_3d?.lat ?? 0) * Math.PI / 180;
            const lon = (poi.coordinates_3d?.lon ?? 0) * Math.PI / 180;
            // Spherical to Cartesian (Y-up, radius slightly above surface)
            const sr = 1.02;
            const y  = sr * Math.sin(lat);
            const xz = sr * Math.cos(lat);
            const x  = xz * Math.sin(lon);
            const z  = xz * Math.cos(lon);

            const isSel = i === selectedPOI;
            const geo   = new THREE.SphereGeometry(isSel ? 0.04 : 0.03, 8, 8);
            const mat   = new THREE.MeshBasicMaterial({ color: isSel ? 0xffd700 : 0xff6633 });
            const marker = new THREE.Mesh(geo, mat);
            marker.position.set(x, y, z);
            marker.userData.poiIdx = i;
            poiGroup.add(marker);
        });
        // Reset rotation to match sphere
        poiGroup.rotation.y = sphereMesh ? sphereMesh.rotation.y : 0;
    }

    // ── Texture Picker Popup ───────────────────────────────────────────────
    async function openTexturePicker(targetField) {
        // Scan all texture sub-directories
        const FOLDERS = ['planets','rocky','gas','stars'];
        const groups = [];  // { folder, sets: [{ base, diffuse, thumb }] }

        for (const folder of FOLDERS) {
            try {
                const files = await API.listDir('assets/textures/' + folder);
                const diffuseFiles = files.filter(f => !f.isDir && f.name.endsWith('_diffuse.png'));
                const sets = diffuseFiles.map(f => {
                    const base = f.name.replace('_diffuse.png','');
                    return {
                        base,
                        diffuse: `assets/textures/${folder}/${f.name}`,
                        bump:    `assets/textures/${folder}/${base}_bump.png`,
                        specular:`assets/textures/${folder}/${base}_specular.png`,
                    };
                }).sort((a,b) => a.base.localeCompare(b.base));
                if (sets.length) groups.push({ folder, sets });
            } catch (_) {}
        }

        return new Promise(resolve => {
            const overlay = document.getElementById('modal-overlay');
            const box     = document.getElementById('modal-box');
            // Temporarily widen modal
            box.classList.remove('modal-box--sm');
            box.classList.add('modal-box--md');

            let html = '<div style="max-height:60vh;overflow-y:auto">';
            for (const g of groups) {
                html += `<div class="form-label" style="margin:8px 0 4px;font-size:0.85rem;color:var(--accent-color)">${g.folder.toUpperCase()}</div>`;
                html += '<div style="display:flex;flex-wrap:wrap;gap:6px">';
                for (const s of g.sets) {
                    html += `<div class="tex-pick-item" data-diff="${s.diffuse}" data-bump="${s.bump}" data-spec="${s.specular}" `
                         +  `style="cursor:pointer;width:72px;text-align:center;border:1px solid var(--gray-700);border-radius:4px;padding:3px;transition:border-color .15s" `
                         +  `title="${s.base}">`
                         +  `<img src="/campaign-assets/${s.diffuse}" style="width:64px;height:64px;object-fit:cover;border-radius:2px;display:block" loading="lazy" />`
                         +  `<span style="font-size:0.55rem;color:#aaa;display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${s.base}</span>`
                         +  '</div>';
                }
                html += '</div>';
            }
            html += '</div>';

            document.getElementById('modal-title').textContent = 'Pick Texture';
            document.getElementById('modal-body').innerHTML = html;
            overlay.style.display = 'flex';

            function cleanup(result) {
                overlay.style.display = 'none';
                box.classList.remove('modal-box--md');
                box.classList.add('modal-box--sm');
                document.getElementById('modal-confirm').onclick = null;
                document.getElementById('modal-cancel').onclick  = null;
                resolve(result);
            }

            // Click on a texture thumbnail
            document.querySelectorAll('.tex-pick-item').forEach(item => {
                item.addEventListener('click', () => {
                    cleanup({
                        diffuse:  item.dataset.diff,
                        bump:     item.dataset.bump,
                        specular: item.dataset.spec,
                    });
                });
                item.addEventListener('mouseenter', () => item.style.borderColor = 'var(--accent-color)');
                item.addEventListener('mouseleave', () => item.style.borderColor = 'var(--gray-700)');
            });

            document.getElementById('modal-cancel').onclick  = () => cleanup(null);
            document.getElementById('modal-confirm').onclick = () => cleanup(null);
        });
    }

    async function browseTexture(target) {
        const result = await openTexturePicker(target);
        if (!result) return;
        if (target === 'diffuse' || target === 'both') {
            els['ps-tex-diffuse'].value = result.diffuse;
        }
        if (target === 'bump' || target === 'both') {
            els['ps-tex-bump'].value = result.bump;
        }
        // Auto-apply
        applyRenderEdit();
    }

    function hexToInt(hex) {
        return parseInt((hex || '#888888').replace('#', ''), 16);
    }

    // ── POI List ───────────────────────────────────────────────────────────────
    function renderPOIList() {
        const list = els['ps-poi-list'];
        list.innerHTML = '';
        (bodyData?.pois || []).forEach((poi, i) => {
            const item = document.createElement('div');
            item.className = `poi-item${selectedPOI === i ? ' selected' : ''}`;
            const lat = poi.coordinates_3d?.lat ?? '?';
            const lon = poi.coordinates_3d?.lon ?? '?';
            item.innerHTML = `
                <span class="poi-type-badge">${poi.type || '?'}</span>
                <span class="poi-name">${poi.name || poi.id}</span>
                <span class="poi-coords">${lat}°, ${lon}°</span>
            `;
            item.addEventListener('click', () => selectPOI(i));
            list.appendChild(item);
        });
    }

    function selectPOI(idx) {
        selectedPOI = idx;
        const poi = bodyData.pois[idx];
        if (!poi) return;

        els['ps-poi-editor'].style.display = '';
        els['ps-poi-id'].value    = poi.id || '';
        els['ps-poi-name'].value  = poi.name || '';
        els['ps-poi-type'].value  = poi.type || 'Settlement';
        els['ps-poi-desc'].value  = poi.description || '';
        els['ps-poi-link'].value  = poi.link_to_map || '';
        els['ps-poi-lat'].value   = poi.coordinates_3d?.lat ?? '';
        els['ps-poi-lon'].value   = poi.coordinates_3d?.lon ?? '';

        renderPOIList();
        updatePOIMarkers();
        setStatus(`POI: ${poi.name}`, `${poi.type} @ ${poi.coordinates_3d?.lat}°, ${poi.coordinates_3d?.lon}°`);
    }

    function applyPOIEdit() {
        if (selectedPOI === null) return;
        const poi = bodyData.pois[selectedPOI];
        if (!poi) return;
        poi.id          = els['ps-poi-id'].value.trim()   || poi.id;
        poi.name        = els['ps-poi-name'].value.trim()  || poi.name;
        poi.type        = els['ps-poi-type'].value;
        poi.description = els['ps-poi-desc'].value.trim();
        poi.link_to_map = els['ps-poi-link'].value.trim();
        poi.coordinates_3d = {
            lat: parseFloat(els['ps-poi-lat'].value) || 0,
            lon: parseFloat(els['ps-poi-lon'].value) || 0,
        };
        renderPOIList();
        updatePOIMarkers();
        notify('POI updated.', 'success');
    }

    function deletePOI() {
        if (selectedPOI === null) return;
        bodyData.pois.splice(selectedPOI, 1);
        selectedPOI = null;
        els['ps-poi-editor'].style.display = 'none';
        renderPOIList();
        updatePOIMarkers();
        notify('POI removed.', 'warning');
    }

    function addPOI() {
        isAddingPOI = true;
        document.getElementById('ps-sphere-hint').textContent = 'Click on the sphere to place the POI';
        if (renderer?.domElement) renderer.domElement.style.cursor = 'crosshair';
        notify('Click on the sphere to place a POI.', 'info', 4000);
    }

    // ── Legacy 2D click handler (kept for fallback if Three.js unavailable) ───
    function handleCanvasClick(e) {
        // 3D click is handled by handle3DClick via Three.js raycasting.
        // This is only reached if the old hidden canvas somehow gets a click.
    }

    // ── CRUD ───────────────────────────────────────────────────────────────────
    async function newBody() {
        const name = await promptModal('New Body', 'BODY ID', 'body_new');
        if (!name) return;
        const id  = name.toLowerCase().replace(/\s+/g, '_');
        const rel = `data/bodies/${id}.json`;
        const data = {
            id,
            render_data: { texture_diffuse: '', texture_bump: '', atmosphere_color: '#88aaff', rotation_speed: 0.005 },
            pois: [],
        };
        try {
            await API.saveFile(rel, data);
            await refreshBodyList();
            els['ps-body-select'].value = rel;
            await loadBodyFile(rel);
            notify(`Body "${id}" created.`, 'success');
        } catch (e) {
            notify(`Error: ${e.message}`, 'error');
        }
    }

    async function saveBody() {
        if (!bodyData || !activeFile) { notify('No body loaded.', 'warning'); return; }
        try {
            await API.saveFile(activeFile, bodyData);
            // Sync diffuse texture back to the parent system's orbital entry
            const sysRel = els['ps-system-select']?.value;
            if (sysRel && bodyData.render_data?.texture_diffuse) {
                try {
                    const sysData = await API.getFile(sysRel);
                    const orb = (sysData.orbitals || []).find(o => o.file === activeFile);
                    if (orb) {
                        orb.texture = bodyData.render_data.texture_diffuse;
                        await API.saveFile(sysRel, sysData);
                    }
                } catch (_) {}
            }
            notify('Body saved.', 'success');
            setStatus(`Saved: ${activeFile}`);
        } catch (e) {
            notify(`Save failed: ${e.message}`, 'error');
        }
    }

    async function deleteBody() {
        if (!activeFile) return;
        const ok = await showModal('Delete Body', `Delete body file <b>${activeFile}</b>?`);
        if (!ok) return;
        try {
            await API.deleteFile(activeFile).catch(() => {});
            bodyData = null; activeFile = null; selectedPOI = null;
            els['ps-placeholder'].style.display   = '';
            els['ps-body-container'].style.display = 'none';
            els['ps-poi-editor'].style.display     = 'none';
            els['ps-render-editor'].style.display  = 'none';
            await refreshBodyList();
            notify('Body deleted.', 'warning');
        } catch (e) {
            notify(`Delete failed: ${e.message}`, 'error');
        }
    }

    // ── Event wiring ───────────────────────────────────────────────────────────
    function wireEvents() {
        els['ps-system-select'].addEventListener('change', e => {
            if (e.target.value) {
                loadSystem(e.target.value);
            } else {
                // No system selected — fall back to listing all bodies
                refreshBodyList();
            }
        });
        els['ps-body-select'].addEventListener('change', e => {
            if (e.target.value) loadBodyFile(e.target.value);
        });
        els['ps-new-body'].addEventListener('click', newBody);
        els['ps-save-body'].addEventListener('click', saveBody);
        els['ps-delete-body'].addEventListener('click', deleteBody);
        els['ps-render-apply'].addEventListener('click', applyRenderEdit);
        if (document.getElementById('ps-tex-browse'))  document.getElementById('ps-tex-browse').addEventListener('click',  () => browseTexture('both'));
        els['ps-add-poi'].addEventListener('click', addPOI);
        els['ps-poi-apply'].addEventListener('click', applyPOIEdit);
        els['ps-poi-delete'].addEventListener('click', deletePOI);

        els['ps-atmo-picker'].addEventListener('input', e => {
            els['ps-atmo-color'].value = e.target.value;
        });

        els['ps-canvas'].addEventListener('click', handleCanvasClick);

        window.addEventListener('keydown', e => {
            const activeModule = document.querySelector('.module.active');
            if (!activeModule || activeModule.id !== 'module-planet') return;
            if (e.key === 'Escape' && isAddingPOI) {
                isAddingPOI = false;
                document.getElementById('ps-sphere-hint').textContent = 'Click on the sphere to pin a POI';
                if (renderer?.domElement) renderer.domElement.style.cursor = 'grab';
            }
            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedPOI !== null) {
                const tag = e.target.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
                deletePOI();
            }
            if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveBody(); }
        });
    }

    // ── Public API ─────────────────────────────────────────────────────────────
    return {
        init() {
            cacheEls();
            wireEvents();
            init3DScene();
            refreshSystemList();
            refreshBodyList();
        },
        async loadByFile(rel) {
            await refreshSystemList();
            // Try to find which system contains this body and select it
            try {
                const sysFiles = await API.listDir('data/systems');
                for (const f of sysFiles.filter(f => !f.isDir && f.name.endsWith('.json'))) {
                    const sysRel = `data/systems/${f.name}`;
                    const sysData = await API.getFile(sysRel);
                    const match = (sysData.orbitals || []).find(o => o.file === rel);
                    if (match) {
                        els['ps-system-select'].value = sysRel;
                        currentSystemData = sysData;
                        populateBodyListFromSystem(sysData);
                        break;
                    }
                }
            } catch (_) { /* fall through */ }
            if (els['ps-body-select']) els['ps-body-select'].value = rel;
            await loadBodyFile(rel);
        },
        reload() { refreshSystemList(); refreshBodyList(); },
    };

})();
