// =============================================================================
//  GEMINI ARCHITECT — Module C: Planetary Studio
//  Body file editor: render data, POI list, 2D sphere preview with pin dropper
// =============================================================================

const PlanetaryStudio = (() => {

    // ── State ──────────────────────────────────────────────────────────────────
    let bodyData    = null;
    let activeFile  = null;
    let selectedPOI = null;  // index into bodyData.pois
    let isAddingPOI = false;

    // 2D canvas sphere preview
    let canvas = null;
    let ctx    = null;

    const SPHERE_R  = 140; // radius in canvas pixels
    const SPHERE_CX = 160;
    const SPHERE_CY = 160;

    // ── DOM refs ───────────────────────────────────────────────────────────────
    const els = {};

    function cacheEls() {
        ['ps-body-select','ps-new-body','ps-save-body','ps-delete-body',
         'ps-render-editor','ps-tex-diffuse','ps-tex-bump','ps-atmo-color',
         'ps-atmo-picker','ps-rot-speed','ps-render-apply',
         'ps-poi-editor','ps-poi-id','ps-poi-name','ps-poi-type',
         'ps-poi-desc','ps-poi-link','ps-poi-lat','ps-poi-lon',
         'ps-poi-apply','ps-poi-delete',
         'ps-placeholder','ps-body-container',
         'ps-poi-list','ps-add-poi','ps-canvas',
        ].forEach(id => { els[id] = document.getElementById(id); });
    }

    // ── File list ──────────────────────────────────────────────────────────────
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
                atmosphere_color: '#88aaff',
                rotation_speed:   0.005,
            };
            populateRenderEditor();
            renderPOIList();
            drawSphere();
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
        drawSphere();
        notify('Render data updated.', 'success');
    }

    // ── 2D Sphere preview ──────────────────────────────────────────────────────
    function drawSphere() {
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const atmoColor = bodyData?.render_data?.atmosphere_color || '#88aaff';

        // Background
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // Atmosphere glow
        const atmoGrad = ctx.createRadialGradient(
            SPHERE_CX, SPHERE_CY, SPHERE_R - 5,
            SPHERE_CX, SPHERE_CY, SPHERE_R + 25
        );
        atmoGrad.addColorStop(0,   hexWithAlpha(atmoColor, 0.4));
        atmoGrad.addColorStop(1,   'transparent');
        ctx.beginPath();
        ctx.arc(SPHERE_CX, SPHERE_CY, SPHERE_R + 25, 0, Math.PI * 2);
        ctx.fillStyle = atmoGrad;
        ctx.fill();

        // Planet surface gradient
        const surfGrad = ctx.createRadialGradient(
            SPHERE_CX - 40, SPHERE_CY - 40, 10,
            SPHERE_CX, SPHERE_CY, SPHERE_R
        );
        surfGrad.addColorStop(0,   '#2a3a4a');
        surfGrad.addColorStop(0.6, '#1a2030');
        surfGrad.addColorStop(1,   '#0a0010');
        ctx.beginPath();
        ctx.arc(SPHERE_CX, SPHERE_CY, SPHERE_R, 0, Math.PI * 2);
        ctx.fillStyle = surfGrad;
        ctx.fill();

        // Outline
        ctx.beginPath();
        ctx.arc(SPHERE_CX, SPHERE_CY, SPHERE_R, 0, Math.PI * 2);
        ctx.strokeStyle = atmoColor;
        ctx.lineWidth = 1.5;
        ctx.globalAlpha = 0.5;
        ctx.stroke();
        ctx.globalAlpha = 1;

        // Draw POI pins
        (bodyData?.pois || []).forEach((poi, i) => {
            drawPOIPin(poi, i === selectedPOI);
        });

        // If adding POI, show cursor hint
        if (isAddingPOI) {
            ctx.strokeStyle = '#ffd700';
            ctx.lineWidth   = 1;
            ctx.setLineDash([4, 4]);
            ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);
            ctx.setLineDash([]);
        }
    }

    function drawPOIPin(poi, isSelected) {
        const { x, y, valid } = latLonToCanvas(poi.coordinates_3d?.lat ?? 0, poi.coordinates_3d?.lon ?? 0);
        if (!valid) return;

        ctx.beginPath();
        ctx.arc(x, y, isSelected ? 7 : 5, 0, Math.PI * 2);
        ctx.fillStyle = isSelected ? '#ffd700' : '#ff6633';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth   = 1;
        ctx.stroke();

        if (isSelected && poi.name) {
            ctx.fillStyle   = '#fff';
            ctx.font        = '10px Share Tech Mono, monospace';
            ctx.fillText(poi.name, x + 8, y + 4);
        }
    }

    function latLonToCanvas(lat, lon) {
        // Convert lat/lon to 2D Mercator-like projection on sphere face
        // lat: -90..90, lon: -180..180
        const normLon = ((lon + 180) / 360);   // 0..1
        const normLat = ((90 - lat) / 180);    // 0..1

        // Map to sphere surface (simple orthographic-ish)
        const angle = (normLon - 0.5) * Math.PI;  // -PI/2..PI/2 visible half
        const vAngle= (normLat - 0.5) * Math.PI;

        const x = SPHERE_CX + Math.sin(angle) * SPHERE_R * Math.cos(vAngle);
        const y = SPHERE_CY + Math.sin(vAngle) * SPHERE_R;

        // Check if on visible hemisphere
        const depth = Math.cos(angle) * Math.cos(vAngle);
        return { x, y, valid: depth >= 0 };
    }

    function canvasToLatLon(cx, cy) {
        const dx = (cx - SPHERE_CX) / SPHERE_R;
        const dy = (cy - SPHERE_CY) / SPHERE_R;
        if (dx*dx + dy*dy > 1) return null;  // outside sphere

        const vAngle  = Math.asin(Math.max(-1, Math.min(1, dy)));
        const cosV    = Math.cos(vAngle);
        const angle   = cosV < 0.01 ? 0 : Math.asin(Math.max(-1, Math.min(1, dx / cosV)));

        const lon = (angle / Math.PI) * 180;
        const lat = 90 - ((vAngle / Math.PI + 0.5) * 180);

        return { lat: parseFloat(lat.toFixed(2)), lon: parseFloat(lon.toFixed(2)) };
    }

    function hexWithAlpha(hex, alpha) {
        const r = parseInt(hex.slice(1,3),16);
        const g = parseInt(hex.slice(3,5),16);
        const b = parseInt(hex.slice(5,7),16);
        return `rgba(${r},${g},${b},${alpha})`;
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
        drawSphere();
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
        drawSphere();
        notify('POI updated.', 'success');
    }

    function deletePOI() {
        if (selectedPOI === null) return;
        bodyData.pois.splice(selectedPOI, 1);
        selectedPOI = null;
        els['ps-poi-editor'].style.display = 'none';
        renderPOIList();
        drawSphere();
        notify('POI removed.', 'warning');
    }

    function addPOI() {
        isAddingPOI = true;
        document.getElementById('ps-sphere-hint').textContent = 'Click on the sphere to place the POI';
        drawSphere();
        notify('Click on the sphere to place a POI.', 'info', 4000);
    }

    // ── Canvas click → place POI ───────────────────────────────────────────────
    function handleCanvasClick(e) {
        const rect   = canvas.getBoundingClientRect();
        const cx = (e.clientX - rect.left) * (canvas.width  / rect.width);
        const cy = (e.clientY - rect.top)  * (canvas.height / rect.height);

        if (isAddingPOI) {
            const coords = canvasToLatLon(cx, cy);
            if (!coords) { notify('Click inside the sphere.', 'warning'); return; }
            const id = `loc_${Date.now()}`;
            bodyData.pois.push({
                id,
                name:           'New POI',
                type:           'Settlement',
                coordinates_3d: coords,
                description:    '',
                link_to_map:    `data/locations/${id}.json`,
            });
            isAddingPOI = false;
            document.getElementById('ps-sphere-hint').textContent = 'Click on the sphere to pin a POI';
            selectedPOI = bodyData.pois.length - 1;
            els['ps-poi-editor'].style.display = '';
            renderPOIList();
            drawSphere();
            selectPOI(selectedPOI);
            notify('POI placed. Edit its properties in the sidebar.', 'info');
        } else {
            // Try to select nearest POI
            let best = null, bestDist = 12;
            (bodyData?.pois || []).forEach((poi, i) => {
                const { x, y, valid } = latLonToCanvas(poi.coordinates_3d?.lat ?? 0, poi.coordinates_3d?.lon ?? 0);
                if (!valid) return;
                const d = Math.hypot(cx - x, cy - y);
                if (d < bestDist) { bestDist = d; best = i; }
            });
            if (best !== null) {
                selectPOI(best);
            } else {
                selectedPOI = null;
                els['ps-poi-editor'].style.display = 'none';
                renderPOIList();
                drawSphere();
            }
        }
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
        els['ps-body-select'].addEventListener('change', e => {
            if (e.target.value) loadBodyFile(e.target.value);
        });
        els['ps-new-body'].addEventListener('click', newBody);
        els['ps-save-body'].addEventListener('click', saveBody);
        els['ps-delete-body'].addEventListener('click', deleteBody);
        els['ps-render-apply'].addEventListener('click', applyRenderEdit);
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
                drawSphere();
            }
            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedPOI !== null) deletePOI();
            if (e.key === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); saveBody(); }
        });
    }

    // ── Public API ─────────────────────────────────────────────────────────────
    return {
        init() {
            cacheEls();
            canvas = els['ps-canvas'];
            ctx    = canvas.getContext('2d');
            wireEvents();
            refreshBodyList();
            // Initial sphere draw (empty)
            drawSphere();
        },
        async loadByFile(rel) {
            await refreshBodyList();
            if (els['ps-body-select']) els['ps-body-select'].value = rel;
            await loadBodyFile(rel);
        },
        reload: refreshBodyList,
    };

})();
