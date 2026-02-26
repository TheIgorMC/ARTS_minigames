// =============================================================================
//  GEMINI ARCHITECT — Module A: Galaxy Plotter  (v2 — Full Hierarchy)
//
//  Navigation:
//    Galaxy View  →  double-click sector polygon  →  Sector View
//    ←  Back button  ←
//
//  Galaxy view : sector polygons on infinite canvas (Konva)
//  Sector view : system nodes + jump lanes (Konva)
//  Scatter     : density-brush painting → weighted random placement
// =============================================================================

const GalaxyPlotter = (() => {

    // ── Konva layers ───────────────────────────────────────────────────────────
    let stage        = null;
    let bgLayer      = null;   // infinite grid
    let refLayer     = null;   // background reference image
    let polyLayer    = null;   // sector polygons  (galaxy view)
    let laneLayer    = null;   // jump lanes       (sector view)
    let nodeLayer    = null;   // system nodes / labels
    let previewLayer = null;   // in-progress polygon draw preview
    let refImageNode = null;   // Konva.Image for the reference

    // ── View state ─────────────────────────────────────────────────────────────
    let viewMode = 'galaxy';   // 'galaxy' | 'sector'

    // Galaxy view state
    let universe         = null;
    let selectedSectorId = null;
    let galaxyTool       = 'select';  // 'select' | 'draw' | 'gdelete'
    let polyVertices     = [];        // [{x,y}] in-progress polygon

    // Vertex snap (draw mode)
    let snapEnabled  = true;
    let snapThreshPx = 18;   // screen-pixel radius for snap

    // Sector view state
    let sectorData     = null;
    let activeSectorId = null;
    let sectorTool     = 'select';    // 'select'|'add'|'lane'|'scatter'|'delete'
    let selectedNode   = null;        // { id, group }
    let selectedLane   = null;        // { from, to, line }
    let laneSource     = null;

    // Scatter state
    const DENSITY_W     = 256;
    const DENSITY_H     = 256;
    let densityGrid     = new Float32Array(DENSITY_W * DENSITY_H);
    let previewSystems  = null;   // [{x,y,name}] | null
    let scatterPainting = false;
    let scatterErasing  = false;

    // Distinct palette for sectors
    const SECTOR_PALETTE = [
        '#00d2ff','#ff6600','#aa44ff','#00cc44',
        '#ffaa00','#ff3366','#44aaff','#cc88ff',
        '#ff8800','#00ffaa','#ff44dd','#88ff00',
    ];

    const STATUS_COLORS = {
        'Colonized':'#00cc44','Frontier':'#00d2ff','Contested':'#ffaa00',
        'Abandoned':'#555','Unknown':'#444',
    };

    // ── DOM cache ──────────────────────────────────────────────────────────────
    const e = {};
    function cacheEls() {
        [
            // Galaxy sidebar
            'gp-sidebar-galaxy','gp-sidebar-sector',
            'gp-galaxy-save','gp-galaxy-fit',
            'gp-gtool-select','gp-gtool-draw','gp-gtool-delete',
            'gp-sector-props','gp-sec-name','gp-sec-color','gp-sec-color-picker',
            'gp-sec-vert-count','gp-sec-apply','gp-sec-enter','gp-sec-forge',
            'gp-count-sectors',
            // Sector sidebar
            'gp-back-galaxy','gp-sector-title','gp-save-sector',
            'gp-tool-select','gp-tool-add','gp-tool-lane',
            'gp-tool-scatter','gp-tool-delete',
            'gp-node-editor','gp-node-id','gp-node-name','gp-node-align',
            'gp-node-status','gp-node-file','gp-node-x','gp-node-y',
            'gp-node-apply','gp-node-open-system','gp-node-forge',
            'gp-forge-all','gp-forge-progress',
            'gp-lane-editor','gp-lane-endpoints','gp-lane-dist',
            'gp-lane-type','gp-lane-apply','gp-lane-delete',
            // Scatter panel
            'gp-scatter-panel',
            'gp-scat-size','gp-scat-size-val',
            'gp-scat-strength','gp-scat-strength-val',
            'gp-scat-count','gp-scat-minsep','gp-scat-prefix',
            'gp-scat-seed','gp-scat-randseed',
            'gp-scat-preview','gp-scat-clear-density','gp-scat-commit',
            'gp-scat-info',
            // Canvas / misc
            'gp-fit','gp-count-systems','gp-count-lanes',
            'gp-canvas-hint','gp-canvas-container',
            'gp-density-canvas','gp-brush-cursor',
            // Draw options + background reference
            'gp-snap-enabled','gp-snap-thresh',
            'gp-ref-file','gp-ref-load','gp-ref-controls',
            'gp-ref-opacity','gp-ref-opacity-val','gp-ref-toggle','gp-ref-clear',
        ].forEach(id => { e[id] = document.getElementById(id); });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  KONVA SETUP
    // ═══════════════════════════════════════════════════════════════════════════
    function setupStage() {
        const parent = e['gp-canvas-container'];

        stage = new Konva.Stage({
            container: 'gp-canvas',
            width:  parent.clientWidth,
            height: parent.clientHeight,
        });

        bgLayer      = new Konva.Layer();
        refLayer     = new Konva.Layer();   // background reference image
        polyLayer    = new Konva.Layer();
        laneLayer    = new Konva.Layer();
        nodeLayer    = new Konva.Layer();
        previewLayer = new Konva.Layer();

        stage.add(bgLayer, refLayer, polyLayer, laneLayer, nodeLayer, previewLayer);
        drawGrid();

        // ── Pan (middle or right mouse) ──────────────────────────────────────
        let isPanning = false, panStart = {};
        stage.on('mousedown', ev => {
            if (ev.evt.button === 1 || ev.evt.button === 2) {
                isPanning = true;
                panStart  = { x: ev.evt.clientX - nodeLayer.x(), y: ev.evt.clientY - nodeLayer.y() };
                stage.container().style.cursor = 'grabbing';
                ev.evt.preventDefault();
            }
        });
        window.addEventListener('mousemove', ev => {
            if (!isPanning) return;
            const nx = ev.clientX - panStart.x, ny = ev.clientY - panStart.y;
            [bgLayer, refLayer, polyLayer, laneLayer, nodeLayer, previewLayer].forEach(l => l.position({ x: nx, y: ny }));
        });
        window.addEventListener('mouseup', ev => {
            if (isPanning && (ev.button === 1 || ev.button === 2)) {
                isPanning = false;
                stage.container().style.cursor = 'default';
            }
        });
        stage.container().addEventListener('contextmenu', ev => ev.preventDefault());

        // ── Zoom ─────────────────────────────────────────────────────────────
        stage.on('wheel', ev => {
            ev.evt.preventDefault();
            const factor   = 1.08;
            const oldScale = nodeLayer.scaleX();
            const ptr      = stage.getPointerPosition();
            const mpx = (ptr.x - nodeLayer.x()) / oldScale;
            const mpy = (ptr.y - nodeLayer.y()) / oldScale;
            const ns  = Math.max(0.05, Math.min(6, ev.evt.deltaY < 0 ? oldScale * factor : oldScale / factor));
            [bgLayer, refLayer, polyLayer, laneLayer, nodeLayer, previewLayer].forEach(l => {
                l.scale({x:ns,y:ns});
                l.position({x: ptr.x - mpx*ns, y: ptr.y - mpy*ns});
            });
            syncDensityCanvasSize();
        });

        // ── Stage click / mousemove dispatch ──────────────────────────────────
        stage.on('click', ev => {
            if (ev.evt.button !== 0) return;
            const pos = scenePos(ev.evt);
            if (viewMode === 'galaxy') {
                handleGalaxyClick(pos, ev);
            } else {
                if (sectorTool === 'add' && sectorData) { addSystem(pos.x, pos.y); return; }
                if (ev.target === stage || ev.target.getLayer() === bgLayer) deselectAll();
            }
        });

        stage.on('dblclick', ev => {
            if (viewMode === 'galaxy' && galaxyTool === 'draw') {
                finishPolygon();
                ev.evt.preventDefault();
            }
        });

        stage.on('mousemove', ev => {
            const pos  = scenePos(ev.evt);
            if (viewMode === 'galaxy' && galaxyTool === 'draw') {
                const snap = getSnapTarget(pos.x, pos.y);
                const cur  = snap || pos;
                if (polyVertices.length > 0) {
                    drawPolyPreview(cur, snap);
                } else {
                    // No vertices yet — just show snap indicator if near a vertex
                    previewLayer.destroyChildren();
                    if (snap) drawSnapIndicator(snap.x, snap.y);
                }
            }
        });

        // ── Scatter paint ─────────────────────────────────────────────────────
        stage.on('mousedown', ev => {
            if (viewMode !== 'sector' || sectorTool !== 'scatter') return;
            scatterErasing  = ev.evt.button === 2;
            scatterPainting = true;
            paintAtEvent(ev.evt);
        });
        window.addEventListener('mousemove', ev => {
            if (viewMode !== 'sector' || sectorTool !== 'scatter') return;
            updateBrushCursor(ev);
            if (scatterPainting) paintAtEvent(ev);
        });
        window.addEventListener('mouseup', () => { scatterPainting = false; });

        // ── Keyboard ──────────────────────────────────────────────────────────
        window.addEventListener('keydown', ev => {
            if (ev.key === 'Escape') {
                if (viewMode === 'galaxy' && galaxyTool === 'draw') cancelPolygon();
                scatterPainting = false;
            }
            if ((ev.ctrlKey || ev.metaKey) && ev.key === 's') {
                ev.preventDefault();
                if (viewMode === 'galaxy') saveAll();
                else saveSector();
            }
            if (ev.key === 'Delete' || ev.key === 'Backspace') {
                if (viewMode === 'galaxy' && selectedSectorId) deleteGalaxySectorById(selectedSectorId);
                if (viewMode === 'sector') {
                    if (selectedNode) deleteSystem(selectedNode.id);
                    else if (selectedLane) deleteLane(selectedLane.from, selectedLane.to);
                }
            }
        });

        // ── Resize ────────────────────────────────────────────────────────────
        window.addEventListener('resize', () => {
            stage.width(parent.clientWidth);
            stage.height(parent.clientHeight);
            drawGrid();
            syncDensityCanvasSize();
        });
    }

    function scenePos(evt) {
        const rect  = stage.container().getBoundingClientRect();
        const scale = nodeLayer.scaleX();
        return {
            x: (evt.clientX - rect.left - nodeLayer.x()) / scale,
            y: (evt.clientY - rect.top  - nodeLayer.y()) / scale,
        };
    }

    function drawGrid() {
        bgLayer.destroyChildren();
        const w = stage.width() * 12, h = stage.height() * 12;
        const step = 50, ox = -w / 2, oy = -h / 2;
        for (let x = ox; x < w; x += step)
            bgLayer.add(new Konva.Line({ points:[x,oy,x,h], stroke:'#0d1a1a', strokeWidth:1, listening:false }));
        for (let y = oy; y < h; y += step)
            bgLayer.add(new Konva.Line({ points:[ox,y,w,y], stroke:'#0d1a1a', strokeWidth:1, listening:false }));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  BREADCRUMB
    // ═══════════════════════════════════════════════════════════════════════════
    function setBreadcrumb(parts) {
        const chain = document.getElementById('breadcrumb-chain');
        if (!chain) return;
        chain.innerHTML = '';
        parts.forEach((p, i) => {
            const span = document.createElement('span');
            span.className = 'bc-crumb' + (i === parts.length - 1 ? ' bc-active' : '');
            span.textContent = p.label;
            if (p.onClick && i < parts.length - 1) span.addEventListener('click', p.onClick);
            chain.appendChild(span);
            if (i < parts.length - 1) {
                const sep = document.createElement('span');
                sep.className = 'bc-sep';
                sep.textContent = ' ▸ ';
                chain.appendChild(sep);
            }
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  GALAXY VIEW
    // ═══════════════════════════════════════════════════════════════════════════
    async function enterGalaxyView() {
        viewMode = 'galaxy';
        if(e['gp-sidebar-galaxy']) e['gp-sidebar-galaxy'].style.display = '';
        if(e['gp-sidebar-sector']) e['gp-sidebar-sector'].style.display = 'none';
        const cc = e['gp-canvas-container'];
        if(cc) { cc.classList.remove('scatter-mode','draw-mode'); }
        hideDensityCanvas();
        hideBrushCursor();
        if(polyLayer) polyLayer.show();
        if(refLayer)  refLayer.show();

        universe = await API.getUniverse();
        const cnd = document.getElementById('campaign-name-display');
        if(cnd) cnd.textContent = universe.campaign_name || '—';

        renderGalaxy();
        setBreadcrumb([{ label: 'Galaxy' }]);
        setStatus('Galaxy view — ' + (universe.sectors_index?.length ?? 0) + ' sectors');
        const hint = e['gp-canvas-hint'];
        if(hint) hint.style.display = universe.sectors_index?.length ? 'none' : '';
    }

    function renderGalaxy() {
        polyLayer.destroyChildren();
        laneLayer.destroyChildren();
        nodeLayer.destroyChildren();
        previewLayer.destroyChildren();

        const sectors = universe?.sectors_index ?? [];
        sectors.forEach((entry, i) => {
            if (!entry.color) entry.color = SECTOR_PALETTE[i % SECTOR_PALETTE.length];
            if (!entry.polygon || entry.polygon.length < 3) return;
            createSectorPolygon(entry, entry.color);
        });

        if(e['gp-count-sectors']) e['gp-count-sectors'].textContent = sectors.length;
    }

    function sectorCentroid(polygon) {
        return {
            x: polygon.reduce((s,v) => s + v.x, 0) / polygon.length,
            y: polygon.reduce((s,v) => s + v.y, 0) / polygon.length,
        };
    }

    // Ray-casting point-in-polygon test (polygon = [{x,y}])
    function pointInPolygon(px, py, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i].x, yi = poly[i].y;
            const xj = poly[j].x, yj = poly[j].y;
            if (((yi > py) !== (yj > py)) &&
                (px < (xj - xi) * (py - yi) / (yj - yi) + xi)) {
                inside = !inside;
            }
        }
        return inside;
    }

    // Shoelace polygon area
    function polygonArea(poly) {
        let area = 0;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            area += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
        }
        return Math.abs(area / 2);
    }

    // Scatter N points inside a polygon with area-adaptive minimum separation
    // Uses Poisson-disk rejection sampling so no two nodes are closer than minDist
    function scatterInPolygon(poly, n, margin) {
        if (!poly || poly.length < 3) return [];
        const xs   = poly.map(v => v.x), ys = poly.map(v => v.y);
        const minX = Math.min(...xs) + margin, maxX = Math.max(...xs) - margin;
        const minY = Math.min(...ys) + margin, maxY = Math.max(...ys) - margin;
        if (maxX <= minX || maxY <= minY) return [];

        // Adaptive minimum distance: fill the polygon area evenly
        const area    = polygonArea(poly);
        const minDist = Math.max(margin * 1.5, Math.sqrt(area / Math.max(n, 1)) * 0.72);

        const pts  = [];
        let tries  = 0;
        const maxTries = n * 500;

        while (pts.length < n && tries < maxTries) {
            tries++;
            const x = minX + Math.random() * (maxX - minX);
            const y = minY + Math.random() * (maxY - minY);
            if (!pointInPolygon(x, y, poly)) continue;
            // Reject if too close to an existing node
            let tooClose = false;
            for (const p of pts) {
                if (Math.hypot(x - p.x, y - p.y) < minDist) { tooClose = true; break; }
            }
            if (!tooClose) pts.push({ x: Math.round(x), y: Math.round(y) });
        }
        return pts;
    }

    function createSectorPolygon(entry, color) {
        const pts      = entry.polygon.flatMap(v => [v.x, v.y]);
        const isSel    = entry.id === selectedSectorId;

        const poly = new Konva.Line({
            points: pts, closed: true,
            fill:        hexAlpha(color, isSel ? 0.18 : 0.08),
            stroke:      color,
            strokeWidth: isSel ? 2.5 : 1.5,
            opacity:     isSel ? 1 : 0.7,
        });

        poly.on('mouseenter', () => {
            stage.container().style.cursor = galaxyTool === 'gdelete' ? 'not-allowed' : 'pointer';
            poly.fill(hexAlpha(color, 0.22));
            poly.strokeWidth(2.5);
        });
        poly.on('mouseleave', () => {
            stage.container().style.cursor = 'default';
            poly.fill(hexAlpha(color, isSel ? 0.18 : 0.08));
            poly.strokeWidth(isSel ? 2.5 : 1.5);
        });
        poly.on('click', ev => {
            ev.cancelBubble = true;
            if (galaxyTool === 'gdelete') { deleteGalaxySectorById(entry.id); return; }
            selectGalaxySector(entry.id);
        });
        poly.on('dblclick', ev => {
            ev.cancelBubble = true;
            enterSectorView(entry.id);
        });
        polyLayer.add(poly);

        const c   = sectorCentroid(entry.polygon);
        const lbl = new Konva.Text({
            x: c.x, y: c.y,
            text: entry.name || entry.id,
            fontSize: 14,
            fontFamily: 'Share Tech Mono, monospace',
            fill: color, opacity: 0.9, listening: false,
        });
        lbl.offsetX(lbl.width()/2);
        lbl.offsetY(lbl.height()/2);
        nodeLayer.add(lbl);
    }

    function selectGalaxySector(id) {
        selectedSectorId = id;
        const entry = universe.sectors_index.find(s => s.id === id);
        if (!entry) return;
        if(e['gp-sector-props'])   e['gp-sector-props'].style.display   = '';
        if(e['gp-sec-name'])       e['gp-sec-name'].value                = entry.name || '';
        if(e['gp-sec-color'])      e['gp-sec-color'].value               = entry.color || '#00d2ff';
        try { if(e['gp-sec-color-picker']) e['gp-sec-color-picker'].value = entry.color || '#00d2ff'; } catch(_){}
        if(e['gp-sec-vert-count']) e['gp-sec-vert-count'].textContent    = entry.polygon?.length ?? 0;
        renderGalaxy();
        setStatus('Sector: ' + (entry.name || entry.id));
    }

    function deselectGalaxySector() {
        selectedSectorId = null;
        if(e['gp-sector-props']) e['gp-sector-props'].style.display = 'none';
        renderGalaxy();
    }

    // ── Polygon drawing ────────────────────────────────────────────────────────

    /**
     * Return the nearest existing sector vertex within snapThreshPx screen
     * pixels of (sceneX, sceneY), or null if nothing is close enough.
     */
    function getSnapTarget(sceneX, sceneY) {
        if (!snapEnabled) return null;
        const scale = nodeLayer.scaleX();
        let best = null, bestD = snapThreshPx;
        for (const entry of (universe?.sectors_index ?? [])) {
            for (const v of (entry.polygon ?? [])) {
                const d = Math.hypot((v.x - sceneX) * scale, (v.y - sceneY) * scale);
                if (d < bestD) { bestD = d; best = { x: v.x, y: v.y }; }
            }
        }
        return best;
    }

    function drawSnapIndicator(x, y) {
        const sz = 9;
        previewLayer.add(new Konva.Rect({
            x: x - sz / 2, y: y - sz / 2, width: sz, height: sz,
            stroke: '#00ffcc', strokeWidth: 1.5,
            fill: 'rgba(0,255,204,0.18)', listening: false,
        }));
        previewLayer.add(new Konva.Text({
            x: x + sz, y: y - 7,
            text: '⊝ snap', fontSize: 8,
            fontFamily: 'Share Tech Mono,monospace',
            fill: '#00ffcc', opacity: 0.85, listening: false,
        }));
    }

    function startDrawMode() {
        setGalaxyTool('draw');
        polyVertices = [];
        previewLayer.destroyChildren();
        const cc = e['gp-canvas-container'];
        if(cc) cc.classList.add('draw-mode');
        setStatus('Draw sector: click vertices, double-click or click first vertex to close, ESC to cancel');
    }

    function handleGalaxyClick(pos, ev) {
        if (galaxyTool === 'select' && (ev.target === stage || ev.target.getLayer() === bgLayer)) {
            deselectGalaxySector(); return;
        }
        if (galaxyTool !== 'draw') return;

        // Click near first vertex → close
        if (polyVertices.length >= 3) {
            const fv    = polyVertices[0];
            const pxDst = Math.hypot(pos.x - fv.x, pos.y - fv.y) * nodeLayer.scaleX();
            if (pxDst < 15) { finishPolygon(); return; }
        }
        // Snap to nearest existing sector vertex
        const snap = getSnapTarget(pos.x, pos.y);
        const vx   = snap ? snap.x : Math.round(pos.x);
        const vy   = snap ? snap.y : Math.round(pos.y);
        polyVertices.push({ x: vx, y: vy });
        drawPolyPreview({ x: vx, y: vy }, snap);
        if (snap) setStatus('⊝ Snapped to existing vertex (' + vx + ', ' + vy + ')');
    }

    function drawPolyPreview(cursor, snapTarget) {
        previewLayer.destroyChildren();
        if (!polyVertices.length) return;

        const allPts = polyVertices.flatMap(v => [v.x, v.y]);
        previewLayer.add(new Konva.Line({
            points: allPts, stroke:'#ffd700', strokeWidth:1.5, dash:[6,3], listening:false,
        }));

        if (cursor) {
            const last = polyVertices[polyVertices.length - 1];
            previewLayer.add(new Konva.Line({
                points:[last.x, last.y, cursor.x, cursor.y],
                stroke: snapTarget ? '#00ffcc' : '#ffaa00',
                strokeWidth:1, dash:[4,4], listening:false,
            }));
        }

        polyVertices.forEach((v, i) => {
            previewLayer.add(new Konva.Circle({
                x:v.x, y:v.y,
                radius: i===0 ? 7 : 4,
                fill:   i===0 ? '#ffd700' : '#ffaa00',
                stroke:'#fff', strokeWidth:1, listening:false,
            }));
        });

        const fv = polyVertices[0];
        previewLayer.add(new Konva.Text({
            x: fv.x+10, y: fv.y-14,
            text: polyVertices.length + ' pts — dblclick or click ● to close',
            fontSize:10, fontFamily:'Share Tech Mono,monospace', fill:'#ffd700', listening:false,
        }));

        // Snap indicator at cursor position
        if (snapTarget && cursor) drawSnapIndicator(cursor.x, cursor.y);
    }

    async function finishPolygon() {
        if (polyVertices.length < 3) { notify('Need at least 3 vertices.','warning'); return; }
        const name = await promptModal('New Sector','SECTOR NAME','New Sector');
        if (!name) { cancelPolygon(); return; }

        const id    = 'sec_' + name.toLowerCase().replace(/[^a-z0-9]+/g,'_');
        const file  = 'data/sectors/' + id + '.json';
        const color = SECTOR_PALETTE[(universe.sectors_index?.length ?? 0) % SECTOR_PALETTE.length];

        try {
            await API.saveFile(file, {
                id, name,
                dimensions: { width:1000, height:1000 },
                systems:[], jump_lanes:[],
            });
            if (!universe.sectors_index) universe.sectors_index = [];
            universe.sectors_index.push({ id, name, file, color, polygon:[...polyVertices] });
            await API.saveUniverse(universe);
            cancelPolygon();
            renderGalaxy();
            selectGalaxySector(id);
            notify('Sector "' + name + '" created.', 'success');
        } catch(err) {
            notify('Error: ' + err.message,'error');
            cancelPolygon();
        }
    }

    function cancelPolygon() {
        polyVertices = [];
        previewLayer.destroyChildren();
        const cc = e['gp-canvas-container'];
        if(cc) cc.classList.remove('draw-mode');
        setGalaxyTool('select');
    }

    // ── Galaxy CRUD ────────────────────────────────────────────────────────────
    async function saveAll() {
        try { await API.saveUniverse(universe); notify('Universe saved.','success'); }
        catch(err) { notify(err.message,'error'); }
    }

    async function deleteGalaxySectorById(id) {
        const entry = universe.sectors_index.find(s => s.id === id);
        const ok = await showModal(
            'Delete Sector',
            'Remove <b>' + (entry?.name || id) + '</b> from the galaxy?<br>' +
            '<small style="color:#888">The sector JSON file is kept.</small>'
        );
        if (!ok) return;
        universe.sectors_index = universe.sectors_index.filter(s => s.id !== id);
        await API.saveUniverse(universe);
        if (selectedSectorId === id) { selectedSectorId = null; if(e['gp-sector-props']) e['gp-sector-props'].style.display='none'; }
        renderGalaxy();
        notify('Sector removed from galaxy.','warning');
    }

    function fitGalaxy() {
        const pts = (universe?.sectors_index ?? []).flatMap(s => s.polygon ?? []);
        if (pts.length) fitPoints(pts);
    }

    function setGalaxyTool(tool) {
        galaxyTool = tool;
        document.querySelectorAll('[data-gtool]').forEach(b => b.classList.remove('active'));
        const btn = document.querySelector('[data-gtool="' + tool + '"]');
        if(btn) btn.classList.add('active');
        const cc = e['gp-canvas-container'];
        if (tool !== 'draw' && cc) cc.classList.remove('draw-mode');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  SECTOR VIEW
    // ═══════════════════════════════════════════════════════════════════════════
    async function enterSectorView(sectorId) {
        const entry = universe.sectors_index.find(s => s.id === sectorId);
        if (!entry) { notify('Sector not found: ' + sectorId,'error'); return; }

        viewMode       = 'sector';
        activeSectorId = sectorId;

        if(e['gp-sidebar-galaxy']) e['gp-sidebar-galaxy'].style.display = 'none';
        if(e['gp-sidebar-sector']) e['gp-sidebar-sector'].style.display = '';
        if(e['gp-sector-title'])   e['gp-sector-title'].textContent     = entry.name || sectorId;
        if(e['gp-canvas-hint'])    e['gp-canvas-hint'].style.display    = 'none';

        try {
            sectorData = await API.getFile(entry.file);
        } catch(err) {
            notify('Could not load sector: ' + err.message,'error'); return;
        }

        polyLayer.hide();
        if(refLayer) refLayer.hide();

        setBreadcrumb([
            { label:'Galaxy', onClick: goBackToGalaxy },
            { label: entry.name || sectorId },
        ]);

        setSectorTool('select');
        renderSector();
        fitSector();
        setStatus('Sector: ' + entry.name, entry.file);
    }

    async function goBackToGalaxy() {
        deselectAll();
        clearDensity();
        hideDensityCanvas();
        hideBrushCursor();
        if(e['gp-scatter-panel']) e['gp-scatter-panel'].style.display = 'none';
        await enterGalaxyView();
    }

    // ── Sector render ──────────────────────────────────────────────────────────
    function renderSector() {
        laneLayer.destroyChildren();
        nodeLayer.destroyChildren();
        if (!sectorData) return;

        (sectorData.jump_lanes ?? []).forEach(lane => {
            const f = sectorData.systems.find(s => s.id === lane.from);
            const t = sectorData.systems.find(s => s.id === lane.to);
            if (f && t) createLaneShape(lane, f, t);
        });

        (sectorData.systems ?? []).forEach(sys => createNodeShape(sys));

        if (previewSystems) previewSystems.forEach(ps => drawPreviewDot(ps));

        updateCounts();
    }

    function createNodeShape(sys) {
        const color = STATUS_COLORS[sys.status] || '#00d2ff';
        const group = new Konva.Group({ x:sys.coordinates.x, y:sys.coordinates.y, id:sys.id, draggable:true });

        const glow   = new Konva.Circle({ radius:20, fill:'transparent', stroke:color, strokeWidth:1, opacity:0.3, listening:false });
        const circle = new Konva.Circle({ radius:16, fill:'#0a0a12', stroke:color, strokeWidth:2 });
        const lbl    = new Konva.Text({ text:sys.name, y:22, fontSize:11, fontFamily:'Share Tech Mono,monospace', fill:color, listening:false });
        lbl.offsetX(lbl.width()/2);

        group.add(glow, circle, lbl);

        group.on('mouseenter', () => {
            if (sectorTool === 'scatter') return;
            stage.container().style.cursor = sectorTool === 'delete' ? 'not-allowed' : 'pointer';
            circle.strokeWidth(3); glow.opacity(0.6);
        });
        group.on('mouseleave', () => {
            if (sectorTool === 'scatter') return;
            stage.container().style.cursor = 'default';
            circle.strokeWidth( selectedNode?.id === sys.id ? 3 : 2 );
            glow.opacity( selectedNode?.id === sys.id ? 0.5 : 0.3 );
        });
        group.on('click', ev => {
            if (sectorTool === 'scatter') return;
            ev.cancelBubble = true;
            handleNodeClick(sys.id, group);
        });
        group.on('dragmove', () => {
            sys.coordinates.x = Math.round(group.x());
            sys.coordinates.y = Math.round(group.y());
            if (selectedNode?.id === sys.id) {
                if(e['gp-node-x']) e['gp-node-x'].value = sys.coordinates.x;
                if(e['gp-node-y']) e['gp-node-y'].value = sys.coordinates.y;
            }
            redrawLanes();
        });

        nodeLayer.add(group);
    }

    function drawPreviewDot(ps) {
        const dot = new Konva.Circle({
            x:ps.x, y:ps.y, radius:8,
            fill:'rgba(255,215,0,0.12)', stroke:'#ffd700', strokeWidth:1, dash:[3,3],
            listening:false, name:'preview-dot',
        });
        const lbl = new Konva.Text({
            x:ps.x, y:ps.y+12, text:ps.name,
            fontSize:8, fontFamily:'Share Tech Mono,monospace',
            fill:'#ffd700', opacity:0.6, listening:false, name:'preview-dot',
        });
        lbl.offsetX(lbl.width()/2);
        nodeLayer.add(dot, lbl);
    }

    function createLaneShape(lane, fromSys, toSys) {
        const LCOL = { Stable:'#00d2ff',Unstable:'#ffaa00',Drift:'#aa44ff',Restricted:'#ff3333' };
        const color = LCOL[lane.type] || '#444';
        const line  = new Konva.Line({
            points:[fromSys.coordinates.x,fromSys.coordinates.y, toSys.coordinates.x,toSys.coordinates.y],
            stroke:color, strokeWidth:1.5, opacity:0.6,
            dash: lane.type === 'Drift' ? [8,4] : undefined,
        });
        const mx = (fromSys.coordinates.x + toSys.coordinates.x)/2;
        const my = (fromSys.coordinates.y + toSys.coordinates.y)/2;
        const dLabel = new Konva.Text({
            x:mx, y:my-10,
            text: (lane.distance||0).toFixed(1) + ' ly',
            fontSize:9, fontFamily:'Share Tech Mono,monospace', fill:color, opacity:0.7, listening:false,
        });
        line.on('click', ev => {
            ev.cancelBubble = true;
            if (sectorTool === 'delete') { deleteLane(lane.from, lane.to); return; }
            selectLane(lane, line);
        });
        line.on('mouseenter', () => { line.strokeWidth(3); line.opacity(1); });
        line.on('mouseleave', () => {
            line.strokeWidth(1.5);
            line.opacity(selectedLane?.from===lane.from && selectedLane?.to===lane.to ? 1 : 0.6);
        });
        laneLayer.add(line, dLabel);
        return line;
    }

    function redrawLanes() {
        laneLayer.destroyChildren();
        (sectorData.jump_lanes ?? []).forEach(lane => {
            const f = sectorData.systems.find(s => s.id === lane.from);
            const t = sectorData.systems.find(s => s.id === lane.to);
            if (f && t) createLaneShape(lane, f, t);
        });
    }

    // ── Selection ──────────────────────────────────────────────────────────────
    function handleNodeClick(sysId, group) {
        if (sectorTool === 'delete') { deleteSystem(sysId); return; }
        if (sectorTool === 'lane') {
            if (!laneSource) {
                laneSource = sysId;
                group.findOne('Circle')?.stroke('#ffd700');
                group.findOne('Circle')?.strokeWidth(3);
                setStatus('Lane: click target system…');
            } else if (laneSource !== sysId) {
                addLane(laneSource, sysId);
                const srcG = nodeLayer.findOne('#' + laneSource);
                if (srcG) {
                    const srcSys = sectorData.systems.find(s => s.id === laneSource);
                    const c = srcG.findOne('Circle');
                    if (c && srcSys) { c.stroke(STATUS_COLORS[srcSys.status]||'#00d2ff'); c.strokeWidth(2); }
                }
                laneSource = null; setSectorTool('lane');
            }
            return;
        }
        selectNode(sysId, group);
    }

    function selectNode(sysId, group) {
        deselectAll();
        selectedNode = { id:sysId, group };
        group.findOne('Circle')?.strokeWidth(3);
        const sys = sectorData.systems.find(s => s.id === sysId);
        if (!sys) return;
        if(e['gp-node-editor']) e['gp-node-editor'].style.display  = '';
        if(e['gp-lane-editor']) e['gp-lane-editor'].style.display   = 'none';
        if(e['gp-node-id'])     e['gp-node-id'].value    = sys.id;
        if(e['gp-node-name'])   e['gp-node-name'].value  = sys.name;
        if(e['gp-node-align'])  e['gp-node-align'].value = sys.political_alignment||'';
        if(e['gp-node-status']) e['gp-node-status'].value= sys.status||'Colonized';
        if(e['gp-node-file'])   e['gp-node-file'].value  = sys.file||'data/systems/'+sys.id+'.json';
        if(e['gp-node-x'])      e['gp-node-x'].value     = Math.round(sys.coordinates.x);
        if(e['gp-node-y'])      e['gp-node-y'].value     = Math.round(sys.coordinates.y);
    }

    function selectLane(lane, line) {
        deselectAll();
        selectedLane = { from:lane.from, to:lane.to, line };
        line.strokeWidth(3); line.opacity(1);
        if(e['gp-node-editor'])     e['gp-node-editor'].style.display  = 'none';
        if(e['gp-lane-editor'])     e['gp-lane-editor'].style.display   = '';
        if(e['gp-lane-endpoints'])  e['gp-lane-endpoints'].textContent  = lane.from + ' → ' + lane.to;
        if(e['gp-lane-dist'])       e['gp-lane-dist'].value            = (lane.distance||0).toFixed(2);
        if(e['gp-lane-type'])       e['gp-lane-type'].value            = lane.type||'Stable';
    }

    function deselectAll() {
        if (selectedNode?.group) selectedNode.group.findOne('Circle')?.strokeWidth(2);
        if (selectedLane?.line)  { selectedLane.line.strokeWidth(1.5); selectedLane.line.opacity(0.6); }
        selectedNode = null; selectedLane = null;
        if(e['gp-node-editor']) e['gp-node-editor'].style.display = 'none';
        if(e['gp-lane-editor']) e['gp-lane-editor'].style.display  = 'none';
    }

    // ── Sector CRUD ────────────────────────────────────────────────────────────
    function addSystem(x, y) {
        const id  = 'sys_' + Date.now();
        const sys = {
            id, name:'New System',
            coordinates:{ x:Math.round(x), y:Math.round(y) },
            political_alignment:'', status:'Unknown',
            file: 'data/systems/' + id + '.json',
        };
        sectorData.systems.push(sys);
        createNodeShape(sys);
        updateCounts();
        const grp = nodeLayer.findOne('#' + id);
        if (grp) selectNode(id, grp);
        notify('System added.','info');
    }

    function deleteSystem(sysId) {
        sectorData.systems    = sectorData.systems.filter(s => s.id !== sysId);
        sectorData.jump_lanes = sectorData.jump_lanes.filter(l => l.from!==sysId && l.to!==sysId);
        renderSector(); deselectAll();
        notify('System ' + sysId + ' deleted.','warning');
    }

    function addLane(fromId, toId) {
        const exists = sectorData.jump_lanes.find(l =>
            (l.from===fromId&&l.to===toId)||(l.from===toId&&l.to===fromId));
        if (exists) { notify('Lane already exists.','warning'); return; }
        const f = sectorData.systems.find(s => s.id===fromId);
        const t = sectorData.systems.find(s => s.id===toId);
        const dist = calcDistance(f.coordinates, t.coordinates);
        sectorData.jump_lanes.push({ from:fromId, to:toId, type:'Stable', distance:+dist.toFixed(2) });
        redrawLanes(); updateCounts();
        notify('Lane added (' + dist.toFixed(1) + ' ly)', 'success');
    }

    function deleteLane(fromId, toId) {
        sectorData.jump_lanes = sectorData.jump_lanes.filter(l =>
            !((l.from===fromId&&l.to===toId)||(l.from===toId&&l.to===fromId)));
        redrawLanes(); deselectAll(); updateCounts();
        notify('Lane removed.','warning');
    }

    function applyNodeEdit() {
        if (!selectedNode) return;
        const sys = sectorData.systems.find(s => s.id === selectedNode.id);
        if (!sys) return;
        sys.name               = (e['gp-node-name']?.value.trim()) || sys.name;
        sys.political_alignment= e['gp-node-align']?.value.trim()  || '';
        sys.status             = e['gp-node-status']?.value         || sys.status;
        sys.file               = (e['gp-node-file']?.value.trim())  || sys.file;
        const old = nodeLayer.findOne('#' + sys.id);
        if (old) old.destroy();
        createNodeShape(sys);
        const newGrp = nodeLayer.findOne('#' + sys.id);
        if (newGrp) selectNode(sys.id, newGrp);
        notify('System updated.','success');
    }

    function applyLaneEdit() {
        if (!selectedLane) return;
        const lane = sectorData.jump_lanes.find(l =>
            (l.from===selectedLane.from&&l.to===selectedLane.to)||
            (l.from===selectedLane.to&&l.to===selectedLane.from));
        if (!lane) return;
        lane.type     = e['gp-lane-type']?.value || lane.type;
        lane.distance = parseFloat(e['gp-lane-dist']?.value) || lane.distance;
        redrawLanes(); deselectAll();
        notify('Lane updated.','success');
    }

    async function saveSector() {
        if (!sectorData || !activeSectorId) { notify('No sector loaded.','warning'); return; }
        const entry = universe.sectors_index.find(s => s.id === activeSectorId);
        if (!entry) return;
        try {
            await API.saveFile(entry.file, sectorData);
            notify('Sector saved.','success');
            setStatus('Saved: ' + entry.file);
        } catch(err) { notify('Save failed: ' + err.message,'error'); }
    }

    function calcDistance(a, b) { return Math.hypot(a.x-b.x, a.y-b.y) * 0.1; }

    function updateCounts() {
        if(e['gp-count-systems']) e['gp-count-systems'].textContent = sectorData?.systems?.length ?? 0;
        if(e['gp-count-lanes'])   e['gp-count-lanes'].textContent   = sectorData?.jump_lanes?.length ?? 0;
    }

    function setSectorTool(tool) {
        sectorTool = tool;
        document.querySelectorAll('[data-tool]').forEach(b => b.classList.remove('active'));
        const btn = document.querySelector('[data-tool="' + tool + '"]');
        if(btn) btn.classList.add('active');
        laneSource = null;

        const isScatter = tool === 'scatter';
        if(e['gp-scatter-panel']) e['gp-scatter-panel'].style.display = isScatter ? '' : 'none';
        const cc = e['gp-canvas-container'];
        if (isScatter) {
            if(cc) cc.classList.add('scatter-mode');
            syncDensityCanvasSize();
            renderDensityCanvas();
            showDensityCanvas();
            showBrushCursor();
        } else {
            if(cc) cc.classList.remove('scatter-mode');
            previewSystems = null;
            hideDensityCanvas();
            hideBrushCursor();
        }
    }

    // ── Forge helpers ──────────────────────────────────────────────────────────
    async function forgeCurrentSector(sd) {
        const n = sd.systems?.length || 0;
        if (!n) { notify('No systems in this sector.', 'warning'); return; }
        const ok = await showModal(
            'Forge Sector Systems',
            `<p>Generate system + body files for all <strong>${n}</strong> nodes?</p>` +
            `<p style="color:#ffaa00;margin-top:8px">⚠ Existing files will be overwritten.</p>`
        );
        if (!ok) return;
        const prog = e['gp-forge-progress'];
        if (prog) { prog.textContent = 'Starting forge…'; prog.style.display = ''; }
        await SystemForge.populateSector(
            sd,
            (done, total) => { if (prog) prog.textContent = `Forging… ${done} / ${total}`; },
            async () => {
                if (viewMode === 'sector') renderSector();
                await saveSector();
                if (prog) {
                    prog.textContent = `✓ ${n} systems forged.`;
                    setTimeout(() => { prog.style.display = 'none'; }, 5000);
                }
                notify(`Forged ${n} systems.`, 'success');
            }
        );
    }

    async function forgeGalaxySector() {
        if (!selectedSectorId) { notify('Select a sector first.', 'warning'); return; }
        if (typeof SystemForge === 'undefined') { notify('System Forge not loaded.', 'error'); return; }
        const entry = universe.sectors_index.find(s => s.id === selectedSectorId);
        if (!entry?.file) return;
        let sd;
        try { sd = await API.getFile(entry.file); }
        catch(err) { notify('Could not load sector: ' + err.message, 'error'); return; }
        if (!sd.systems) sd.systems = [];

        // If no nodes exist yet, offer to scatter them first
        if (!sd.systems.length) {
            const countStr = await promptModal(
                'No Systems Found',
                'This sector has no system nodes.\nHow many should be scattered + forged?',
                '8'
            );
            if (!countStr) return;
            const num = Math.max(1, Math.min(50, parseInt(countStr) || 8));
            const polygon   = entry.polygon || [];
            const positions = scatterInPolygon(polygon, num, 30);
            const fallback  = polygon.length ? sectorCentroid(polygon) : { x: 500, y: 500 };
            const ts        = Date.now();
            for (let i = 0; i < num; i++) {
                const sysId = `sys_${ts.toString(36)}_${i.toString(16)}`;
                const pos   = positions[i] || {
                    x: Math.round(fallback.x + (Math.random() - 0.5) * 40),
                    y: Math.round(fallback.y + (Math.random() - 0.5) * 40),
                };
                sd.systems.push({
                    id: sysId,
                    name: `System ${i + 1}`,
                    coordinates: { x: pos.x, y: pos.y },
                    political_alignment: '',
                    status: 'Unknown',
                    file: '',
                });
            }
        }

        const n = sd.systems.length;
        const ok = await showModal(
            'Forge Sector Systems',
            `<p>Generate system + body files for all <strong>${n}</strong> nodes in <b>${entry.name || entry.id}</b>?</p>` +
            `<p style="color:#ffaa00;margin-top:8px">⚠ Existing files will be overwritten.</p>`
        );
        if (!ok) return;
        const prog = e['gp-forge-progress'];
        if (prog) { prog.textContent = 'Starting forge…'; prog.style.display = ''; }
        await SystemForge.populateSector(
            sd,
            (done, total) => { if (prog) prog.textContent = `Forging… ${done} / ${total}`; },
            async () => {
                await API.saveFile(entry.file, sd);
                if (prog) {
                    prog.textContent = `✓ ${n} systems forged.`;
                    setTimeout(() => { prog.style.display = 'none'; }, 5000);
                }
                notify(`Forged ${n} systems in ${entry.name || entry.id}.`, 'success');
            }
        );
    }

    // ── Fit helpers ────────────────────────────────────────────────────────────
    function fitPoints(pts) {
        if (!pts.length) return;
        const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        const pw = stage.width(), ph = stage.height();
        const dw = maxX-minX || 400, dh = maxY-minY || 400;
        const sc = Math.min(pw/(dw+200), ph/(dh+200), 2);
        const cx = (minX+maxX)/2, cy = (minY+maxY)/2;
        [bgLayer,refLayer,polyLayer,laneLayer,nodeLayer,previewLayer].forEach(l => {
            l.scale({x:sc,y:sc});
            l.position({x: pw/2-cx*sc, y: ph/2-cy*sc});
        });
        syncDensityCanvasSize();
    }

    function fitSector() {
        const pts = (sectorData?.systems ?? []).map(s => s.coordinates).filter(Boolean);
        if (!pts.length) {
            const dim = sectorData?.dimensions ?? {width:1000,height:1000};
            fitPoints([{x:0,y:0},{x:dim.width,y:dim.height}]);
        } else { fitPoints(pts); }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  DENSITY CANVAS & SCATTER
    // ═══════════════════════════════════════════════════════════════════════════
    function gridToScene(gx, gy) {
        const dim = sectorData?.dimensions ?? {width:1000,height:1000};
        return { x:(gx/DENSITY_W)*dim.width, y:(gy/DENSITY_H)*dim.height };
    }
    function sceneToGrid(sx, sy) {
        const dim = sectorData?.dimensions ?? {width:1000,height:1000};
        return { gx:Math.round((sx/dim.width)*DENSITY_W), gy:Math.round((sy/dim.height)*DENSITY_H) };
    }

    function syncDensityCanvasSize() {
        const dc = e['gp-density-canvas'];
        if (!dc || !stage) return;
        dc.width  = stage.width();
        dc.height = stage.height();
        renderDensityCanvas();
    }

    function showDensityCanvas() { if(e['gp-density-canvas']) e['gp-density-canvas'].style.display = ''; }
    function hideDensityCanvas() { if(e['gp-density-canvas']) e['gp-density-canvas'].style.display = 'none'; }
    function showBrushCursor()   { if(e['gp-brush-cursor'])   e['gp-brush-cursor'].style.display   = ''; }
    function hideBrushCursor()   { if(e['gp-brush-cursor'])   e['gp-brush-cursor'].style.display   = 'none'; }

    function updateBrushCursor(ev) {
        const bc = e['gp-brush-cursor'];
        if (!bc) return;
        const rect = (e['gp-canvas-container'] || stage.container()).getBoundingClientRect();
        const cx   = ev.clientX - rect.left;
        const cy   = ev.clientY - rect.top;
        const pxR  = brushSceneToPx();
        bc.style.left   = cx + 'px';
        bc.style.top    = cy + 'px';
        bc.style.width  = (pxR * 2) + 'px';
        bc.style.height = (pxR * 2) + 'px';
    }

    function brushSceneToPx() {
        const r = parseFloat(e['gp-scat-size']?.value ?? 80);
        return r * nodeLayer.scaleX();
    }

    function paintAtEvent(ev) {
        const rect   = stage.container().getBoundingClientRect();
        const scale  = nodeLayer.scaleX();
        const sceneX = (ev.clientX - rect.left - nodeLayer.x()) / scale;
        const sceneY = (ev.clientY - rect.top  - nodeLayer.y()) / scale;
        const brushR = parseFloat(e['gp-scat-size']?.value ?? 80);
        const str    = parseFloat(e['gp-scat-strength']?.value ?? 60) / 100;
        paintDensity(sceneX, sceneY, brushR, str, scatterErasing);
        renderDensityCanvas();
    }

    function paintDensity(sx, sy, radiusScene, strength, erase) {
        const dim  = sectorData?.dimensions ?? {width:1000,height:1000};
        const {gx:gcx, gy:gcy} = sceneToGrid(sx, sy);
        const grR  = Math.max(1, Math.round((radiusScene/dim.width)*DENSITY_W));
        for (let dy = -grR; dy <= grR; dy++) {
            for (let dx = -grR; dx <= grR; dx++) {
                const gx = gcx+dx, gy = gcy+dy;
                if (gx<0||gx>=DENSITY_W||gy<0||gy>=DENSITY_H) continue;
                const d = Math.hypot(dx,dy)/grR;
                if (d>1) continue;
                const g   = Math.exp(-d*d*2.5);
                const idx = gy*DENSITY_W + gx;
                if (erase) densityGrid[idx] = Math.max(0, densityGrid[idx] - g*strength*0.6);
                else       densityGrid[idx] = Math.min(1, densityGrid[idx] + g*strength*0.3);
            }
        }
    }

    function renderDensityCanvas() {
        const dc = e['gp-density-canvas'];
        if (!dc || !sectorData) return;
        const ctx = dc.getContext('2d');
        const w = dc.width, h = dc.height;
        ctx.clearRect(0,0,w,h);
        const dim   = sectorData?.dimensions ?? {width:1000,height:1000};
        const scale = nodeLayer.scaleX();
        const offX  = nodeLayer.x(), offY = nodeLayer.y();
        const img   = ctx.createImageData(w, h);
        const pxW   = Math.ceil((dim.width /DENSITY_W)*scale)+2;
        const pxH   = Math.ceil((dim.height/DENSITY_H)*scale)+2;

        for (let gy = 0; gy < DENSITY_H; gy++) {
            for (let gx = 0; gx < DENSITY_W; gx++) {
                const v = densityGrid[gy*DENSITY_W+gx];
                if (v < 0.01) continue;
                const px = Math.round((gx+0.5)/DENSITY_W*dim.width*scale + offX);
                const py = Math.round((gy+0.5)/DENSITY_H*dim.height*scale + offY);
                const r = 255, g = Math.round(80+v*175), b = Math.round(v*40), a = Math.round(v*180);
                for (let ry=0; ry<pxH; ry++) {
                    for (let rx=0; rx<pxW; rx++) {
                        const pixx = px+rx-Math.floor(pxW/2);
                        const pixy = py+ry-Math.floor(pxH/2);
                        if (pixx<0||pixx>=w||pixy<0||pixy>=h) continue;
                        const i = (pixy*w+pixx)*4;
                        if (a > img.data[i+3]) { img.data[i]=r; img.data[i+1]=g; img.data[i+2]=b; img.data[i+3]=a; }
                    }
                }
            }
        }
        ctx.putImageData(img,0,0);
    }

    function clearDensity() {
        densityGrid.fill(0);
        previewSystems = null;
        renderDensityCanvas();
        if(e['gp-scat-commit']) e['gp-scat-commit'].disabled = true;
        if(e['gp-scat-info'])   e['gp-scat-info'].textContent = 'Paint a density map, then preview.';
    }

    function makePRNG(seed) {
        let s = seed >>> 0;
        return () => { s = (Math.imul(s,1664525)+1013904223)>>>0; return s/4294967296; };
    }

    function previewScatter() {
        if (!sectorData) return;
        const count  = Math.max(1, parseInt(e['gp-scat-count']?.value   ?? 30));
        const minSep = parseFloat(e['gp-scat-minsep']?.value ?? 25);
        const prefix = (e['gp-scat-prefix']?.value ?? 'sys').trim() || 'sys';
        const seed   = parseInt(e['gp-scat-seed']?.value ?? 42);
        const dim    = sectorData.dimensions ?? {width:1000,height:1000};
        const rng    = makePRNG(seed);

        let total = 0;
        const cum = new Float64Array(DENSITY_W*DENSITY_H);
        for (let i=0;i<densityGrid.length;i++) { total+=densityGrid[i]; cum[i]=total; }
        const useUniform = total < 0.001;

        const existing = (sectorData.systems ?? []).map(s => s.coordinates);
        const placed   = [], results = [];
        const maxTries = count * 40;
        let tries = 0;

        while (results.length < count && tries < maxTries) {
            tries++;
            let gx, gy;
            if (useUniform) {
                gx = rng()*DENSITY_W; gy = rng()*DENSITY_H;
            } else {
                const r = rng()*total;
                let lo=0, hi=cum.length-1;
                while(lo<hi){const m=(lo+hi)>>1; cum[m]<r?(lo=m+1):(hi=m);}
                gx = lo%DENSITY_W + rng()-0.5;
                gy = Math.floor(lo/DENSITY_W) + rng()-0.5;
                gx = Math.min(DENSITY_W-1, Math.max(0,gx));
                gy = Math.min(DENSITY_H-1, Math.max(0,gy));
            }
            const sx = ((gx+rng()*0.8-0.4)/DENSITY_W)*dim.width;
            const sy = ((gy+rng()*0.8-0.4)/DENSITY_H)*dim.height;
            const tooClose = [...existing,...placed].some(p => Math.hypot(p.x-sx,p.y-sy)*0.1 < minSep);
            if (tooClose) continue;
            placed.push({x:sx,y:sy});
            results.push({x:Math.round(sx),y:Math.round(sy), name:prefix+'_'+(results.length+1)});
        }

        previewSystems = results;
        renderSector();
        const n = results.length;
        if(e['gp-scat-info'])  e['gp-scat-info'].textContent = 'Preview: '+n+'/'+count+' placed ('+tries+' tries)';
        if(e['gp-scat-commit']) e['gp-scat-commit'].disabled = n === 0;
        notify('Scatter preview: '+n+' systems.'+(useUniform?' No density — used uniform.':''), n>0?'info':'warning', 5000);
    }

    function commitScatter() {
        if (!previewSystems?.length) { notify('Nothing to commit.','warning'); return; }
        const ts = Date.now();
        previewSystems.forEach((ps, i) => {
            const id = ps.name+'_'+ts+'_'+i;
            sectorData.systems.push({
                id, name:ps.name,
                coordinates:{x:ps.x,y:ps.y},
                political_alignment:'', status:'Unknown',
                file:'data/systems/'+id+'.json',
            });
        });
        const added = previewSystems.length;
        previewSystems = null;
        clearDensity();
        renderSector();
        updateCounts();
        notify(added+' systems committed.','success');
        if(e['gp-scat-commit']) e['gp-scat-commit'].disabled = true;
        if(e['gp-scat-info'])   e['gp-scat-info'].textContent = added+' systems added.';
    }

    // ── Utility ────────────────────────────────────────────────────
    // ── Reference image ────────────────────────────────────────────────────────
    function drawRefImage(src) {
        refLayer.destroyChildren();
        refImageNode = null;
        const img = new window.Image();
        img.onload = () => {
            refImageNode = new Konva.Image({
                image:   img,
                x: 0, y: 0,
                width:   img.naturalWidth,
                height:  img.naturalHeight,
                opacity: parseFloat(e['gp-ref-opacity']?.value ?? 35) / 100,
                listening: false,
            });
            refLayer.add(refImageNode);
            if(e['gp-ref-controls']) e['gp-ref-controls'].style.display = '';
            if(e['gp-ref-toggle'])   e['gp-ref-toggle'].textContent    = '👁 HIDE';
            notify('Reference image loaded (' + img.naturalWidth + '×' + img.naturalHeight + ')','info');
        };
        img.src = src;
    }

    function clearRefImage() {
        refLayer.destroyChildren();
        refImageNode = null;
        if(e['gp-ref-controls']) e['gp-ref-controls'].style.display = 'none';
        notify('Reference image cleared.','info');
    }

    function hexAlpha(hex, alpha) {
        const r=parseInt(hex.slice(1,3),16), g=parseInt(hex.slice(3,5),16), b=parseInt(hex.slice(5,7),16);
        return 'rgba('+r+','+g+','+b+','+alpha+')';
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  EVENT WIRING
    // ═══════════════════════════════════════════════════════════════════════════
    function wireGalaxyEvents() {
        document.querySelectorAll('[data-gtool]').forEach(btn => {
            btn.addEventListener('click', () => {
                const t = btn.dataset.gtool;
                if (t === 'draw') { startDrawMode(); return; }
                cancelPolygon();
                setGalaxyTool(t);
            });
        });

        e['gp-galaxy-save']?.addEventListener('click', saveAll);
        e['gp-galaxy-fit']?.addEventListener('click',  fitGalaxy);

        e['gp-sec-color-picker']?.addEventListener('input', ev => {
            if(e['gp-sec-color']) e['gp-sec-color'].value = ev.target.value;
        });
        e['gp-sec-apply']?.addEventListener('click', async () => {
            if (!selectedSectorId) return;
            const entry = universe.sectors_index.find(s => s.id === selectedSectorId);
            if (!entry) return;
            entry.name  = e['gp-sec-name']?.value.trim() || entry.name;
            entry.color = e['gp-sec-color']?.value.trim() || entry.color;
            await saveAll();
            renderGalaxy();
            notify('Sector updated.','success');
        });
        e['gp-sec-enter']?.addEventListener('click', () => {
            if (selectedSectorId) enterSectorView(selectedSectorId);
        });
        e['gp-sec-forge']?.addEventListener('click', forgeGalaxySector);

        // ── Snap options ────────────────────────────────────────────────────
        e['gp-snap-enabled']?.addEventListener('change', () => {
            snapEnabled = e['gp-snap-enabled'].checked;
        });
        e['gp-snap-thresh']?.addEventListener('input', () => {
            snapThreshPx = parseInt(e['gp-snap-thresh'].value) || 18;
        });

        // ── Background reference image ──────────────────────────────────────
        e['gp-ref-load']?.addEventListener('click', () => e['gp-ref-file']?.click());

        e['gp-ref-file']?.addEventListener('change', ev => {
            const file = ev.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = evt => drawRefImage(evt.target.result);
            reader.readAsDataURL(file);
            ev.target.value = '';   // allow re-selecting same file
        });

        e['gp-ref-opacity']?.addEventListener('input', () => {
            const v = parseFloat(e['gp-ref-opacity'].value) / 100;
            if(e['gp-ref-opacity-val']) e['gp-ref-opacity-val'].textContent = e['gp-ref-opacity'].value + '%';
            if(refImageNode) refImageNode.opacity(v);
        });

        e['gp-ref-toggle']?.addEventListener('click', () => {
            if (!refImageNode) return;
            const nowVisible = refImageNode.visible();
            refImageNode.visible(!nowVisible);
            e['gp-ref-toggle'].textContent = nowVisible ? '👁 SHOW' : '👁 HIDE';
        });

        e['gp-ref-clear']?.addEventListener('click', clearRefImage);
    }

    function wireSectorEvents() {
        e['gp-back-galaxy']?.addEventListener('click', goBackToGalaxy);
        e['gp-save-sector']?.addEventListener('click', saveSector);

        document.querySelectorAll('[data-tool]').forEach(btn => {
            btn.addEventListener('click', () => setSectorTool(btn.dataset.tool));
        });

        e['gp-node-apply']?.addEventListener('click',  applyNodeEdit);
        e['gp-lane-apply']?.addEventListener('click',  applyLaneEdit);
        e['gp-lane-delete']?.addEventListener('click', () => {
            if (selectedLane) deleteLane(selectedLane.from, selectedLane.to);
        });

        e['gp-fit']?.addEventListener('click', fitSector);

        e['gp-node-open-system']?.addEventListener('click', () => {
            const file = e['gp-node-file']?.value;
            if (file && typeof OrreryBuilder !== 'undefined') {
                document.querySelector('[data-module="orrery"]')?.click();
                OrreryBuilder.loadByFile(file);
            }
        });

        e['gp-node-forge']?.addEventListener('click', async () => {
            if (!selectedNode || !sectorData) { notify('Select a system node first.', 'warning'); return; }
            if (typeof SystemForge === 'undefined') { notify('System Forge module not loaded.', 'error'); return; }
            const sysId = selectedNode.id;
            const sys   = sectorData.systems.find(s => s.id === sysId);
            if (!sys) return;
            await SystemForge.generateAndLink(sysId, {}, (filePath, starName) => {
                sys.name = starName;
                sys.file = filePath;
                if (e['gp-node-name']) e['gp-node-name'].value = starName;
                if (e['gp-node-file']) e['gp-node-file'].value = filePath;
                const old = nodeLayer.findOne('#' + sysId);
                if (old) old.destroy();
                createNodeShape(sys);
                const grp = nodeLayer.findOne('#' + sysId);
                if (grp) selectNode(sysId, grp);
            });
        });

        e['gp-forge-all']?.addEventListener('click', async () => {
            if (!sectorData) { notify('No sector loaded.', 'warning'); return; }
            if (typeof SystemForge === 'undefined') { notify('System Forge not loaded.', 'error'); return; }
            await forgeCurrentSector(sectorData);
        });
    }

    function wireScatterEvents() {
        e['gp-scat-size']?.addEventListener('input', () => {
            if(e['gp-scat-size-val']) e['gp-scat-size-val'].textContent = e['gp-scat-size'].value;
        });
        e['gp-scat-strength']?.addEventListener('input', () => {
            if(e['gp-scat-strength-val']) e['gp-scat-strength-val'].textContent = e['gp-scat-strength'].value + '%';
        });
        e['gp-scat-randseed']?.addEventListener('click', () => {
            if(e['gp-scat-seed']) e['gp-scat-seed'].value = Math.floor(Math.random()*99999);
        });
        e['gp-scat-preview']?.addEventListener('click',        previewScatter);
        e['gp-scat-commit']?.addEventListener('click',         commitScatter);
        e['gp-scat-clear-density']?.addEventListener('click',  () => { clearDensity(); notify('Density cleared.','info'); });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  PUBLIC API
    // ═══════════════════════════════════════════════════════════════════════════
    return {
        init() {
            cacheEls();
            setupStage();
            wireGalaxyEvents();
            wireSectorEvents();
            wireScatterEvents();
            enterGalaxyView().catch(err => notify('Galaxy Plotter: ' + err.message, 'error'));
        },
        reload:        enterGalaxyView,
        enterSector:   enterSectorView,
        renderSector() { renderSector(); },
    };

})();
