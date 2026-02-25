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
         'ob-orb-index','ob-orb-file','ob-orb-open','ob-orb-apply','ob-orb-delete',
         'ob-placeholder','ob-tree-container',
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
            // Ensure arrays exist
            if (!systemData.orbitals) systemData.orbitals = [];
            if (!systemData.star)     systemData.star = { name: 'Unknown Star', spectral_class: 'G', radius_km: 696000, color_hex: '#ffcc00' };
            renderTree();
            els['ob-placeholder'].style.display    = 'none';
            els['ob-tree-container'].style.display  = '';
            setStatus(`System loaded: ${systemData.id}`, rel);
        } catch (e) {
            notify(`Failed to load system: ${e.message}`, 'error');
        }
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
            const item = document.createElement('div');
            item.className = `orbital-item${selectedOrbIdx === origIdx ? ' selected' : ''}`;

            item.innerHTML = `
                <span class="orbital-index">#${orb.orbit_index ?? i+1}</span>
                <span class="orbital-icon">${orbitalIcon(orb.type)}</span>
                <span class="orbital-name">${orb.name || orb.id}</span>
                <span class="orbital-type-badge">${orb.type || 'Body'}</span>
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
        els['ob-orb-id'].value    = orb.id || '';
        els['ob-orb-name'].value  = orb.name || '';
        els['ob-orb-type'].value  = orb.type || 'Planet';
        els['ob-orb-index'].value = orb.orbit_index ?? (idx + 1);
        els['ob-orb-file'].value  = orb.file || `data/bodies/${orb.id}.json`;

        // Refresh selected highlight
        document.querySelectorAll('.orbital-item').forEach((el, i) => {
            el.classList.toggle('selected', i === document.querySelectorAll('.orbital-item').length - (document.querySelectorAll('.orbital-item').length - [...document.querySelectorAll('.orbital-item')].findIndex(e => e.querySelector('.orbital-name')?.textContent === (orb.name || orb.id))));
        });
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

    function addOrbital() {
        const newIdx = (systemData.orbitals.length + 1);
        const id = `body_${Date.now()}`;
        systemData.orbitals.push({
            id,
            name: 'New Body',
            type: 'Planet',
            orbit_index: newIdx,
            file: `data/bodies/${id}.json`,
        });
        selectedOrbIdx = systemData.orbitals.length - 1;
        renderTree();
        notify('Orbital added.', 'info');
    }

    function applyOrbitalEdit() {
        if (selectedOrbIdx === null) return;
        const orb = systemData.orbitals[selectedOrbIdx];
        if (!orb) return;
        orb.id          = els['ob-orb-id'].value.trim() || orb.id;
        orb.name        = els['ob-orb-name'].value.trim() || orb.name;
        orb.type        = els['ob-orb-type'].value;
        orb.orbit_index = parseInt(els['ob-orb-index'].value) || orb.orbit_index;
        orb.file        = els['ob-orb-file'].value.trim() || orb.file;
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

    function applyStarEdit() {
        if (!systemData) return;
        systemData.star.name           = els['ob-star-name'].value.trim() || systemData.star.name;
        systemData.star.spectral_class = els['ob-star-class'].value.trim() || systemData.star.spectral_class;
        systemData.star.color_hex      = els['ob-star-color'].value.trim() || systemData.star.color_hex;
        els['ob-star-editor'].style.display = 'none';
        renderTree();
        notify('Star updated.', 'success');
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
            refreshSystemList();
        },
        async loadByFile(rel) {
            await refreshSystemList();
            els['ob-system-select'].value = rel;
            await loadSystemFile(rel);
        },
        reload: refreshSystemList,
    };

})();
