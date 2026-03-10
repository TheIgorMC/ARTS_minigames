// =============================================================================
//  GEMINI ARCHITECT — Module B: Orrery Builder
//  Tree editor for star → planet → moon hierarchy
// =============================================================================

const OrreryBuilder = (() => {

    // ── State ──────────────────────────────────────────────────────────────────
    let systemData    = null;
    let activeFile    = null;
    let selectedOrbIdx = null;  // index into systemData.orbitals

    // ── DOM refs ───────────────────────────────────────────────────────────────
    const els = {};

    function cacheEls() {
        ['ob-system-select','ob-new-system','ob-save-system','ob-delete-system',
         'ob-star-editor','ob-star-name','ob-star-class','ob-star-color','ob-star-apply',
         'ob-orbital-editor','ob-orb-id','ob-orb-name','ob-orb-type',
         'ob-orb-index','ob-orb-radius','ob-orb-model','ob-orb-scale','ob-orb-faction','ob-orb-locked',
         'ob-orb-file','ob-orb-open','ob-orb-apply','ob-orb-delete',
         'ob-placeholder','ob-tree-container','ob-orbit-canvas',
         'ob-system-id-display','ob-star-name-display','ob-star-class-display',
         'ob-star-edit-btn','ob-orbitals-list','ob-add-orbital',
        ].forEach(id => { els[id] = document.getElementById(id); });
    }

    // ── File list ──────────────────────────────────────────────────────────────
    async function refreshSystemList() {
        const sel = els['ob-system-select'];
        sel.innerHTML = '<option value="">— select system —</option>';
        try {
            const files = await API.listDir('data/systems');
            files.filter(f => !f.isDir && f.name.endsWith('.json')).forEach(f => {
                const opt = document.createElement('option');
                opt.value = `data/systems/${f.name}`;
                opt.textContent = f.name.replace('.json', '');
                sel.appendChild(opt);
            });
            if (activeFile) sel.value = activeFile;
        } catch (e) {
            notify(`Could not list systems: ${e.message}`, 'error');
        }
    }

    async function loadSystemFile(rel) {
        try {
            systemData = await API.getFile(rel);
            activeFile = rel;
            if (!systemData.orbitals) systemData.orbitals = [];
            if (!systemData.star)     systemData.star = { name: 'Unknown Star', spectral_class: 'G', radius_km: 696000, color_hex: '#ffcc00' };
            els['ob-placeholder'].style.display   = 'none';
            els['ob-tree-container'].style.display = '';
            resetCam();
            preloadTextures();
            startOrrery();
            renderTree();
            setStatus(`System loaded: ${systemData.id}`, rel);
        } catch (e) {
            notify(`Failed to load system: ${e.message}`, 'error');
        }
    }

    // ── Animated Orrery Canvas ──────────────────────────────────────────────────
    let animHandle = null;
    const cam      = { x: 0, y: 0, s: 1, tx: 0, ty: 0, ts: 1 };
    const drag     = { on: false, moved: false, sx: 0, sy: 0, cx0: 0, cy0: 0 };
    let   orbitHits = [];

    const PLANET_COL = {
        Terran:'#88aaff', Ocean:'#2255ee', Jungle:'#44bb55', Desert:'#cc8844',
        'Gas Giant':'#ee8855', 'Ice Giant':'#aaccff', Lava:'#ff5500',
        Barren:'#778888', Rock:'#998866', Planet:'#00d2ff',
        'Asteroid Belt':'#887755', 'Companion Star':'#ffcc88',
    };

    // Texture cache for orbital body images
    const texCache = new Map();  // path → { img, loaded }

    function loadOrbTex(path) {
        if (!path || texCache.has(path)) return;
        const img   = new Image();
        const entry = { img, loaded: false };
        texCache.set(path, entry);
        img.onload  = () => { entry.loaded = true; };
        img.onerror = () => { /* leave loaded=false */ };
        img.src     = `/campaign-assets/${path.replace(/^\//, '')}`;
    }

    async function preloadTextures() {
        for (const orb of (systemData?.orbitals || [])) {
            // If orbital has a body file, read its render_data and sync the texture path
            if (orb.file) {
                try {
                    const body = await API.getFile(orb.file);
                    const diff = body?.render_data?.texture_diffuse;
                    if (diff) orb.texture = diff;
                } catch (_) { /* body file may not exist yet */ }
            }
            if (orb.texture) loadOrbTex(orb.texture);
        }
    }

    function orbPhase(id) {
        let h = 0x811c9dc5;
        for (let i = 0; i < (id || '').length; i++) {
            h ^= (id || '').charCodeAt(i);
            h  = Math.imul(h, 0x01000193) >>> 0;
        }
        return (h >>> 0) / 0xffffffff * Math.PI * 2;
    }
    function orbSpeed(r) { return 0.30 / Math.pow(Math.max(r, 0.01), 0.65); }

    function getToScreen() {
        const canvas = els['ob-orbit-canvas'];
        if (!canvas || !systemData) return null;
        const W = canvas.offsetWidth || 600, H = canvas.offsetHeight || 420;
        const radii = (systemData.orbitals || []).filter(o => o.orbit_radius > 0).map(o => o.orbit_radius);
        if (!radii.length) return null;
        const maxR  = Math.max(...radii);
        const pxMax = Math.min(W, H) / 2 - 55;
        return r => (Math.log10(r + 1) / Math.log10(maxR + 1)) * pxMax;
    }

    function drawFrame() {
        const canvas = els['ob-orbit-canvas'];
        if (!canvas || !systemData) { animHandle = null; return; }

        const W = canvas.offsetWidth || 600, H = canvas.offsetHeight || 420;
        if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
        const ctx = canvas.getContext('2d');
        const CX = W / 2, CY = H / 2;
        const now = performance.now() * 0.001; // seconds for orbit animation

        // lerp camera
        const L = 0.1;
        cam.x += (cam.tx - cam.x) * L;
        cam.y += (cam.ty - cam.y) * L;
        cam.s += (cam.ts - cam.s) * L;

        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = '#06060e';
        ctx.fillRect(0, 0, W, H);

        const toSc = getToScreen();
        if (!toSc) { animHandle = requestAnimationFrame(drawFrame); return; }

        const pxMax = Math.min(W, H) / 2 - 55;
        const inv   = 1 / cam.s;

        ctx.save();
        ctx.translate(CX + cam.x, CY + cam.y);
        ctx.scale(cam.s, cam.s);

        // decorative grid rings
        for (let i = 1; i <= 5; i++) {
            ctx.beginPath();
            ctx.arc(0, 0, pxMax * i / 5, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(0,210,255,0.03)';
            ctx.lineWidth   = inv;
            ctx.stroke();
        }

        orbitHits = [];
        const orbitals = [...(systemData.orbitals || [])].sort((a, b) => (a.orbit_index || 99) - (b.orbit_index || 99));

        for (const orb of orbitals) {
            if (!orb.orbit_radius) continue;
            const r       = toSc(orb.orbit_radius);
            const isBelt  = orb.type === 'Asteroid Belt';
            const origIdx = systemData.orbitals.indexOf(orb);
            const isSel   = selectedOrbIdx === origIdx;

            // orbit ring
            ctx.beginPath();
            ctx.arc(0, 0, r, 0, Math.PI * 2);
            ctx.strokeStyle = isBelt
                ? 'rgba(136,100,60,0.4)'
                : (isSel ? 'rgba(0,210,255,0.35)' : 'rgba(0,210,255,0.1)');
            ctx.lineWidth   = (isBelt ? 6 : 1) * inv;
            ctx.setLineDash(isBelt ? [4 * inv, 3 * inv] : []);
            ctx.stroke();
            ctx.setLineDash([]);

            if (isBelt) continue;

            // Animated orbit position
            const angle = orbPhase(orb.id || '') + now * orbSpeed(r);
            const px    = Math.cos(angle) * r;
            const py    = Math.sin(angle) * r;
            const pType = orb.planet_type || orb.type || 'Planet';
            const col   = PLANET_COL[pType] || '#00d2ff';
            const sz    = (pType === 'Gas Giant' ? 9 : pType === 'Ice Giant' ? 7 : orb.type === 'Companion Star' ? 10 : 5);

            // selection pulse ring
            if (isSel) {
                ctx.beginPath();
                ctx.arc(px, py, sz * 2.8, 0, Math.PI * 2);
                ctx.strokeStyle = 'rgba(255,255,255,0.35)';
                ctx.lineWidth   = 1.5 * inv;
                ctx.stroke();
            }

            // glow
            const grd = ctx.createRadialGradient(px, py, 0, px, py, sz * 4);
            grd.addColorStop(0, col + 'aa');
            grd.addColorStop(1, 'transparent');
            ctx.beginPath();
            ctx.arc(px, py, sz * 4, 0, Math.PI * 2);
            ctx.fillStyle = grd;
            ctx.fill();

            // body — textured if available, else flat color
            const tex = orb.texture ? texCache.get(orb.texture) : null;
            if (tex?.loaded) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(px, py, sz, 0, Math.PI * 2);
                ctx.clip();
                // Horizontal scroll to simulate axis rotation
                const texW    = sz * 2;
                const texH    = sz * 2;
                const scrollT = (now * 0.08) % 1;
                const shiftX  = scrollT * texW;
                ctx.drawImage(tex.img, px - sz - shiftX,          py - sz, texW, texH);
                ctx.drawImage(tex.img, px - sz - shiftX + texW,   py - sz, texW, texH);
                // Sphere shading overlay
                const shade = ctx.createRadialGradient(
                    px - sz * 0.3, py - sz * 0.3, 0,
                    px, py, sz
                );
                shade.addColorStop(0,   'rgba(255,255,255,0.08)');
                shade.addColorStop(0.5, 'rgba(0,0,0,0)');
                shade.addColorStop(1,   'rgba(0,0,0,0.55)');
                ctx.fillStyle = shade;
                ctx.fillRect(px - sz, py - sz, texW, texH);
                ctx.restore();
            } else {
                ctx.beginPath();
                ctx.arc(px, py, sz, 0, Math.PI * 2);
                ctx.fillStyle = col;
                ctx.fill();
            }

            // children orbiting
            (orb.children || []).forEach((child, ci) => {
                const ca = ci * (Math.PI * 2 / Math.max(orb.children.length, 1)) + now * 0.5;
                const mr = sz + (5 + ci * 2.5) * inv;
                ctx.beginPath();
                ctx.arc(px + Math.cos(ca) * mr, py + Math.sin(ca) * mr, 1.5 * inv, 0, Math.PI * 2);
                ctx.fillStyle = child.type === 'Station' ? '#ffaa00' : '#667788';
                ctx.fill();
            });

            // label (visible only when zoomed in enough)
            if (cam.s > 0.4) {
                ctx.fillStyle = col + 'dd';
                ctx.font      = `${9 * inv}px "Share Tech Mono",monospace`;
                ctx.textAlign = 'center';
                ctx.fillText(orb.name || orb.id, px, py + sz + 11 * inv);
            }

            orbitHits.push({ sx: CX + cam.x + px * cam.s, sy: CY + cam.y + py * cam.s, r: (sz + 6) * cam.s, idx: origIdx, type: 'orbital' });
        }

        // central star
        const sc = systemData.star?.color_hex || '#ffcc00';
        const sR = 14;
        const sg = ctx.createRadialGradient(0, 0, 0, 0, 0, sR * 5);
        sg.addColorStop(0, sc); sg.addColorStop(0.4, sc + '66'); sg.addColorStop(1, 'transparent');
        ctx.beginPath(); ctx.arc(0, 0, sR * 5, 0, Math.PI * 2); ctx.fillStyle = sg; ctx.fill();
        ctx.shadowColor = sc; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(0, 0, sR, 0, Math.PI * 2); ctx.fillStyle = sc; ctx.fill();
        ctx.shadowBlur = 0;

        if (cam.s > 0.25) {
            ctx.fillStyle = sc;
            ctx.font      = `bold ${10 * inv}px "Share Tech Mono",monospace`;
            ctx.textAlign = 'center';
            ctx.fillText(systemData.star?.name || '—', 0, sR + 14 * inv);
            ctx.fillStyle = '#667';
            ctx.font      = `${8 * inv}px "Share Tech Mono",monospace`;
            ctx.fillText(systemData.star?.spectral_class || '', 0, sR + 24 * inv);
        }
        orbitHits.push({ sx: CX + cam.x, sy: CY + cam.y, r: (sR + 8) * cam.s, idx: null, type: 'star' });

        ctx.restore();
        animHandle = requestAnimationFrame(drawFrame);
    }

    function startOrrery() {
        const c = els['ob-orbit-canvas'];
        if (c && c.offsetWidth > 0) { c.width = c.offsetWidth; c.height = c.offsetHeight || 420; }
        if (!animHandle) animHandle = requestAnimationFrame(drawFrame);
    }

    function stopOrrery() {
        if (animHandle) { cancelAnimationFrame(animHandle); animHandle = null; }
    }

    function resetCam() { cam.tx = 0; cam.ty = 0; cam.ts = 1; }

    function focusOrb(orb) {
        if (!orb?.orbit_radius) { resetCam(); return; }
        const toSc = getToScreen();
        if (!toSc) return;
        const r     = toSc(orb.orbit_radius);
        const now   = performance.now() * 0.001;
        const angle = orbPhase(orb.id || '') + now * orbSpeed(r);
        cam.tx = -(Math.cos(angle) * r);
        cam.ty = -(Math.sin(angle) * r);
        const c   = els['ob-orbit-canvas'];
        const dim = Math.min(c?.offsetWidth || 600, c?.offsetHeight || 420);
        cam.ts    = Math.max(2, Math.min(10, dim / (r * 0.7)));
    }

    function focusStar() { cam.tx = 0; cam.ty = 0; cam.ts = 2.5; }

    function wireCanvasInteraction() {
        const canvas = els['ob-orbit-canvas'];
        if (!canvas) return;

        canvas.addEventListener('click', ev => {
            if (drag.moved) { drag.moved = false; return; }
            const rect = canvas.getBoundingClientRect();
            const cssX = ev.clientX - rect.left;
            const cssY = ev.clientY - rect.top;

            // Hit-test in screen-space (orbitHits stores screen positions from last draw)
            let best = null, bestD = Infinity;
            for (const h of orbitHits) {
                const d = Math.hypot(cssX - h.sx, cssY - h.sy);
                const hitR = Math.max(h.r, 18);  // 18 CSS-px minimum
                if (d <= hitR && d < bestD) { best = h; bestD = d; }
            }

            if (best?.type === 'star') {
                selectedOrbIdx = null;
                deselectOrbital(false);
                renderTree();
                focusStar();
                if (systemData && els['ob-star-name']) {
                    els['ob-star-name'].value  = systemData.star?.name || '';
                    els['ob-star-class'].value = systemData.star?.spectral_class || '';
                    els['ob-star-color'].value = systemData.star?.color_hex || '#ffcc00';
                    if (els['ob-star-editor']) els['ob-star-editor'].style.display = '';
                }
            } else if (best?.type === 'orbital') {
                selectOrbital(best.idx);
            } else {
                selectedOrbIdx = null;
                deselectOrbital(true);
                renderTree();
                resetCam();
            }
        });

        canvas.addEventListener('mousedown', ev => {
            if (ev.button !== 0) return;
            drag.on   = true; drag.moved = false;
            drag.sx   = ev.clientX; drag.sy  = ev.clientY;
            // Snap target to current lerped position so drag starts from where the view actually is
            cam.tx = cam.x; cam.ty = cam.y; cam.ts = cam.s;
            drag.cx0  = cam.x;      drag.cy0 = cam.y;
            canvas.style.cursor = 'grabbing';
        });
        window.addEventListener('mousemove', ev => {
            if (!drag.on) return;
            const dx = ev.clientX - drag.sx, dy = ev.clientY - drag.sy;
            if (Math.abs(dx) > 3 || Math.abs(dy) > 3) drag.moved = true;
            cam.tx = drag.cx0 + dx;
            cam.ty = drag.cy0 + dy;
        });
        window.addEventListener('mouseup', () => { drag.on = false; canvas.style.cursor = 'crosshair'; });
        canvas.addEventListener('wheel', ev => {
            ev.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const cssX = ev.clientX - rect.left;
            const cssY = ev.clientY - rect.top;
            const CX   = canvas.offsetWidth  / 2;
            const CY   = canvas.offsetHeight / 2;
            // world-space point currently under cursor (use target cam, not lerped cam)
            const wx   = (cssX - CX - cam.tx) / cam.ts;
            const wy   = (cssY - CY - cam.ty) / cam.ts;
            const newS = Math.max(0.1, Math.min(20, cam.ts * (ev.deltaY < 0 ? 1.13 : 0.88)));
            cam.ts = newS;
            // re-anchor so cursor stays over same world point
            cam.tx = cssX - CX - wx * newS;
            cam.ty = cssY - CY - wy * newS;
        }, { passive: false });
    }

    // ── Render tree ────────────────────────────────────────────────────────────
    function renderTree() {
        if (!systemData) return;

        els['ob-system-id-display'].textContent = systemData.id || '';
        els['ob-star-name-display'].textContent  = systemData.star?.name || '—';
        els['ob-star-class-display'].textContent = systemData.star?.spectral_class || '';

        // Update star circle color
        const starIcon = document.querySelector('.orrery-star .orrery-icon');
        if (starIcon) starIcon.style.color = systemData.star?.color_hex || '#ffcc00';

        // Render orbitals
        const list = els['ob-orbitals-list'];
        list.innerHTML = '';

        const orbitals = [...(systemData.orbitals || [])].sort((a, b) => (a.orbit_index||0) - (b.orbit_index||0));

        orbitals.forEach((orb, i) => {
            const origIdx = systemData.orbitals.indexOf(orb);
            const item    = document.createElement('div');
            item.className = `orbital-item${selectedOrbIdx === origIdx ? ' selected' : ''}`;

            const childStations = (orb.children || []).filter(c => c.type === 'Station').length;
            const childMoons    = (orb.children || []).filter(c => c.type === 'Moon').length;
            const childBadge    = (childStations || childMoons)
                ? `<span class="orbital-children-badge" title="${childStations} station(s), ${childMoons} moon(s)">`
                  + [childStations && `⬡${childStations}`, childMoons && `◉${childMoons}`].filter(Boolean).join(' ')
                  + `</span>`
                : '';
            const lockedBadge = orb.locked ? `<span class="orbital-locked-badge" title="Locked">🔒</span>` : '';

            item.innerHTML = `
                <span class="orbital-index">#${orb.orbit_index ?? i+1}</span>
                <span class="orbital-icon">${orbitalIcon(orb.type)}</span>
                <span class="orbital-name">${orb.name || orb.id}</span>
                <span class="orbital-type-badge">${orb.type || 'Body'}</span>
                ${childBadge}${lockedBadge}
                <button class="btn btn-sm ob-orb-up" title="Move inward">↑</button>
                <button class="btn btn-sm ob-orb-dn" title="Move outward">↓</button>
            `;

            item.querySelector('.ob-orb-up').addEventListener('click', e => {
                e.stopPropagation();
                moveOrbital(origIdx, -1);
            });

            item.querySelector('.ob-orb-dn').addEventListener('click', e => {
                e.stopPropagation();
                moveOrbital(origIdx, +1);
            });

            item.addEventListener('click', () => selectOrbital(origIdx));
            list.appendChild(item);

            // Children sub-list
            if (orb.children && orb.children.length) {
                const childList = document.createElement('div');
                childList.className = 'orbital-children-list';
                orb.children.forEach((child, ci) => {
                    const cItem = document.createElement('div');
                    cItem.className = 'orbital-child-item';
                    const cIcon = child.type === 'Station' ? '⬡' : child.type === 'Moon' ? '◉' : '○';
                    cItem.innerHTML = `
                        <span class="orbital-child-icon">${cIcon}</span>
                        <span class="orbital-child-name">${child.name || child.id}</span>
                        <span class="orbital-type-badge">${child.type || '?'}</span>
                        ${child.faction ? `<span class="orbital-child-faction">${child.faction}</span>` : ''}
                        <button class="btn btn-sm btn-danger ob-child-del" title="Remove child" data-origidx="${origIdx}" data-ci="${ci}">✕</button>
                    `;
                    cItem.querySelector('.ob-child-del').addEventListener('click', e => {
                        e.stopPropagation();
                        const oi = parseInt(e.currentTarget.dataset.origidx);
                        const ki = parseInt(e.currentTarget.dataset.ci);
                        systemData.orbitals[oi].children.splice(ki, 1);
                        renderTree();
                        notify('Child removed.', 'warning');
                    });
                    childList.appendChild(cItem);
                });
                list.appendChild(childList);
            }
        });

        deselectOrbital(false);
    }

    function orbitalIcon(type) {
        const icons = {
            'Planet': '●', 'Moon': '◉', 'Gas Giant': '🟣',
            'Asteroid Belt': '···', 'Dwarf Planet': '○', 'Station': '⬡',
        };
        return icons[type] || '●';
    }

    // ── Selection ──────────────────────────────────────────────────────────────
    function selectOrbital(idx) {
        selectedOrbIdx = idx;
        const orb = systemData.orbitals[idx];
        if (!orb) return;

        els['ob-orbital-editor'].style.display = '';
        els['ob-orb-id'].value     = orb.id            || '';
        els['ob-orb-name'].value   = orb.name          || '';
        els['ob-orb-type'].value   = orb.type          || 'Planet';
        els['ob-orb-index'].value  = orb.orbit_index   ?? (idx + 1);
        if (els['ob-orb-radius'])  els['ob-orb-radius'].value  = orb.orbit_radius  ?? '';
        if (els['ob-orb-model'])   els['ob-orb-model'].value   = orb.model_3d      || '';
        if (els['ob-orb-scale'])   els['ob-orb-scale'].value   = orb.scale         ?? 1.0;
        if (els['ob-orb-faction']) els['ob-orb-faction'].value = orb.faction        || '';
        if (els['ob-orb-locked'])  els['ob-orb-locked'].checked = !!orb.locked;
        els['ob-orb-file'].value   = orb.file          || `data/bodies/${orb.id}.json`;

        focusOrb(orb);
        renderTree();
        setStatus(`Orbital: ${orb.name}`, `idx ${orb.orbit_index}, ${orb.type}`);
    }

    function deselectOrbital(clearPanel = true) {
        if (clearPanel) {
            els['ob-orbital-editor'].style.display = 'none';
            selectedOrbIdx = null;
        }
    }

    // ── Orbital move ───────────────────────────────────────────────────────────
    function moveOrbital(idx, dir) {
        const orbs = systemData.orbitals;
        const orb = orbs[idx];
        const newIdx = orb.orbit_index + dir;
        if (newIdx < 1) return;

        // Swap orbit_index with neighbour if exists
        const neighbour = orbs.find(o => o !== orb && o.orbit_index === newIdx);
        if (neighbour) neighbour.orbit_index = orb.orbit_index;
        orb.orbit_index = newIdx;
        selectedOrbIdx = idx;
        renderTree();
    }

    // ── CRUD ───────────────────────────────────────────────────────────────────
    async function newSystem() {
        const name = await promptModal('New System', 'SYSTEM ID', 'sys_new');
        if (!name) return;
        const id   = name.toLowerCase().replace(/\s+/g, '_');
        const rel  = `data/systems/${id}.json`;
        const data = {
            id,
            star: { name: 'New Star', spectral_class: 'G2V', radius_km: 696000, color_hex: '#ffcc00' },
            orbitals: [],
        };
        try {
            await API.saveFile(rel, data);
            await refreshSystemList();
            els['ob-system-select'].value = rel;
            await loadSystemFile(rel);
            notify(`System "${id}" created.`, 'success');
        } catch (e) {
            notify(`Error: ${e.message}`, 'error');
        }
    }

    async function saveSystem() {
        if (!systemData || !activeFile) { notify('No system loaded.', 'warning'); return; }
        try {
            await API.saveFile(activeFile, systemData);
            // Sync name and star color back to galaxy plotter's sector cache
            if (typeof GalaxyPlotter !== 'undefined' && GalaxyPlotter.syncSystemFromFile) {
                GalaxyPlotter.syncSystemFromFile(activeFile, systemData);
            }
            notify('System saved.', 'success');
            setStatus(`Saved: ${activeFile}`);
        } catch (e) {
            notify(`Save failed: ${e.message}`, 'error');
        }
    }

    async function deleteSystem() {
        if (!activeFile) return;
        const ok = await showModal('Delete System', `Delete system file <b>${activeFile}</b>?`);
        if (!ok) return;
        try {
            await API.deleteFile(activeFile).catch(() => {});
            systemData = null;
            activeFile = null;
            selectedOrbIdx = null;
            els['ob-placeholder'].style.display    = '';
            els['ob-tree-container'].style.display  = 'none';
            els['ob-orbital-editor'].style.display  = 'none';
            await refreshSystemList();
            notify('System deleted.', 'warning');
        } catch (e) {
            notify(`Delete failed: ${e.message}`, 'error');
        }
    }

    async function addOrbital() {
        const newIdx = (systemData.orbitals.length + 1);
        const id = `planet_${String(newIdx).padStart(2,'0')}_${Math.floor(Math.random()*9000+1000)}`;
        const filePath = `data/bodies/${id}.json`;
        const bodyData = {
            id,
            render_data: {
                texture_diffuse:  '',
                texture_bump:     '',
                texture_specular: '',
                atmosphere_color: '#88aaff',
                rotation_speed:   0.005,
            },
            pois: [],
        };
        try { await API.saveFile(filePath, bodyData); } catch (_) {}
        systemData.orbitals.push({
            id,
            name:         'New Body',
            type:         'Planet',
            orbit_index:  newIdx,
            orbit_radius: null,
            children:     [],
            file:         filePath,
        });
        selectedOrbIdx = systemData.orbitals.length - 1;
        renderTree();
        notify('Orbital added.', 'info');
    }

    function applyOrbitalEdit() {
        if (selectedOrbIdx === null) return;
        const orb = systemData.orbitals[selectedOrbIdx];
        if (!orb) return;
        orb.id          = els['ob-orb-id'].value.trim()     || orb.id;
        orb.name        = els['ob-orb-name'].value.trim()   || orb.name;
        orb.type        = els['ob-orb-type'].value;
        orb.orbit_index = parseInt(els['ob-orb-index'].value) || orb.orbit_index;
        if (els['ob-orb-radius']?.value !== '')  orb.orbit_radius = parseFloat(els['ob-orb-radius'].value) || null;
        if (els['ob-orb-model'])  { const v = els['ob-orb-model'].value.trim(); if (v) orb.model_3d = v; else delete orb.model_3d; }
        if (els['ob-orb-scale'])  orb.scale   = parseFloat(els['ob-orb-scale'].value) || 1.0;
        if (els['ob-orb-faction']) { const v = els['ob-orb-faction'].value.trim(); if (v) orb.faction = v; else delete orb.faction; }
        if (els['ob-orb-locked']) orb.locked  = els['ob-orb-locked'].checked || undefined;
        if (!orb.locked) delete orb.locked;
        orb.file        = els['ob-orb-file'].value.trim()   || orb.file;
        if (!orb.children) orb.children = [];
        preloadTextures();
        renderTree();
        notify('Orbital updated.', 'success');
    }

    async function deleteOrbital() {
        if (selectedOrbIdx === null) return;
        systemData.orbitals.splice(selectedOrbIdx, 1);
        selectedOrbIdx = null;
        renderTree();
        els['ob-orbital-editor'].style.display = 'none';
        notify('Orbital removed.', 'warning');
    }

    async function applyStarEdit() {
        if (!systemData) return;
        const newName = els['ob-star-name'].value.trim() || systemData.star.name;
        systemData.star.name           = newName;
        systemData.star.spectral_class = els['ob-star-class'].value.trim() || systemData.star.spectral_class;
        systemData.star.color_hex      = els['ob-star-color'].value.trim() || systemData.star.color_hex;

        // System name always matches star name
        systemData.name = newName;

        els['ob-star-editor'].style.display = 'none';
        renderTree();
        await saveSystem();
    }

    // ── Event wiring ───────────────────────────────────────────────────────────
    function wireEvents() {
        els['ob-system-select'].addEventListener('change', e => {
            if (e.target.value) loadSystemFile(e.target.value);
        });
        els['ob-new-system'].addEventListener('click', newSystem);
        els['ob-save-system'].addEventListener('click', saveSystem);
        els['ob-delete-system'].addEventListener('click', deleteSystem);

        els['ob-star-edit-btn'].addEventListener('click', () => {
            if (!systemData) return;
            els['ob-star-name'].value  = systemData.star?.name || '';
            els['ob-star-class'].value = systemData.star?.spectral_class || '';
            els['ob-star-color'].value = systemData.star?.color_hex || '#ffcc00';
            els['ob-star-editor'].style.display =
                els['ob-star-editor'].style.display === 'none' ? '' : 'none';
        });
        els['ob-star-apply'].addEventListener('click', applyStarEdit);

        els['ob-add-orbital'].addEventListener('click', addOrbital);
        els['ob-orb-apply'].addEventListener('click', applyOrbitalEdit);
        els['ob-orb-delete'].addEventListener('click', deleteOrbital);

        els['ob-orb-open'].addEventListener('click', () => {
            const file = els['ob-orb-file'].value;
            if (file && typeof PlanetaryStudio !== 'undefined') {
                document.querySelector('[data-module="planet"]').click();
                PlanetaryStudio.loadByFile(file);
            }
        });

        window.addEventListener('keydown', e => {
            const activeModule = document.querySelector('.module.active');
            if (!activeModule || activeModule.id !== 'module-orrery') return;
            if ((e.key === 'Delete' || e.key === 'Backspace') && selectedOrbIdx !== null) {
                const tag = e.target.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
                deleteOrbital();
            }
            if (e.key === 's' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                saveSystem();
            }
        });
    }

    // ── Public API ─────────────────────────────────────────────────────────────
    return {
        init() {
            cacheEls();
            wireEvents();
            wireCanvasInteraction();
            refreshSystemList();
        },
        async loadByFile(rel) {
            await refreshSystemList();
            els['ob-system-select'].value = rel;
            await loadSystemFile(rel);
        },
        reload: refreshSystemList,        // Called from System Forge asset dropper
        addChildStation(station) {
            if (!systemData || selectedOrbIdx === null) return false;
            const orb = systemData.orbitals[selectedOrbIdx];
            if (!orb) return false;
            if (!orb.children) orb.children = [];
            orb.children.push(station);
            renderTree();
            notify(`Station "${station.name}" added to ${orb.name}.`, 'success');
            return true;
        },
        refreshCanvas: startOrrery,
    };

})();
