// =============================================================================
//  GEMINI ARCHITECT — Module D: Cartographer
//  City map tile slicer and location JSON exporter
// =============================================================================

const Cartographer = (() => {

    // ── State ──────────────────────────────────────────────────────────────────
    let sourceImage  = null;  // HTMLImageElement
    let imgWidth     = 0;
    let imgHeight    = 0;
    let markers      = [];    // { coords: [x, y], label: string }
    let selectedMark = null;

    // ── DOM refs ───────────────────────────────────────────────────────────────
    const els = {};

    function cacheEls() {
        ['carto-drop-zone','carto-file-input','carto-file-info',
         'carto-filename','carto-dims','carto-tile-size',
         'carto-min-zoom','carto-max-zoom','carto-output-name',
         'carto-preview-btn','carto-export-btn','carto-status',
         'carto-placeholder','carto-preview-container','carto-canvas',
        ].forEach(id => { els[id] = document.getElementById(id); });
    }

    // ── Image loading ──────────────────────────────────────────────────────────
    function loadImageFile(file) {
        if (!file || !file.type.startsWith('image/')) {
            notify('Please select an image file.', 'warning');
            return;
        }

        const reader = new FileReader();
        reader.onload = e => {
            const img = new Image();
            img.onload = () => {
                sourceImage = img;
                imgWidth    = img.naturalWidth;
                imgHeight   = img.naturalHeight;
                markers     = [];
                selectedMark = null;

                els['carto-file-info'].style.display = '';
                els['carto-filename'].textContent    = file.name;
                els['carto-dims'].textContent        = `${imgWidth} × ${imgHeight} px`;
                els['carto-output-name'].value       = file.name.replace(/\.[^.]+$/, '').toLowerCase().replace(/\s+/g,'_');

                // Auto-suggest zoom based on size
                const maxZoom = Math.ceil(Math.log2(Math.max(imgWidth, imgHeight) / 256));
                els['carto-max-zoom'].value = Math.max(2, Math.min(6, maxZoom));

                notify(`Image loaded: ${imgWidth}×${imgHeight}`, 'success');
                setStatus(`Map: ${file.name}`, `${imgWidth}×${imgHeight}px`);
                renderPreview();
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    }

    // ── Preview ────────────────────────────────────────────────────────────────
    function renderPreview() {
        if (!sourceImage) return;

        const tileSize  = parseInt(els['carto-tile-size'].value) || 256;
        const minZoom   = parseInt(els['carto-min-zoom'].value)  || 0;
        const maxZoom   = parseInt(els['carto-max-zoom'].value)  || 4;
        const container = els['carto-preview-container'];
        const canvas    = els['carto-canvas'];

        // Fit image to container (max 1200px wide)
        const maxW  = Math.min(imgWidth, 1200);
        const scale = maxW / imgWidth;
        const dw    = Math.round(imgWidth  * scale);
        const dh    = Math.round(imgHeight * scale);

        canvas.width  = dw;
        canvas.height = dh;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(sourceImage, 0, 0, dw, dh);

        // Draw tile grid for the current zoom level (maxZoom / 2 for clarity)
        const previewZoom = Math.floor((minZoom + maxZoom) / 2);
        const tilesAcross = Math.pow(2, previewZoom);
        const tileW = dw / tilesAcross;
        const tileH = dh / tilesAcross;

        ctx.strokeStyle = 'rgba(0, 210, 255, 0.5)';
        ctx.lineWidth   = 0.5;

        for (let col = 0; col <= tilesAcross; col++) {
            ctx.beginPath();
            ctx.moveTo(col * tileW, 0);
            ctx.lineTo(col * tileW, dh);
            ctx.stroke();
        }
        for (let row = 0; row <= tilesAcross; row++) {
            ctx.beginPath();
            ctx.moveTo(0, row * tileH);
            ctx.lineTo(dw, row * tileH);
            ctx.stroke();
        }

        // Zoom label in corner
        ctx.fillStyle   = 'rgba(0,0,0,0.7)';
        ctx.fillRect(4, 4, 120, 18);
        ctx.fillStyle   = '#00d2ff';
        ctx.font        = '11px Share Tech Mono, monospace';
        ctx.fillText(`Zoom ${previewZoom} — ${tilesAcross}×${tilesAcross} tiles`, 8, 17);

        // Draw markers
        markers.forEach((m, i) => {
            const mx = m.coords[0] * scale;
            const my = m.coords[1] * scale;
            const isSelected = selectedMark === i;

            ctx.beginPath();
            ctx.arc(mx, my, isSelected ? 8 : 5, 0, Math.PI * 2);
            ctx.fillStyle   = isSelected ? '#ffd700' : '#ff6633';
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth   = 1;
            ctx.stroke();

            if (m.label) {
                ctx.fillStyle = 'rgba(0,0,0,0.65)';
                const tw = ctx.measureText(m.label).width;
                ctx.fillRect(mx + 10, my - 10, tw + 6, 16);
                ctx.fillStyle = '#fff';
                ctx.font      = '10px Share Tech Mono, monospace';
                ctx.fillText(m.label, mx + 13, my + 2);
            }
        });

        els['carto-placeholder'].style.display        = 'none';
        els['carto-preview-container'].style.display   = '';

        // Stats
        const totalTiles = calcTotalTiles(minZoom, maxZoom);
        els['carto-status'].textContent =
            `Zoom ${minZoom}–${maxZoom}  |  ${totalTiles} tiles  |  ` +
            `Tile size: ${tileSize}px  |  Markers: ${markers.length}`;
    }

    function calcTotalTiles(minZ, maxZ) {
        let total = 0;
        for (let z = minZ; z <= maxZ; z++) {
            const t = Math.pow(2, z);
            total += t * t;
        }
        return total;
    }

    // ── Canvas interactions (Add markers) ──────────────────────────────────────
    async function handleCanvasClick(e) {
        if (!sourceImage) return;

        const canvas = els['carto-canvas'];
        const rect   = canvas.getBoundingClientRect();
        const scale  = imgWidth / canvas.width;
        const cx = (e.clientX - rect.left) * (canvas.width  / rect.width);
        const cy = (e.clientY - rect.top)  * (canvas.height / rect.height);
        const imgX = Math.round(cx * scale);
        const imgY = Math.round(cy * scale);

        // Check if clicking near existing marker
        const nearScale = canvas.width / imgWidth;
        let best = null, bestDist = 12;
        markers.forEach((m, i) => {
            const d = Math.hypot(cx - m.coords[0] * nearScale, cy - m.coords[1] * nearScale);
            if (d < bestDist) { bestDist = d; best = i; }
        });

        if (best !== null) {
            selectedMark = best;
            const m = markers[best];
            const newLabel = await promptModal('Edit Marker', 'LABEL', m.label);
            if (newLabel === null) { renderPreview(); return; } // cancelled
            if (newLabel === '') {
                markers.splice(best, 1);
                selectedMark = null;
                notify('Marker removed.', 'warning');
            } else {
                m.label = newLabel;
                notify('Marker updated.', 'success');
            }
            renderPreview();
            return;
        }

        // Add new marker
        const label = await promptModal('New Marker', `Label for (${imgX}, ${imgY})`, '');
        if (label === null) return;
        markers.push({ coords: [imgX, imgY], label: label || '' });
        selectedMark = markers.length - 1;
        renderPreview();
        notify('Marker placed.', 'info');
    }

    // ── Export JSON ────────────────────────────────────────────────────────────
    async function exportJSON() {
        if (!sourceImage) { notify('Load an image first.', 'warning'); return; }

        const name    = (els['carto-output-name'].value || 'location').trim().toLowerCase().replace(/\s+/g,'_');
        const minZoom = parseInt(els['carto-min-zoom'].value) || 0;
        const maxZoom = parseInt(els['carto-max-zoom'].value) || 4;

        const locationData = {
            id:         name,
            tile_source: `assets/tiles/${name}/{z}/{x}/{y}.png`,
            min_zoom:   minZoom,
            max_zoom:   maxZoom,
            image_dims: { width: imgWidth, height: imgHeight },
            markers:    markers.map(m => ({
                coords: m.coords,
                label:  m.label,
                npc_presence: [],
            })),
        };

        try {
            const rel = `data/locations/loc_${name}.json`;
            await API.saveFile(rel, locationData);
            notify(`Saved → ${rel}`, 'success', 5000);
            setStatus(`Location exported: ${rel}`);

            // Also show a download link
            const blob = new Blob([JSON.stringify(locationData, null, 2)], { type: 'application/json' });
            const url  = URL.createObjectURL(blob);
            const a    = document.createElement('a');
            a.href     = url;
            a.download = `loc_${name}.json`;
            a.click();
            URL.revokeObjectURL(url);
        } catch (e) {
            notify(`Export failed: ${e.message}`, 'error');
        }
    }

    // ── Tile structure preview info ────────────────────────────────────────────
    function showTileStructure() {
        if (!sourceImage) { notify('Load an image first.', 'warning'); return; }

        const name    = (els['carto-output-name'].value || 'location').trim().toLowerCase();
        const tileSize = parseInt(els['carto-tile-size'].value) || 256;
        const minZoom  = parseInt(els['carto-min-zoom'].value)  || 0;
        const maxZoom  = parseInt(els['carto-max-zoom'].value)  || 4;

        let info = '';
        for (let z = minZoom; z <= maxZoom; z++) {
            const t = Math.pow(2, z);
            info += `  zoom ${z}: ${t}×${t} tiles  (folder: assets/tiles/${name}/${z}/x/y.png)\n`;
        }
        info += `\n  Total: ${calcTotalTiles(minZoom, maxZoom)} tiles`;
        info += `\n  Each tile: ${tileSize}×${tileSize} px`;
        info += `\n\n  ⚠ Tile slicing requires a server-side tool (e.g., gdal2tiles, sharp, vips).`;
        info += `\n  The JSON structure has been saved; use it as a Leaflet tile source.`;

        showModal('Tile Structure', `<pre style="color:#00d2ff;font-size:0.75rem;white-space:pre;max-height:300px;overflow-y:auto">${info}</pre>`);
    }

    // ── Drag & Drop ────────────────────────────────────────────────────────────
    function wireDropZone() {
        const dz = els['carto-drop-zone'];

        dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
        dz.addEventListener('dragleave',() => dz.classList.remove('drag-over'));
        dz.addEventListener('drop', e => {
            e.preventDefault();
            dz.classList.remove('drag-over');
            const file = e.dataTransfer.files[0];
            if (file) loadImageFile(file);
        });

        els['carto-file-input'].addEventListener('change', e => {
            if (e.target.files[0]) loadImageFile(e.target.files[0]);
        });

        dz.addEventListener('click', e => {
            if (e.target !== els['carto-file-input']) els['carto-file-input'].click();
        });
    }

    // ── Event wiring ───────────────────────────────────────────────────────────
    function wireEvents() {
        wireDropZone();
        els['carto-preview-btn'].addEventListener('click', renderPreview);
        els['carto-export-btn'].addEventListener('click', exportJSON);
        els['carto-canvas'].addEventListener('click', handleCanvasClick);

        // Re-render grid on settings change
        ['carto-tile-size','carto-min-zoom','carto-max-zoom'].forEach(id => {
            document.getElementById(id)?.addEventListener('change', () => {
                if (sourceImage) renderPreview();
            });
        });
    }

    // ── Public API ─────────────────────────────────────────────────────────────
    return {
        init() {
            cacheEls();
            wireEvents();
        },
    };

})();
