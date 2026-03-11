// =============================================================================
//  GEMINI ARCHITECT — Settlement Cartographer v3
//  UI controller: drawing modes, density painting, generation
// =============================================================================

const SettlementCartographer = (() => {

    // ── State ───────────────────────────────────────────────────────────────
    let canvas, renderer, settlement = null, animId = null;
    let isPanning = false, lastMouse = { x: 0, y: 0 };
    let mode = 'pan'; // 'pan'|'draw-road'|'draw-park'|'draw-boundary'|'paint-density'
    let drawPts = [];
    let densityBrushValue = 0.8;
    let densityBrushSize = 60;
    let isPainting = false;

    // User-drawn content (preserved across regeneration)
    const userFeatures = { roads: [], parks: [], boundary: null, densityMap: null };

    // ── DOM refs (populated on init) ────────────────────────────────────────
    const el = {};

    function $(id) { return document.getElementById(id); }

    // ── Lifecycle ───────────────────────────────────────────────────────────
    function init() {
        canvas = $('sc-canvas');
        if (!canvas) return;
        renderer = new SettlementRenderer.Renderer(canvas);
        renderer.userFeatures = userFeatures;

        // Cache DOM elements
        const ids = [
            'sc-sidebar', 'carto-sidebar', 'settlement-content', 'carto-content',
            'sc-close-btn', 'sc-size-select', 'sc-population-input', 'sc-seed-input',
            'sc-shape-select', 'sc-auto-btn', 'sc-expand-btn',
            'sc-draw-road-btn', 'sc-draw-park-btn', 'sc-draw-boundary-btn', 'sc-paint-density-btn',
            'sc-drawing-panel', 'sc-clear-drawing-btn', 'sc-confirm-drawing-btn',
            'sc-density-panel', 'sc-brush-size', 'sc-density-high', 'sc-density-med',
            'sc-density-low', 'sc-density-erase', 'sc-density-done',
            'sc-floor-select',
            'sc-debug-toggle', 'sc-debug-panel',
            'sc-density-slider', 'sc-density-val',
            'sc-expansion-slider', 'sc-expansion-val',
            'sc-center-density-slider', 'sc-center-density-val',
            'sc-grid-toggle', 'sc-density-toggle', 'sc-connectors-toggle',
            'sc-regenerate-btn', 'sc-export-btn', 'sc-status'
        ];
        for (const id of ids) el[id] = $(id);

        bindEvents();
        resizeCanvas();
        new ResizeObserver(() => resizeCanvas()).observe(canvas.parentElement);
    }

    function resizeCanvas() {
        if (!canvas || !canvas.parentElement) return;
        const r = canvas.parentElement.getBoundingClientRect();
        canvas.width = r.width * devicePixelRatio;
        canvas.height = r.height * devicePixelRatio;
        canvas.style.width = r.width + 'px';
        canvas.style.height = r.height + 'px';
        if (renderer) renderer.ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    }

    // ── Show / Hide ─────────────────────────────────────────────────────────
    function showDesigner() {
        if (el['carto-sidebar']) el['carto-sidebar'].style.display = 'none';
        if (el['carto-content']) el['carto-content'].style.display = 'none';
        if (el['sc-sidebar']) el['sc-sidebar'].style.display = '';
        if (el['settlement-content']) el['settlement-content'].style.display = '';
        resizeCanvas();
        startLoop();
    }

    function hideDesigner() {
        if (el['sc-sidebar']) el['sc-sidebar'].style.display = 'none';
        if (el['settlement-content']) el['settlement-content'].style.display = 'none';
        if (el['carto-sidebar']) el['carto-sidebar'].style.display = '';
        if (el['carto-content']) el['carto-content'].style.display = '';
        stopLoop();
    }

    function startLoop() {
        if (animId) return;
        (function loop() { if (renderer) renderer.render(); animId = requestAnimationFrame(loop); })();
    }
    function stopLoop() { if (animId) { cancelAnimationFrame(animId); animId = null; } }

    // ── Mouse / Canvas ──────────────────────────────────────────────────────
    function getWorldPos(e) {
        const r = canvas.getBoundingClientRect();
        const sx = (e.clientX - r.left) * devicePixelRatio;
        const sy = (e.clientY - r.top) * devicePixelRatio;
        return renderer.camera.screenToWorld(sx, sy, canvas);
    }

    function onMouseDown(e) {
        if (e.button === 1 || (e.button === 0 && mode === 'pan')) {
            isPanning = true;
            lastMouse = { x: e.clientX, y: e.clientY };
            canvas.style.cursor = 'grabbing';
            return;
        }
        if (e.button === 0 && mode === 'paint-density') {
            isPainting = true;
            paintDensityAt(e);
            return;
        }
        if (e.button === 0 && (mode === 'draw-road' || mode === 'draw-park' || mode === 'draw-boundary')) {
            const [wx, wy] = getWorldPos(e);
            drawPts.push([wx, wy]);
            renderer.drawingPts = drawPts;
            renderer.drawingMode = mode === 'draw-road' ? 'road' : mode === 'draw-park' ? 'park' : 'boundary';
            updateStatus(`${drawPts.length} point(s) — click to add, Enter/Click CONFIRM to finish, Esc to cancel`);
        }
    }

    function onMouseMove(e) {
        if (isPanning) {
            const dx = (e.clientX - lastMouse.x) / renderer.camera.zoom;
            const dy = (e.clientY - lastMouse.y) / renderer.camera.zoom;
            renderer.camera.tX -= dx; renderer.camera.tY -= dy;
            renderer.camera.x -= dx; renderer.camera.y -= dy;
            lastMouse = { x: e.clientX, y: e.clientY };
            return;
        }
        if (mode === 'paint-density') {
            const [wx, wy] = getWorldPos(e);
            renderer.densityBrush = { x: wx, y: wy, radius: densityBrushSize };
            if (isPainting) paintDensityAt(e);
            return;
        }
        renderer.densityBrush = null;
    }

    function onMouseUp() {
        isPanning = false;
        isPainting = false;
        canvas.style.cursor = mode === 'pan' ? 'grab' : 'crosshair';
    }

    function onWheel(e) {
        e.preventDefault();
        const factor = e.deltaY > 0 ? 0.9 : 1.1;
        renderer.camera.tZ = Math.max(0.01, Math.min(80, renderer.camera.tZ * factor));
    }

    function onKeyDown(e) {
        if (e.key === 'Escape') {
            if (mode.startsWith('draw-')) finishDrawing(false);
            else if (mode === 'paint-density') exitDensityMode();
        }
        if (e.key === 'Enter' && mode.startsWith('draw-')) finishDrawing(true);
    }

    // ── Drawing ─────────────────────────────────────────────────────────────
    function enterDrawMode(m) {
        mode = m;
        drawPts = [];
        renderer.drawingPts = [];
        renderer.drawingMode = m === 'draw-road' ? 'road' : m === 'draw-park' ? 'park' : 'boundary';
        canvas.style.cursor = 'crosshair';
        if (el['sc-drawing-panel']) el['sc-drawing-panel'].style.display = '';
        if (el['sc-density-panel']) el['sc-density-panel'].style.display = 'none';
        highlightDrawBtn(m);
        updateStatus('Click canvas to add points. Enter/CONFIRM to finish. Esc to cancel.');
    }

    function finishDrawing(confirm) {
        if (confirm && drawPts.length >= 2) {
            if (mode === 'draw-road') {
                userFeatures.roads.push({
                    type: "Feature",
                    geometry: { type: "LineString", coordinates: drawPts.slice() },
                    properties: { type: "road", hierarchy: "primary", width: 14, userDrawn: true }
                });
                updateStatus(`Road added (${drawPts.length} pts). Total user roads: ${userFeatures.roads.length}`);
            } else if (mode === 'draw-park' && drawPts.length >= 3) {
                const closed = drawPts.slice();
                closed.push(closed[0].slice());
                userFeatures.parks.push({
                    type: "Feature",
                    geometry: { type: "Polygon", coordinates: [closed] },
                    properties: { type: "park", floor: 0, name: "Custom Park" }
                });
                updateStatus(`Park added. Total user parks: ${userFeatures.parks.length}`);
            } else if (mode === 'draw-boundary' && drawPts.length >= 3) {
                userFeatures.boundary = drawPts.slice();
                updateStatus('Custom boundary set.');
            }
            if (renderer) renderer.invalidate();
        } else {
            updateStatus('Drawing cancelled.');
        }
        drawPts = [];
        renderer.drawingPts = [];
        renderer.drawingMode = null;
        mode = 'pan';
        canvas.style.cursor = 'grab';
        if (el['sc-drawing-panel']) el['sc-drawing-panel'].style.display = 'none';
        highlightDrawBtn(null);
    }

    function clearDrawing() {
        drawPts = [];
        renderer.drawingPts = [];
        updateStatus('Drawing cleared.');
    }

    // ── Density painting ────────────────────────────────────────────────────
    function enterDensityMode() {
        mode = 'paint-density';
        canvas.style.cursor = 'crosshair';
        if (el['sc-density-panel']) el['sc-density-panel'].style.display = '';
        if (el['sc-drawing-panel']) el['sc-drawing-panel'].style.display = 'none';
        highlightDrawBtn('paint-density');

        // Initialize density map if needed
        if (!userFeatures.densityMap && settlement && settlement.densityMap) {
            // Clone from current settlement
            const dm = settlement.densityMap;
            userFeatures.densityMap = {
                cellSize: dm.cellSize, originX: dm.originX, originY: dm.originY,
                cols: dm.cols, rows: dm.rows, cells: new Float32Array(dm.cells)
            };
        } else if (!userFeatures.densityMap) {
            // Create default from current bounds
            const size = el['sc-size-select']?.value || 'medium';
            const radius = { tiny: 300, small: 700, medium: 1500, large: 3000, metropolis: 7000 }[size] || 1500;
            const bounds = { minX: -radius, minY: -radius, maxX: radius, maxY: radius };
            userFeatures.densityMap = SettlementGenerator.createDensityMap(bounds, 0, 0);
        }
        updateStatus('Paint density: LMB to paint. Adjust brush size & value in sidebar.');
    }

    function exitDensityMode() {
        mode = 'pan';
        canvas.style.cursor = 'grab';
        renderer.densityBrush = null;
        if (el['sc-density-panel']) el['sc-density-panel'].style.display = 'none';
        highlightDrawBtn(null);
        updateStatus('Density painting done.');
    }

    function paintDensityAt(e) {
        const dm = userFeatures.densityMap;
        if (!dm) return;
        const [wx, wy] = getWorldPos(e);
        const r = densityBrushSize;
        const c0 = Math.max(0, Math.floor((wx - r - dm.originX) / dm.cellSize));
        const c1 = Math.min(dm.cols - 1, Math.floor((wx + r - dm.originX) / dm.cellSize));
        const r0 = Math.max(0, Math.floor((wy - r - dm.originY) / dm.cellSize));
        const r1 = Math.min(dm.rows - 1, Math.floor((wy + r - dm.originY) / dm.cellSize));
        for (let row = r0; row <= r1; row++) {
            for (let col = c0; col <= c1; col++) {
                const cx = dm.originX + (col + 0.5) * dm.cellSize;
                const cy = dm.originY + (row + 0.5) * dm.cellSize;
                const d = Math.hypot(cx - wx, cy - wy);
                if (d < r) {
                    const falloff = 1 - (d / r);
                    const idx = row * dm.cols + col;
                    dm.cells[idx] = Math.max(0, Math.min(1, dm.cells[idx] + (densityBrushValue - dm.cells[idx]) * falloff * 0.3));
                }
            }
        }
        // Live update the settlement's density map if it exists
        if (settlement) {
            settlement.densityMap = dm;
            if (renderer) renderer.invalidate();
        }
    }

    // ── Generation ──────────────────────────────────────────────────────────
    function generate() {
        const size = el['sc-size-select']?.value || 'medium';
        const population = parseInt(el['sc-population-input']?.value) || 10000;
        const seedVal = el['sc-seed-input']?.value || String(Date.now());
        const shape = el['sc-shape-select']?.value || 'circle';
        const density = parseFloat(el['sc-density-slider']?.value) || 0.6;
        const expansion = parseInt(el['sc-expansion-slider']?.value) || 3;
        const centerDensity = parseFloat(el['sc-center-density-slider']?.value) || 0.8;

        updateStatus('Generating settlement...');

        // Use setTimeout to allow UI to update
        setTimeout(() => {
            try {
                settlement = SettlementGenerator.generate({
                    size, population, seed: seedVal, shape,
                    density, centerDensity, expansionLevel: expansion,
                    userRoads: userFeatures.roads,
                    userParks: userFeatures.parks,
                    customBoundary: userFeatures.boundary,
                    densityMap: userFeatures.densityMap
                });
                renderer.setSettlement(settlement);
                updateFloorSelect();
                const roadCount = settlement.features.filter(f => f.properties.type === 'road').length;
                const bldgCount = settlement.features.filter(f => f.properties.type === 'building').length;
                updateStatus(`Generated: ${roadCount} roads, ${bldgCount} buildings`);
            } catch (err) {
                console.error('Generation error:', err);
                updateStatus('Generation failed: ' + err.message);
            }
        }, 30);
    }

    function updateFloorSelect() {
        const sel = el['sc-floor-select'];
        if (!sel || !settlement) return;
        sel.innerHTML = '';
        for (const f of settlement.floors || [{ floor: 0, name: 'Ground' }]) {
            const opt = document.createElement('option');
            opt.value = f.floor; opt.textContent = `${f.floor}: ${f.name}`;
            sel.appendChild(opt);
        }
    }

    // ── UI helpers ──────────────────────────────────────────────────────────
    function updateStatus(msg) {
        if (el['sc-status']) el['sc-status'].textContent = msg;
    }

    function highlightDrawBtn(activeMode) {
        const map = {
            'draw-road': 'sc-draw-road-btn',
            'draw-park': 'sc-draw-park-btn',
            'draw-boundary': 'sc-draw-boundary-btn',
            'paint-density': 'sc-paint-density-btn'
        };
        for (const [m, id] of Object.entries(map)) {
            const btn = el[id];
            if (btn) btn.style.borderColor = (m === activeMode) ? 'var(--color-success)' : '';
        }
    }

    // ── Event bindings ──────────────────────────────────────────────────────
    function bindEvents() {
        // Canvas
        canvas.addEventListener('mousedown', onMouseDown);
        canvas.addEventListener('mousemove', onMouseMove);
        canvas.addEventListener('mouseup', onMouseUp);
        canvas.addEventListener('mouseleave', onMouseUp);
        canvas.addEventListener('wheel', onWheel, { passive: false });
        canvas.addEventListener('contextmenu', e => e.preventDefault());
        document.addEventListener('keydown', onKeyDown);

        // Back button
        if (el['sc-close-btn']) el['sc-close-btn'].addEventListener('click', hideDesigner);

        // Generate
        if (el['sc-auto-btn']) el['sc-auto-btn'].addEventListener('click', generate);
        if (el['sc-expand-btn']) el['sc-expand-btn'].addEventListener('click', generate);

        // Drawing mode buttons
        if (el['sc-draw-road-btn']) el['sc-draw-road-btn'].addEventListener('click', () => {
            mode === 'draw-road' ? finishDrawing(false) : enterDrawMode('draw-road');
        });
        if (el['sc-draw-park-btn']) el['sc-draw-park-btn'].addEventListener('click', () => {
            mode === 'draw-park' ? finishDrawing(false) : enterDrawMode('draw-park');
        });
        if (el['sc-draw-boundary-btn']) el['sc-draw-boundary-btn'].addEventListener('click', () => {
            mode === 'draw-boundary' ? finishDrawing(false) : enterDrawMode('draw-boundary');
        });
        if (el['sc-paint-density-btn']) el['sc-paint-density-btn'].addEventListener('click', () => {
            mode === 'paint-density' ? exitDensityMode() : enterDensityMode();
        });

        // Drawing panel buttons
        if (el['sc-clear-drawing-btn']) el['sc-clear-drawing-btn'].addEventListener('click', clearDrawing);
        if (el['sc-confirm-drawing-btn']) el['sc-confirm-drawing-btn'].addEventListener('click', () => finishDrawing(true));

        // Density panel
        if (el['sc-brush-size']) el['sc-brush-size'].addEventListener('input', e => {
            densityBrushSize = parseFloat(e.target.value);
        });
        if (el['sc-density-high']) el['sc-density-high'].addEventListener('click', () => { densityBrushValue = 1.0; highlightDensityBtn('high'); });
        if (el['sc-density-med'])  el['sc-density-med'].addEventListener('click',  () => { densityBrushValue = 0.5; highlightDensityBtn('med'); });
        if (el['sc-density-low'])  el['sc-density-low'].addEventListener('click',  () => { densityBrushValue = 0.2; highlightDensityBtn('low'); });
        if (el['sc-density-erase']) el['sc-density-erase'].addEventListener('click', () => { densityBrushValue = 0;   highlightDensityBtn('erase'); });
        if (el['sc-density-done']) el['sc-density-done'].addEventListener('click', exitDensityMode);

        function highlightDensityBtn(which) {
            for (const k of ['high', 'med', 'low', 'erase']) {
                const b = el[`sc-density-${k}`];
                if (b) b.style.borderColor = (k === which) ? 'var(--color-success)' : '';
            }
        }

        // Floor select
        if (el['sc-floor-select']) el['sc-floor-select'].addEventListener('change', e => {
            if (renderer) renderer.currentFloor = parseInt(e.target.value);
        });

        // Debug panel
        if (el['sc-debug-toggle']) el['sc-debug-toggle'].addEventListener('click', () => {
            const p = el['sc-debug-panel'];
            if (p) p.style.display = p.style.display === 'none' ? '' : 'none';
        });
        if (el['sc-density-slider']) el['sc-density-slider'].addEventListener('input', e => {
            if (el['sc-density-val']) el['sc-density-val'].textContent = parseFloat(e.target.value).toFixed(2);
        });
        if (el['sc-expansion-slider']) el['sc-expansion-slider'].addEventListener('input', e => {
            if (el['sc-expansion-val']) el['sc-expansion-val'].textContent = e.target.value;
        });
        if (el['sc-center-density-slider']) el['sc-center-density-slider'].addEventListener('input', e => {
            if (el['sc-center-density-val']) el['sc-center-density-val'].textContent = parseFloat(e.target.value).toFixed(2);
        });
        if (el['sc-grid-toggle']) el['sc-grid-toggle'].addEventListener('change', e => {
            if (renderer) renderer.showGrid = e.target.checked;
        });
        if (el['sc-density-toggle']) el['sc-density-toggle'].addEventListener('change', e => {
            if (renderer) renderer.showDensity = e.target.checked;
        });
        if (el['sc-regenerate-btn']) el['sc-regenerate-btn'].addEventListener('click', generate);

        // Export
        if (el['sc-export-btn']) el['sc-export-btn'].addEventListener('click', () => {
            if (!settlement) { updateStatus('Nothing to export'); return; }
            const blob = new Blob([JSON.stringify(SettlementGenerator.toGeoJSON(settlement), null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `${settlement.name || 'settlement'}.geojson`;
            a.click(); URL.revokeObjectURL(a.href);
            updateStatus('Exported.');
        });

        // Open from cartographer  
        const openBtn = $('carto-open-settlement-btn');
        if (openBtn) openBtn.addEventListener('click', showDesigner);
    }

    // ── Public ──────────────────────────────────────────────────────────────
    return {
        init,
        showDesigner,
        hideDesigner,
        getSettlement: () => settlement,
        getUserFeatures: () => userFeatures,
        clearUserFeatures() {
            userFeatures.roads = [];
            userFeatures.parks = [];
            userFeatures.boundary = null;
            userFeatures.densityMap = null;
        }
    };
})();

// Auto-init when DOM ready
if (typeof document !== 'undefined') {
    document.addEventListener('DOMContentLoaded', () => SettlementCartographer.init());
}
