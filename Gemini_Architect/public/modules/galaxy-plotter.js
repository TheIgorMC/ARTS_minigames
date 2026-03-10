// =============================================================================
//  GEMINI ARCHITECT — Module A: Galaxy Plotter  (v3 — Unified Canvas)
//
//  One continuous canvas with zoom-based LOD:
//    • Sector polygons + sector names — always visible
//    • Main systems (flagged) — always visible (name at moderate zoom)
//    • Secondary systems — appear as you zoom in
//    • Jump lanes, detail labels — appear at higher zoom
//
//  Tools: Select · Draw Sector · Add System · Draw Lane · Scatter · Delete
//
//  System coordinates are stored in GALAXY SPACE (same coordinate system as
//  sector polygon vertices).  A system "belongs to" a sector when it sits
//  inside that sector's polygon.
// =============================================================================

const GalaxyPlotter = (() => {

    // ── Konva layers ───────────────────────────────────────────────────────────
    let stage        = null;
    let bgLayer      = null;   // infinite grid
    let refLayer     = null;   // background reference image
    let polyLayer    = null;   // sector polygons (always visible)
    let laneLayer    = null;   // jump lanes
    let nodeLayer    = null;   // system nodes + sector labels
    let previewLayer = null;   // polygon draw / scatter preview
    let refImageNode = null;

    // ── Core state ─────────────────────────────────────────────────────────────
    let universe = null;
    const sectorCache  = new Map();   // sectorId → sectorData (JSON)
    const dirtySectors = new Set();   // sectors modified since last save

    let activeTool       = 'select';  // 'select'|'draw'|'add'|'lane'|'scatter'|'delete'
    let selectedSectorId = null;
    let selectedNode     = null;      // { id, sectorId, group }
    let selectedLane     = null;      // { from, to, sectorId, line }
    let laneSource       = null;      // { sysId, sectorId } — first click in lane mode

    // Polygon draw state
    let polyVertices = [];
    let snapEnabled  = true;
    let snapThreshPx = 18;

    // Scatter state
    const DENSITY_W     = 256;
    const DENSITY_H     = 256;
    let densityGrid     = new Float32Array(DENSITY_W * DENSITY_H);
    let previewSystems  = null;       // [{x,y,name}] | null
    let scatterPainting = false;
    let scatterErasing  = false;

    // Factions list (persisted in universe.json as universe.factions)
    let factions = [];

    // Status stamp mode
    let stampStatus = null;   // null = off, or one of 'Colonized','Frontier',…
    // Faction stamp mode
    let factionStamp = null;  // null = off, or a faction name string

    // ── LOD thresholds ─────────────────────────────────────────────────────────
    const LOD_MAIN_LBL = 0.5;   // main system name labels
    const LOD_LANES    = 0.8;   // jump lanes become visible
    const LOD_MINOR    = 1.0;   // non-main systems appear
    const LOD_LABELS   = 1.5;   // name labels for non-main systems
    const LOD_DETAIL   = 2.5;   // political alignment / status text

    // ── Palettes ───────────────────────────────────────────────────────────────
    const SECTOR_PALETTE = [
        '#00d2ff','#ff6600','#aa44ff','#00cc44',
        '#ffaa00','#ff3366','#44aaff','#cc88ff',
        '#ff8800','#00ffaa','#ff44dd','#88ff00',
    ];
    const STATUS_COLORS = {
        Colonized:'#00cc44', Frontier:'#00d2ff', Contested:'#ffaa00',
        Abandoned:'#555',    Unknown:'#444',
    };
    const LANE_COLORS = {
        Stable:'#00d2ff', Unstable:'#ffaa00', Drift:'#aa44ff', Restricted:'#ff3333',
    };

    // ── DOM cache ──────────────────────────────────────────────────────────────
    const el = {};
    function cacheEls() {
        [
            'gp-sidebar',
            'gp-save-all','gp-fit-view',
            'gp-tool-hint',
            // Draw options
            'gp-draw-options','gp-snap-enabled','gp-snap-thresh',
            // BG reference
            'gp-ref-file','gp-ref-load','gp-ref-controls',
            'gp-ref-opacity','gp-ref-opacity-val','gp-ref-toggle','gp-ref-clear',
            'gp-ref-scale','gp-ref-scale-val','gp-ref-pos-x','gp-ref-pos-y','gp-ref-pos-apply',
            // Sector props
            'gp-sector-props','gp-sec-name','gp-sec-color','gp-sec-color-picker',
            'gp-sec-vert-count','gp-sec-apply','gp-sec-forge',
            'gp-forge-progress',
            // System props
            'gp-node-editor','gp-node-main','gp-node-id','gp-node-sector',
            'gp-node-name','gp-node-align','gp-node-status','gp-node-file',
            'gp-node-x','gp-node-y','gp-node-apply',
            'gp-node-open-system','gp-node-forge',
            // Lane props
            'gp-lane-editor','gp-lane-endpoints','gp-lane-dist',
            'gp-lane-type','gp-lane-apply','gp-lane-delete',
            // Factions
            'gp-factions-panel','gp-faction-list','gp-faction-new','gp-faction-add',
            // Status stamp
            'gp-stamp-panel','gp-stamp-active','gp-stamp-label','gp-stamp-cancel',
            // Faction stamp
            'gp-fstamp-active','gp-fstamp-label','gp-fstamp-cancel',
            // Scatter
            'gp-scatter-panel',
            'gp-scat-size','gp-scat-size-val',
            'gp-scat-strength','gp-scat-strength-val',
            'gp-scat-count','gp-scat-minsep','gp-scat-prefix',
            'gp-scat-seed','gp-scat-randseed',
            'gp-scat-preview','gp-scat-clear-density','gp-scat-commit',
            'gp-scat-info',
            // Canvas / stats
            'gp-count-sectors','gp-count-systems','gp-count-lanes',
            'gp-canvas-hint','gp-canvas-container',
            'gp-density-canvas','gp-brush-cursor',
            'gp-clear-systems',
        ].forEach(id => { el[id] = document.getElementById(id); });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  KONVA SETUP + INPUT
    // ═══════════════════════════════════════════════════════════════════════════
    function setupStage() {
        const parent = el['gp-canvas-container'];
        stage = new Konva.Stage({
            container: 'gp-canvas',
            width:  parent.clientWidth,
            height: parent.clientHeight,
        });

        bgLayer      = new Konva.Layer();
        refLayer     = new Konva.Layer();
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
                panStart = { x: ev.evt.clientX - nodeLayer.x(), y: ev.evt.clientY - nodeLayer.y() };
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
            const ns  = Math.max(0.05, Math.min(60, ev.evt.deltaY < 0 ? oldScale * factor : oldScale / factor));
            [bgLayer, refLayer, polyLayer, laneLayer, nodeLayer, previewLayer].forEach(l => {
                l.scale({ x: ns, y: ns });
                l.position({ x: ptr.x - mpx * ns, y: ptr.y - mpy * ns });
            });
            syncDensityCanvasSize();
            updateLOD(ns);
        });

        // ── Click dispatch ────────────────────────────────────────────────────
        stage.on('click', ev => {
            if (ev.evt.button !== 0) return;
            handleCanvasClick(scenePos(ev.evt), ev);
        });

        stage.on('dblclick', ev => {
            if (activeTool === 'draw') { finishPolygon(); ev.evt.preventDefault(); }
        });

        stage.on('mousemove', ev => {
            if (activeTool === 'draw') {
                const pos  = scenePos(ev.evt);
                const snap = getSnapTarget(pos.x, pos.y);
                const cur  = snap || pos;
                if (polyVertices.length > 0) drawPolyPreview(cur, snap);
                else { previewLayer.destroyChildren(); if (snap) drawSnapIndicator(snap.x, snap.y); }
            }
        });

        // ── Scatter paint ─────────────────────────────────────────────────────
        stage.on('mousedown', ev => {
            if (activeTool !== 'scatter' || !selectedSectorId) return;
            scatterErasing  = ev.evt.button === 2;
            scatterPainting = true;
            paintAtEvent(ev.evt);
        });
        window.addEventListener('mousemove', ev => {
            if (activeTool !== 'scatter') return;
            updateBrushCursor(ev);
            if (scatterPainting) paintAtEvent(ev);
        });
        window.addEventListener('mouseup', () => { scatterPainting = false; });

        // ── Keyboard ──────────────────────────────────────────────────────────
        window.addEventListener('keydown', ev => {
            if (ev.key === 'Escape') {
                if (activeTool === 'draw') cancelPolygon();
                if (activeTool === 'scatter') scatterPainting = false;
                if (activeTool === 'lane') { laneSource = null; setTool('lane'); }
            }
            if ((ev.ctrlKey || ev.metaKey) && ev.key === 's') { ev.preventDefault(); saveAll(); }
            if (ev.key === 'Delete' || ev.key === 'Backspace') {
                const tag = ev.target.tagName;
                if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || ev.target.isContentEditable) return;
                if (selectedNode) deleteSystem(selectedNode.id);
                else if (selectedLane) deleteLane(selectedLane.from, selectedLane.to, selectedLane.sectorId);
                else if (selectedSectorId && !selectedNode && !selectedLane) deleteGalaxySectorById(selectedSectorId);
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
    //  LOAD & RENDER
    // ═══════════════════════════════════════════════════════════════════════════
    async function loadGalaxy() {
        universe = await API.getUniverse();
        const cnd = document.getElementById('campaign-name-display');
        if (cnd) cnd.textContent = universe.campaign_name || '—';

        // Load every sector JSON into cache
        sectorCache.clear();
        dirtySectors.clear();
        const sectors = universe.sectors_index ?? [];
        await Promise.all(sectors.map(async entry => {
            if (!entry.file) return;
            try {
                const sd = await API.getFile(entry.file);
                sectorCache.set(entry.id, sd);
            } catch (err) { console.warn('Could not load sector', entry.id, err); }
        }));

        renderAll();
        loadFactions();
        setBreadcrumb([{ label: 'Galaxy' }]);
        setStatus('Galaxy — ' + sectors.length + ' sectors, ' + totalSystemCount() + ' systems');
        const hint = el['gp-canvas-hint'];
        if (hint) hint.style.display = sectors.length ? 'none' : '';
    }

    function totalSystemCount() {
        let n = 0;
        for (const sd of sectorCache.values()) n += (sd.systems?.length ?? 0);
        return n;
    }

    /** Full re-render: polygons, systems, lanes. */
    function renderAll() {
        polyLayer.destroyChildren();
        laneLayer.destroyChildren();
        nodeLayer.destroyChildren();
        previewLayer.destroyChildren();

        const sectors = universe?.sectors_index ?? [];
        const scale   = nodeLayer.scaleX();

        // 1 — Sector polygons + labels
        sectors.forEach((entry, i) => {
            if (!entry.color) entry.color = SECTOR_PALETTE[i % SECTOR_PALETTE.length];
            if (!entry.polygon || entry.polygon.length < 3) return;
            createSectorPolygon(entry, entry.color);
        });

        // 2 — Lanes (one Konva.Group per sector)
        for (const [secId, sd] of sectorCache) {
            const grp = new Konva.Group({ id: 'lg_' + secId });
            (sd.jump_lanes ?? []).forEach(lane => {
                const f = findSystemById(lane.from) || sd.systems?.find(s => s.id === lane.from);
                const t = findSystemById(lane.to)   || sd.systems?.find(s => s.id === lane.to);
                if (f && t) createLaneShape(lane, f, t, secId, grp);
            });
            grp.visible(scale >= LOD_LANES);
            laneLayer.add(grp);
        }

        // 3 — System nodes (all sectors)
        for (const [secId, sd] of sectorCache) {
            const entry = sectors.find(s => s.id === secId);
            const color = entry?.color || '#00d2ff';
            (sd.systems ?? []).forEach(sys => createSystemNode(sys, secId, color));
        }

        // 4 — Scatter preview dots
        if (previewSystems) previewSystems.forEach(ps => drawPreviewDot(ps));

        updateCounts();
        updateLOD(scale);
    }

    // ── Sector polygon ─────────────────────────────────────────────────────────
    function createSectorPolygon(entry, color) {
        const pts   = entry.polygon.flatMap(v => [v.x, v.y]);
        const isSel = entry.id === selectedSectorId;

        const poly = new Konva.Line({
            points: pts, closed: true,
            fill:        hexAlpha(color, isSel ? 0.18 : 0.08),
            stroke:      color,
            strokeWidth: isSel ? 2.5 : 1.5,
            opacity:     isSel ? 1 : 0.7,
        });

        poly.on('mouseenter', () => {
            stage.container().style.cursor = activeTool === 'delete' ? 'not-allowed' : 'pointer';
            poly.fill(hexAlpha(color, 0.22));
            poly.strokeWidth(2.5);
        });
        poly.on('mouseleave', () => {
            stage.container().style.cursor = 'default';
            poly.fill(hexAlpha(color, isSel ? 0.18 : 0.08));
            poly.strokeWidth(isSel ? 2.5 : 1.5);
        });
        poly.on('click', ev => {
            if (activeTool === 'scatter' || activeTool === 'draw') return;
            if (activeTool === 'add') {
                ev.cancelBubble = true;
                const pos = scenePos(ev.evt);
                addSystemAtPoint(pos.x, pos.y);
                return;
            }
            ev.cancelBubble = true;
            if (activeTool === 'delete') { deleteGalaxySectorById(entry.id); return; }
            if (activeTool === 'lane') { selectSector(entry.id); return; }
            selectSector(entry.id);
        });
        polyLayer.add(poly);

        // Sector name at centroid
        const c   = sectorCentroid(entry.polygon);
        const lbl = new Konva.Text({
            x: c.x, y: c.y,
            text: entry.name || entry.id,
            fontSize: 14,
            fontFamily: 'Share Tech Mono, monospace',
            fill: color, opacity: 0.9, listening: false,
            name: 'sector-label',
        });
        lbl.offsetX(lbl.width() / 2);
        lbl.offsetY(lbl.height() / 2);
        nodeLayer.add(lbl);
    }

    // ── System node ────────────────────────────────────────────────────────────
    function createSystemNode(sys, sectorId, sectorColor) {
        const isMain = sys.main === true;
        const color  = sys.star_color || STATUS_COLORS[sys.status] || sectorColor;
        const radius = isMain ? 5 : 3;
        const scale  = nodeLayer.scaleX();

        const group = new Konva.Group({
            x: sys.coordinates.x, y: sys.coordinates.y,
            id: sys.id,
            draggable: activeTool === 'select',
            name: isMain ? 'sys-node sys-main' : 'sys-node',
        });

        // Glow for main systems
        if (isMain) {
            group.add(new Konva.Circle({
                radius: radius + 4, fill: 'transparent',
                stroke: color, strokeWidth: 1, opacity: 0.3, listening: false,
                name: 'glow',
            }));
        }

        // Main circle — filled with star color
        const circle = new Konva.Circle({
            radius, fill: color,
            stroke: color, strokeWidth: isMain ? 1.5 : 1,
            name: 'circle',
        });

        // Diamond icon for main systems
        if (isMain) {
            group.add(new Konva.RegularPolygon({
                sides: 4, radius: 2,
                fill: '#fff', listening: false, name: 'star-icon',
            }));
        }

        // Name label
        const lbl = new Konva.Text({
            text: sys.name || sys.id,
            y: radius + 6,
            fontSize: isMain ? 11 : 9,
            fontFamily: 'Share Tech Mono,monospace',
            fill: color, listening: false, name: 'name-label',
            visible: isMain ? scale >= LOD_MAIN_LBL : scale >= LOD_LABELS,
        });
        lbl.offsetX(lbl.width() / 2);

        // Detail label
        const detailText = [sys.political_alignment, sys.status].filter(Boolean).join(' · ');
        const detailLbl = new Konva.Text({
            name: 'detail-label',
            text: detailText,
            y: radius + 18, fontSize: 8,
            fontFamily: 'Share Tech Mono,monospace',
            fill: '#667788', listening: false,
            visible: scale >= LOD_DETAIL,
        });
        detailLbl.offsetX(detailLbl.width() / 2);

        group.add(circle, lbl, detailLbl);

        // Visibility (non-main hidden at low zoom)
        if (!isMain) group.visible(scale >= LOD_MINOR);

        // ── Interaction ──
        group.on('mouseenter', () => {
            if (activeTool === 'scatter') return;
            stage.container().style.cursor = activeTool === 'delete' ? 'not-allowed' : 'pointer';
            circle.strokeWidth(isMain ? 2.5 : 2);
            const glow = group.findOne('.glow');
            if (glow) glow.opacity(0.6);
        });
        group.on('mouseleave', () => {
            if (activeTool === 'scatter') return;
            stage.container().style.cursor = 'default';
            const sel = selectedNode?.id === sys.id;
            circle.strokeWidth(sel ? (isMain ? 2.5 : 2) : (isMain ? 1.5 : 1));
            const glow = group.findOne('.glow');
            if (glow) glow.opacity(sel ? 0.5 : 0.3);
        });
        group.on('click', ev => {
            if (activeTool === 'scatter') return;
            ev.cancelBubble = true;
            handleNodeClick(sys.id, sectorId, group);
        });
        group.on('dblclick', ev => {
            ev.cancelBubble = true;
            const file = sys.file || `data/systems/${sys.id}.json`;
            const tab = document.querySelector('[data-module="orrery"]');
            if (tab) tab.click();
            if (typeof OrreryBuilder !== 'undefined') OrreryBuilder.loadByFile(file);
        });
        group.on('dragmove', () => {
            sys.coordinates.x = Math.round(group.x());
            sys.coordinates.y = Math.round(group.y());
            dirtySectors.add(sectorId);
            if (selectedNode?.id === sys.id) {
                if (el['gp-node-x']) el['gp-node-x'].value = sys.coordinates.x;
                if (el['gp-node-y']) el['gp-node-y'].value = sys.coordinates.y;
            }
            redrawLanesForSector(sectorId);
        });

        nodeLayer.add(group);
    }

    // ── Lane shape ─────────────────────────────────────────────────────────────
    function createLaneShape(lane, fromSys, toSys, sectorId, parentGroup) {
        const color = LANE_COLORS[lane.type] || '#444';
        const DASH_MAP = {
            Stable:     [10, 6],
            Unstable:   [6, 6],
            Drift:      [4, 8],
            Restricted: [14, 4, 4, 4],
        };
        const line = new Konva.Line({
            points: [fromSys.coordinates.x, fromSys.coordinates.y,
                     toSys.coordinates.x,   toSys.coordinates.y],
            stroke: color, strokeWidth: 1.5, opacity: 0.6,
            dash: DASH_MAP[lane.type] || [10, 6],
        });
        line.on('click', ev => {
            ev.cancelBubble = true;
            if (activeTool === 'delete') { deleteLane(lane.from, lane.to, sectorId); return; }
            selectLane(lane, sectorId, line);
        });
        line.on('mouseenter', () => {
            line.strokeWidth(3); line.opacity(1);
            stage.container().title = `${fromSys.name || lane.from} ↔ ${toSys.name || lane.to}  —  ${(lane.distance || 0).toFixed(1)} ly  [${lane.type}]`;
        });
        line.on('mouseleave', () => {
            line.strokeWidth(1.5);
            line.opacity(selectedLane?.from === lane.from && selectedLane?.to === lane.to ? 1 : 0.6);
            stage.container().title = '';
        });
        parentGroup.add(line);
    }

    /** Redraw only lanes for one sector (e.g. after a system drag). */
    function redrawLanesForSector(sectorId) {
        // Find existing group by iterating (safe for any id format)
        laneLayer.children.forEach(c => { if (c.id() === 'lg_' + sectorId) c.destroy(); });

        const sd = sectorCache.get(sectorId);
        if (!sd) return;
        const grp = new Konva.Group({ id: 'lg_' + sectorId });
        (sd.jump_lanes ?? []).forEach(lane => {
            const f = findSystemById(lane.from) || sd.systems?.find(s => s.id === lane.from);
            const t = findSystemById(lane.to)   || sd.systems?.find(s => s.id === lane.to);
            if (f && t) createLaneShape(lane, f, t, sectorId, grp);
        });
        grp.visible(nodeLayer.scaleX() >= LOD_LANES);
        laneLayer.add(grp);
    }

    // ── LOD update ─────────────────────────────────────────────────────────────
    function updateLOD(scale) {
        // Inverse-scale with slight growth: labels get a bit bigger as you zoom in
        const inv = 1 / Math.max(scale, 0.05);
        const grow = Math.pow(Math.max(scale, 0.05), 0.3);  // mild growth factor

        nodeLayer.children.forEach(grp => {
            if (!grp.hasName('sys-node')) return;
            const isMain = grp.hasName('sys-main');
            const radius = isMain ? 5 : 3;

            // Whole group visibility
            if (!isMain) grp.visible(scale >= LOD_MINOR);

            // Name label — grows slightly with zoom
            const nameLbl = grp.findOne('.name-label');
            if (nameLbl) {
                nameLbl.visible(isMain ? scale >= LOD_MAIN_LBL : scale >= LOD_LABELS);
                const baseFontSize = isMain ? 11 : 9;
                nameLbl.fontSize(baseFontSize * inv * grow);
                nameLbl.y(radius + 4 * inv);
                nameLbl.offsetX(nameLbl.width() / 2);
            }

            // Detail label — grows slightly with zoom
            const detailLbl = grp.findOne('.detail-label');
            if (detailLbl) {
                detailLbl.visible(scale >= LOD_DETAIL);
                detailLbl.fontSize(8 * inv * grow);
                detailLbl.y(radius + 14 * inv);
                detailLbl.offsetX(detailLbl.width() / 2);
            }
        });

        // Sector name labels — grows slightly with zoom
        nodeLayer.children.forEach(lbl => {
            if (lbl.className === 'Text' && lbl.name() === 'sector-label') {
                lbl.fontSize(14 * inv * grow);
                lbl.offsetX(lbl.width() / 2);
                lbl.offsetY(lbl.height() / 2);
            }
        });

        // Lane groups
        laneLayer.children.forEach(grp => grp.visible(scale >= LOD_LANES));
    }

    // ── Preview dot (scatter) ──────────────────────────────────────────────────
    function drawPreviewDot(ps) {
        const dot = new Konva.Circle({
            x: ps.x, y: ps.y, radius: 8,
            fill: 'rgba(255,215,0,0.12)', stroke: '#ffd700', strokeWidth: 1, dash: [3, 3],
            listening: false, name: 'preview-dot',
        });
        const lbl = new Konva.Text({
            x: ps.x, y: ps.y + 12, text: ps.name,
            fontSize: 8, fontFamily: 'Share Tech Mono,monospace',
            fill: '#ffd700', opacity: 0.6, listening: false, name: 'preview-dot',
        });
        lbl.offsetX(lbl.width() / 2);
        nodeLayer.add(dot, lbl);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════════════════════════
    function findSystem(sysId) {
        for (const [secId, sd] of sectorCache) {
            const sys = sd.systems?.find(s => s.id === sysId);
            if (sys) return { sys, sectorId: secId, sd };
        }
        return null;
    }

    /** Quick lookup returning just the system object (cross-sector). */
    function findSystemById(sysId) {
        for (const sd of sectorCache.values()) {
            const sys = sd.systems?.find(s => s.id === sysId);
            if (sys) return sys;
        }
        return null;
    }

    function findSectorForPoint(x, y) {
        return (universe?.sectors_index ?? []).find(entry =>
            entry.polygon?.length >= 3 && pointInPolygon(x, y, entry.polygon)
        );
    }

    function sectorCentroid(polygon) {
        return {
            x: polygon.reduce((s, v) => s + v.x, 0) / polygon.length,
            y: polygon.reduce((s, v) => s + v.y, 0) / polygon.length,
        };
    }

    function pointInPolygon(px, py, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const xi = poly[i].x, yi = poly[i].y;
            const xj = poly[j].x, yj = poly[j].y;
            if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi))
                inside = !inside;
        }
        return inside;
    }

    function polygonArea(poly) {
        let area = 0;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++)
            area += (poly[j].x + poly[i].x) * (poly[j].y - poly[i].y);
        return Math.abs(area / 2);
    }

    function polyBBox(polygon) {
        const xs = polygon.map(v => v.x), ys = polygon.map(v => v.y);
        return { minX: Math.min(...xs), maxX: Math.max(...xs),
                 minY: Math.min(...ys), maxY: Math.max(...ys) };
    }

    function calcDistance(a, b) { return Math.hypot(a.x - b.x, a.y - b.y) * 0.1; }

    function hexAlpha(hex, alpha) {
        const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
        return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }

    function scatterInPolygon(poly, n, margin) {
        if (!poly || poly.length < 3) return [];
        const xs = poly.map(v => v.x), ys = poly.map(v => v.y);
        const minX = Math.min(...xs) + margin, maxX = Math.max(...xs) - margin;
        const minY = Math.min(...ys) + margin, maxY = Math.max(...ys) - margin;
        if (maxX <= minX || maxY <= minY) return [];
        const area    = polygonArea(poly);
        const minDist = Math.max(margin * 1.5, Math.sqrt(area / Math.max(n, 1)) * 0.72);
        const pts = [];
        let tries = 0;
        const maxTries = n * 500;
        while (pts.length < n && tries < maxTries) {
            tries++;
            const x = minX + Math.random() * (maxX - minX);
            const y = minY + Math.random() * (maxY - minY);
            if (!pointInPolygon(x, y, poly)) continue;
            let tooClose = false;
            for (const p of pts) {
                if (Math.hypot(x - p.x, y - p.y) < minDist) { tooClose = true; break; }
            }
            if (!tooClose) pts.push({ x: Math.round(x), y: Math.round(y) });
        }
        return pts;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  SELECTION
    // ═══════════════════════════════════════════════════════════════════════════
    function selectSector(id) {
        deselectAll();
        selectedSectorId = id;
        showSectorProps(id);
        renderAll();
        setStatus('Sector: ' + ((universe.sectors_index.find(s => s.id === id))?.name || id));
    }

    function showSectorProps(sectorId) {
        const entry = universe.sectors_index.find(s => s.id === sectorId);
        if (!entry) return;
        if (el['gp-sector-props'])   el['gp-sector-props'].style.display   = '';
        if (el['gp-sec-name'])       el['gp-sec-name'].value               = entry.name || '';
        if (el['gp-sec-color'])      el['gp-sec-color'].value              = entry.color || '#00d2ff';
        try { if (el['gp-sec-color-picker']) el['gp-sec-color-picker'].value = entry.color || '#00d2ff'; } catch (_) {}
        if (el['gp-sec-vert-count']) el['gp-sec-vert-count'].textContent   = entry.polygon?.length ?? 0;
    }

    function selectNode(sysId, sectorId, group) {
        deselectAll();
        selectedNode = { id: sysId, sectorId, group };
        const circle = group.findOne('.circle');
        if (circle) circle.strokeWidth(group.hasName('sys-main') ? 3.5 : 2.5);

        // Also select containing sector (without full renderAll)
        selectedSectorId = sectorId;
        showSectorProps(sectorId);

        const sd  = sectorCache.get(sectorId);
        const sys = sd?.systems?.find(s => s.id === sysId);
        if (!sys) return;

        if (el['gp-node-editor'])  el['gp-node-editor'].style.display = '';
        if (el['gp-lane-editor'])  el['gp-lane-editor'].style.display = 'none';
        if (el['gp-node-main'])    el['gp-node-main'].checked         = sys.main === true;
        if (el['gp-node-id'])      el['gp-node-id'].value             = sys.id;
        if (el['gp-node-sector'])  el['gp-node-sector'].value         = sectorId;
        if (el['gp-node-name'])    el['gp-node-name'].value           = sys.name || '';
        if (el['gp-node-align'])   el['gp-node-align'].value          = sys.political_alignment || '';
        if (el['gp-node-status'])  el['gp-node-status'].value         = sys.status || 'Unknown';
        if (el['gp-node-file'])    el['gp-node-file'].value           = sys.file || 'data/systems/' + sys.id + '.json';
        if (el['gp-node-x'])       el['gp-node-x'].value              = Math.round(sys.coordinates.x);
        if (el['gp-node-y'])       el['gp-node-y'].value              = Math.round(sys.coordinates.y);
    }

    function selectLane(lane, sectorId, line) {
        deselectAll();
        selectedSectorId = sectorId;
        showSectorProps(sectorId);
        selectedLane = { from: lane.from, to: lane.to, sectorId, line };
        line.strokeWidth(3); line.opacity(1);
        if (el['gp-node-editor'])    el['gp-node-editor'].style.display = 'none';
        if (el['gp-lane-editor'])    el['gp-lane-editor'].style.display = '';
        if (el['gp-lane-endpoints']) el['gp-lane-endpoints'].textContent = lane.from + ' → ' + lane.to;
        if (el['gp-lane-dist'])      el['gp-lane-dist'].value           = (lane.distance || 0).toFixed(2);
        if (el['gp-lane-type'])      el['gp-lane-type'].value           = lane.type || 'Stable';
    }

    function deselectAll() {
        if (selectedNode?.group) {
            const c = selectedNode.group.findOne('.circle');
            if (c) c.strokeWidth(selectedNode.group.hasName('sys-main') ? 2.5 : 1.5);
        }
        if (selectedLane?.line) { selectedLane.line.strokeWidth(1.5); selectedLane.line.opacity(0.6); }
        selectedNode = null;
        selectedLane = null;
        if (el['gp-node-editor']) el['gp-node-editor'].style.display = 'none';
        if (el['gp-lane-editor']) el['gp-lane-editor'].style.display = 'none';
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  TOOLS
    // ═══════════════════════════════════════════════════════════════════════════
    function setTool(tool) {
        activeTool = tool;
        document.querySelectorAll('[data-gtool]').forEach(b => b.classList.remove('active'));
        const btn = document.querySelector('[data-gtool="' + tool + '"]');
        if (btn) btn.classList.add('active');
        laneSource = null;

        const cc = el['gp-canvas-container'];

        // Draw options panel
        if (el['gp-draw-options']) el['gp-draw-options'].style.display = tool === 'draw' ? '' : 'none';
        if (tool !== 'draw' && cc) cc.classList.remove('draw-mode');
        if (tool === 'draw' && cc) cc.classList.add('draw-mode');

        // Scatter panel
        const isScatter = tool === 'scatter';
        if (el['gp-scatter-panel']) el['gp-scatter-panel'].style.display = isScatter ? '' : 'none';
        if (isScatter && selectedSectorId) {
            if (cc) cc.classList.add('scatter-mode');
            syncDensityCanvasSize();
            renderDensityCanvas();
            showDensityCanvas();
            showBrushCursor();
        } else {
            if (cc) cc.classList.remove('scatter-mode');
            previewSystems = null;
            hideDensityCanvas();
            hideBrushCursor();
        }

        // Draggable only in select mode
        nodeLayer.children.forEach(grp => {
            if (grp.hasName('sys-node')) grp.draggable(tool === 'select');
        });

        // Hint
        const hints = {
            select:  'Click sectors, systems, or lanes to select. Drag systems to move.',
            draw:    'Click vertices · dblclick to close · ESC cancel.',
            add:     'Click inside a sector polygon to place a new system.',
            lane:    'Click first system, then second to create a lane.',
            scatter: selectedSectorId
                       ? 'LMB: paint density · RMB: erase.'
                       : '⚠ Select a sector first, then use scatter.',
            delete:  'Click a sector, system, or lane to delete.',
        };
        if (el['gp-tool-hint']) el['gp-tool-hint'].textContent = hints[tool] || '';
    }

    function handleCanvasClick(pos, ev) {
        switch (activeTool) {
            case 'select':
                if (ev.target === stage || ev.target.getLayer() === bgLayer) {
                    deselectAll();
                    selectedSectorId = null;
                    if (el['gp-sector-props']) el['gp-sector-props'].style.display = 'none';
                    renderAll();
                }
                break;
            case 'draw':
                handleDrawClick(pos);
                break;
            case 'add':
                addSystemAtPoint(pos.x, pos.y);
                break;
            case 'lane':
                // Clicking empty canvas resets lane source
                if (ev.target === stage || ev.target.getLayer() === bgLayer) {
                    laneSource = null;
                    setStatus('Lane cancelled.');
                }
                break;
        }
    }

    function handleNodeClick(sysId, sectorId, group) {
        if (activeTool === 'delete') { deleteSystem(sysId); return; }
        // Status stamp mode — apply stamp and return
        if (stampStatus) { applyStampToSystem(sysId, sectorId); return; }
        // Faction stamp mode
        if (factionStamp) { applyFactionStampToSystem(sysId, sectorId); return; }
        if (activeTool === 'lane') {
            if (!laneSource) {
                laneSource = { sysId, sectorId };
                const c = group.findOne('.circle');
                if (c) { c.stroke('#ffd700'); c.strokeWidth(3); }
                setStatus('Lane: click target system…');
            } else {
                if (laneSource.sysId !== sysId) {
                    // Store lane in the source system's sector
                    addLane(laneSource.sysId, sysId, laneSource.sectorId);
                }
                // Reset source highlight
                const srcGrp = nodeLayer.findOne('#' + laneSource.sysId);
                if (srcGrp) {
                    const f = findSystem(laneSource.sysId);
                    const c = srcGrp.findOne('.circle');
                    if (c && f) {
                        c.stroke(f.sys.star_color || STATUS_COLORS[f.sys.status] || '#00d2ff');
                        c.strokeWidth(srcGrp.hasName('sys-main') ? 1.5 : 1);
                    }
                }
                laneSource = null;
                setTool('lane');
            }
            return;
        }
        selectNode(sysId, sectorId, group);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  CRUD
    // ═══════════════════════════════════════════════════════════════════════════
    async function addSystemAtPoint(x, y) {
        const entry = findSectorForPoint(x, y);
        if (!entry) { notify('Click inside a sector polygon to place a system.', 'warning'); return; }
        const sd = sectorCache.get(entry.id);
        if (!sd) { notify('Sector data not loaded.', 'error'); return; }

        // Offer choice: new or link existing system file
        const choice = await pickSystemOrigin();
        if (!choice) return;

        let id, name, rel;
        if (choice.mode === 'existing') {
            // Link existing system JSON
            rel = choice.file;
            try {
                const sysData = await API.getFile(rel);
                name = sysData.name || sysData.star?.name || rel.split('/').pop().replace('.json','');
                id = sysData.id || rel.split('/').pop().replace('.json','');
            } catch (e) {
                notify('Could not read system file: ' + e.message, 'error');
                return;
            }
        } else {
            name = choice.name;
            id   = 'sys_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/__+/g, '_') + '_' + Date.now().toString(36);
            rel  = 'data/systems/' + id + '.json';
            const systemData = {
                id, name,
                star: { name, spectral_class: 'G2V', radius_km: 696000, color_hex: '#ffcc00' },
                orbitals: [],
            };
            try { await API.saveFile(rel, systemData); }
            catch (e) { notify('Could not create system file: ' + e.message, 'error'); }
        }

        const sys = {
            id, name,
            coordinates: { x: Math.round(x), y: Math.round(y) },
            political_alignment: '', status: 'Unknown',
            file: rel,
            main: false,
        };

        if (!sd.systems) sd.systems = [];
        sd.systems.push(sys);
        dirtySectors.add(entry.id);

        createSystemNode(sys, entry.id, entry.color || '#00d2ff');
        updateLOD(nodeLayer.scaleX());
        updateCounts();
        const grp = nodeLayer.findOne('#' + id);
        if (grp) selectNode(id, entry.id, grp);
        notify('System "' + name + '" added to ' + (entry.name || entry.id) + '.', 'info');
    }

    /** Modal: let user choose between creating a new system or linking an existing .json file */
    async function pickSystemOrigin() {
        let files = [];
        try {
            const list = await API.listDir('data/systems');
            files = list.filter(f => !f.isDir && f.name.endsWith('.json'));
        } catch (_) {}

        // Check which files are already placed in any sector
        const usedFiles = new Set();
        for (const sd of sectorCache.values()) {
            for (const s of (sd.systems || [])) if (s.file) usedFiles.add(s.file);
        }
        const unlinked = files.filter(f => !usedFiles.has('data/systems/' + f.name));

        return new Promise(resolve => {
            let html = '<div style="display:flex;flex-direction:column;gap:10px">';
            html += '<label class="form-label" style="margin-bottom:0">CREATE NEW</label>';
            html += '<input class="form-input" id="modal-sys-name" placeholder="Star / system name" value="New Star" />';
            if (unlinked.length) {
                html += '<hr style="border-color:var(--gray-700);margin:4px 0">';
                html += '<label class="form-label" style="margin-bottom:0">OR LINK EXISTING FILE</label>';
                html += '<select class="form-select" id="modal-sys-file"><option value="">— choose —</option>';
                unlinked.forEach(f => {
                    html += `<option value="data/systems/${f.name}">${f.name.replace('.json','')}</option>`;
                });
                html += '</select>';
            }
            html += '</div>';

            document.getElementById('modal-title').textContent = 'Add System';
            document.getElementById('modal-body').innerHTML = html;
            const overlay = document.getElementById('modal-overlay');
            overlay.style.display = 'flex';

            const nameInp = document.getElementById('modal-sys-name');
            const fileSel = document.getElementById('modal-sys-file');
            nameInp?.focus();
            nameInp?.select();

            function cleanup(result) {
                overlay.style.display = 'none';
                document.getElementById('modal-confirm').onclick = null;
                document.getElementById('modal-cancel').onclick  = null;
                resolve(result);
            }

            document.getElementById('modal-confirm').onclick = () => {
                if (fileSel?.value) {
                    cleanup({ mode: 'existing', file: fileSel.value });
                } else {
                    const n = nameInp?.value.trim();
                    cleanup(n ? { mode: 'new', name: n } : null);
                }
            };
            document.getElementById('modal-cancel').onclick = () => cleanup(null);
            nameInp?.addEventListener('keydown', e => {
                if (e.key === 'Enter') document.getElementById('modal-confirm').click();
                if (e.key === 'Escape') cleanup(null);
            });
        });
    }

    function deleteSystem(sysId) {
        const found = findSystem(sysId);
        if (!found) return;
        const { sd, sectorId } = found;
        sd.systems    = sd.systems.filter(s => s.id !== sysId);
        sd.jump_lanes = (sd.jump_lanes ?? []).filter(l => l.from !== sysId && l.to !== sysId);
        dirtySectors.add(sectorId);
        const grp = nodeLayer.findOne('#' + sysId);
        if (grp) grp.destroy();
        redrawLanesForSector(sectorId);
        deselectAll();
        updateCounts();
        notify('System deleted.', 'warning');
    }

    function addLane(fromId, toId, sectorId) {
        const sd = sectorCache.get(sectorId);
        if (!sd) return;
        if (!sd.jump_lanes) sd.jump_lanes = [];
        const exists = sd.jump_lanes.find(l =>
            (l.from === fromId && l.to === toId) || (l.from === toId && l.to === fromId));
        if (exists) { notify('Lane already exists.', 'warning'); return; }
        const f = findSystemById(fromId);
        const t = findSystemById(toId);
        if (!f || !t) return;
        const dist = calcDistance(f.coordinates, t.coordinates);
        sd.jump_lanes.push({ from: fromId, to: toId, type: 'Stable', distance: +dist.toFixed(2) });
        dirtySectors.add(sectorId);
        redrawLanesForSector(sectorId);
        updateCounts();
        notify('Lane added (' + dist.toFixed(1) + ' ly)', 'success');
    }

    function deleteLane(fromId, toId, sectorId) {
        const sd = sectorCache.get(sectorId);
        if (!sd) return;
        sd.jump_lanes = (sd.jump_lanes ?? []).filter(l =>
            !((l.from === fromId && l.to === toId) || (l.from === toId && l.to === fromId)));
        dirtySectors.add(sectorId);
        redrawLanesForSector(sectorId);
        deselectAll();
        updateCounts();
        notify('Lane removed.', 'warning');
    }

    async function applyNodeEdit() {
        if (!selectedNode) return;
        const sd  = sectorCache.get(selectedNode.sectorId);
        const sys = sd?.systems?.find(s => s.id === selectedNode.id);
        if (!sys) return;
        const newName           = (el['gp-node-name']?.value.trim())  || sys.name;
        sys.name                = newName;
        sys.political_alignment = el['gp-node-align']?.value.trim()   || '';
        sys.status              = el['gp-node-status']?.value         || sys.status;
        sys.file                = (el['gp-node-file']?.value.trim())  || sys.file;
        sys.main                = el['gp-node-main']?.checked === true;
        dirtySectors.add(selectedNode.sectorId);

        // Propagate name to the system JSON file (star name = system name)
        if (sys.file) {
            try {
                const sysData = await API.getFile(sys.file);
                sysData.name = newName;
                if (sysData.star) sysData.star.name = newName;
                await API.saveFile(sys.file, sysData);
            } catch (_) {}
        }

        // Rebuild the Konva node
        const oldGrp = nodeLayer.findOne('#' + sys.id);
        if (oldGrp) oldGrp.destroy();
        const entry = universe.sectors_index.find(s => s.id === selectedNode.sectorId);
        createSystemNode(sys, selectedNode.sectorId, entry?.color || '#00d2ff');
        updateLOD(nodeLayer.scaleX());
        const newGrp = nodeLayer.findOne('#' + sys.id);
        if (newGrp) selectNode(sys.id, selectedNode.sectorId, newGrp);
        notify('System updated.', 'success');
    }

    function applyLaneEdit() {
        if (!selectedLane) return;
        const sd = sectorCache.get(selectedLane.sectorId);
        if (!sd) return;
        const lane = sd.jump_lanes?.find(l =>
            (l.from === selectedLane.from && l.to === selectedLane.to) ||
            (l.from === selectedLane.to && l.to === selectedLane.from));
        if (!lane) return;
        lane.type     = el['gp-lane-type']?.value  || lane.type;
        lane.distance = parseFloat(el['gp-lane-dist']?.value) || lane.distance;
        dirtySectors.add(selectedLane.sectorId);
        redrawLanesForSector(selectedLane.sectorId);
        deselectAll();
        notify('Lane updated.', 'success');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  POLYGON DRAWING
    // ═══════════════════════════════════════════════════════════════════════════
    function startDrawMode() {
        setTool('draw');
        polyVertices = [];
        previewLayer.destroyChildren();
        setStatus('Draw sector: click vertices, double-click or click first vertex to close, ESC to cancel');
    }

    function handleDrawClick(pos) {
        if (polyVertices.length >= 3) {
            const fv = polyVertices[0];
            const pxDst = Math.hypot(pos.x - fv.x, pos.y - fv.y) * nodeLayer.scaleX();
            if (pxDst < 15) { finishPolygon(); return; }
        }
        const snap = getSnapTarget(pos.x, pos.y);
        const vx = snap ? snap.x : Math.round(pos.x);
        const vy = snap ? snap.y : Math.round(pos.y);
        polyVertices.push({ x: vx, y: vy });
        drawPolyPreview({ x: vx, y: vy }, snap);
        if (snap) setStatus('⊝ Snapped to existing vertex (' + vx + ', ' + vy + ')');
    }

    function drawPolyPreview(cursor, snapTarget) {
        previewLayer.destroyChildren();
        if (!polyVertices.length) return;

        const allPts = polyVertices.flatMap(v => [v.x, v.y]);
        previewLayer.add(new Konva.Line({
            points: allPts, stroke: '#ffd700', strokeWidth: 1.5, dash: [6, 3], listening: false,
        }));
        if (cursor) {
            const last = polyVertices[polyVertices.length - 1];
            previewLayer.add(new Konva.Line({
                points: [last.x, last.y, cursor.x, cursor.y],
                stroke: snapTarget ? '#00ffcc' : '#ffaa00',
                strokeWidth: 1, dash: [4, 4], listening: false,
            }));
        }
        polyVertices.forEach((v, i) => {
            previewLayer.add(new Konva.Circle({
                x: v.x, y: v.y,
                radius: i === 0 ? 7 : 4,
                fill: i === 0 ? '#ffd700' : '#ffaa00',
                stroke: '#fff', strokeWidth: 1, listening: false,
            }));
        });
        const fv = polyVertices[0];
        previewLayer.add(new Konva.Text({
            x: fv.x + 10, y: fv.y - 14,
            text: polyVertices.length + ' pts — dblclick or click ● to close',
            fontSize: 10, fontFamily: 'Share Tech Mono,monospace', fill: '#ffd700', listening: false,
        }));
        if (snapTarget && cursor) drawSnapIndicator(cursor.x, cursor.y);
    }

    async function finishPolygon() {
        if (polyVertices.length < 3) { notify('Need at least 3 vertices.', 'warning'); return; }
        const name = await promptModal('New Sector', 'SECTOR NAME', 'New Sector');
        if (!name) { cancelPolygon(); return; }

        const id    = 'sec_' + name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        const file  = 'data/sectors/' + id + '.json';
        const color = SECTOR_PALETTE[(universe.sectors_index?.length ?? 0) % SECTOR_PALETTE.length];

        try {
            const sd = { id, name, dimensions: { width: 1000, height: 1000 }, systems: [], jump_lanes: [] };
            await API.saveFile(file, sd);
            if (!universe.sectors_index) universe.sectors_index = [];
            universe.sectors_index.push({ id, name, file, color, polygon: [...polyVertices] });
            await API.saveUniverse(universe);
            sectorCache.set(id, sd);
            cancelPolygon();
            renderAll();
            selectSector(id);
            notify('Sector "' + name + '" created.', 'success');
        } catch (err) {
            notify('Error: ' + err.message, 'error');
            cancelPolygon();
        }
    }

    function cancelPolygon() {
        polyVertices = [];
        previewLayer.destroyChildren();
        const cc = el['gp-canvas-container'];
        if (cc) cc.classList.remove('draw-mode');
        setTool('select');
    }

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
            stroke: '#00ffcc', strokeWidth: 1.5, fill: 'rgba(0,255,204,0.18)', listening: false,
        }));
        previewLayer.add(new Konva.Text({
            x: x + sz, y: y - 7,
            text: '⊝ snap', fontSize: 8,
            fontFamily: 'Share Tech Mono,monospace',
            fill: '#00ffcc', opacity: 0.85, listening: false,
        }));
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  SAVE
    // ═══════════════════════════════════════════════════════════════════════════
    async function saveAll() {
        try {
            saveFactions();   // persist factions into universe object
            await API.saveUniverse(universe);
            for (const secId of dirtySectors) {
                const entry = universe.sectors_index.find(s => s.id === secId);
                const sd    = sectorCache.get(secId);
                if (entry?.file && sd) await API.saveFile(entry.file, sd);
            }
            dirtySectors.clear();
            notify('Everything saved.', 'success');
        } catch (err) { notify('Save failed: ' + err.message, 'error'); }
    }

    async function saveSector(sectorId) {
        const entry = universe.sectors_index.find(s => s.id === sectorId);
        const sd    = sectorCache.get(sectorId);
        if (!entry?.file || !sd) return;
        try {
            await API.saveFile(entry.file, sd);
            dirtySectors.delete(sectorId);
            notify('Sector saved.', 'success');
        } catch (err) { notify('Save failed: ' + err.message, 'error'); }
    }

    // ── Clear all systems & bodies (keep sectors) ──────────────────────────────
    async function clearAllSystems() {
        const ok = await showModal(
            '🗑 Clear All Systems & Bodies',
            '<b>This will delete ALL systems and body files from every sector.</b><br>' +
            'Sector polygons and names are preserved.<br><br>' +
            '<span style="color:#ff4444">This cannot be undone.</span>'
        );
        if (!ok) return;
        try {
            setStatus('Clearing systems & bodies...');
            // 1. Clear systems + jump_lanes from every cached sector
            for (const [secId, sd] of sectorCache) {
                sd.systems    = [];
                sd.jump_lanes = [];
                dirtySectors.add(secId);
            }
            // 2. Save all sectors
            await saveAll();
            // 3. Delete all files in data/systems/ and data/bodies/
            await API.clearDir('data/systems');
            await API.clearDir('data/bodies');
            // 4. Re-render
            selectedNode   = null;
            selectedLane   = null;
            renderAll();
            notify('All systems and bodies cleared.', 'warning', 5000);
            setStatus('Systems & bodies cleared. Sectors preserved.');
        } catch (err) {
            notify('Clear failed: ' + err.message, 'error');
        }
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  DELETE SECTOR
    // ═══════════════════════════════════════════════════════════════════════════
    async function deleteGalaxySectorById(id) {
        const entry = universe.sectors_index.find(s => s.id === id);
        const ok = await showModal(
            'Delete Sector',
            'Remove <b>' + (entry?.name || id) + '</b> from the galaxy?<br>' +
            '<small style="color:#888">The sector JSON file is kept on disk.</small>'
        );
        if (!ok) return;
        universe.sectors_index = universe.sectors_index.filter(s => s.id !== id);
        sectorCache.delete(id);
        dirtySectors.delete(id);
        await API.saveUniverse(universe);
        if (selectedSectorId === id) {
            selectedSectorId = null;
            deselectAll();
            if (el['gp-sector-props']) el['gp-sector-props'].style.display = 'none';
        }
        renderAll();
        notify('Sector removed from galaxy.', 'warning');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  FORGE
    // ═══════════════════════════════════════════════════════════════════════════
    async function forgeSector() {
        if (!selectedSectorId) { notify('Select a sector first.', 'warning'); return; }
        if (typeof SystemForge === 'undefined') { notify('System Forge not loaded.', 'error'); return; }

        const entry = universe.sectors_index.find(s => s.id === selectedSectorId);
        if (!entry?.file) return;

        let sd = sectorCache.get(selectedSectorId);
        if (!sd) {
            try { sd = await API.getFile(entry.file); sectorCache.set(selectedSectorId, sd); }
            catch (err) { notify('Could not load sector: ' + err.message, 'error'); return; }
        }
        if (!sd.systems) sd.systems = [];

        // Only keep systems that actually fall inside this sector's polygon
        const polygon = entry.polygon || [];
        if (polygon.length >= 3) {
            sd.systems = sd.systems.filter(sys =>
                pointInPolygon(sys.coordinates.x, sys.coordinates.y, polygon)
            );
        }

        // If no nodes exist yet, offer to scatter them first
        if (!sd.systems.length) {
            const countStr = await promptModal(
                'No Systems Found',
                'This sector has no system nodes.\nHow many should be scattered + forged?',
                '8'
            );
            if (!countStr) return;
            const num = Math.max(1, Math.min(50, parseInt(countStr) || 8));
            const positions = scatterInPolygon(polygon, num, 30);
            const fallback  = polygon.length ? sectorCentroid(polygon) : { x: 500, y: 500 };
            const ts = Date.now();
            for (let i = 0; i < num; i++) {
                const sysId = `sys_${ts.toString(36)}_${i.toString(16)}`;
                const pos = positions[i] || {
                    x: Math.round(fallback.x + (Math.random() - 0.5) * 40),
                    y: Math.round(fallback.y + (Math.random() - 0.5) * 40),
                };
                sd.systems.push({
                    id: sysId, name: `System ${i + 1}`,
                    coordinates: { x: pos.x, y: pos.y },
                    political_alignment: '', status: 'Unknown', file: '',
                    main: false,
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

        const prog = el['gp-forge-progress'];
        if (prog) { prog.textContent = 'Starting forge…'; prog.style.display = ''; }

        await SystemForge.populateSector(
            sd,
            (done, total) => { if (prog) prog.textContent = `Forging… ${done} / ${total}`; },
            async () => {
                sectorCache.set(selectedSectorId, sd);
                dirtySectors.add(selectedSectorId);
                await saveSector(selectedSectorId);
                renderAll();
                if (prog) {
                    prog.textContent = `✓ ${n} systems forged.`;
                    setTimeout(() => { prog.style.display = 'none'; }, 5000);
                }
                notify(`Forged ${n} systems in ${entry.name || entry.id}.`, 'success');
            }
        );
    }

    async function forgeSystem() {
        if (!selectedNode) { notify('Select a system node first.', 'warning'); return; }
        if (typeof SystemForge === 'undefined') { notify('System Forge module not loaded.', 'error'); return; }

        const sysId    = selectedNode.id;
        const sectorId = selectedNode.sectorId;
        const sd  = sectorCache.get(sectorId);
        const sys = sd?.systems?.find(s => s.id === sysId);
        if (!sys) return;

        await SystemForge.generateAndLink(sysId, {}, (filePath, starName, starColor) => {
            sys.name = starName;
            sys.file = filePath;
            sys.star_color = starColor;
            dirtySectors.add(sectorId);
            if (el['gp-node-name']) el['gp-node-name'].value = starName;
            if (el['gp-node-file']) el['gp-node-file'].value = filePath;
            const old = nodeLayer.findOne('#' + sysId);
            if (old) old.destroy();
            const entry = universe.sectors_index.find(s => s.id === sectorId);
            createSystemNode(sys, sectorId, entry?.color || '#00d2ff');
            updateLOD(nodeLayer.scaleX());
            const grp = nodeLayer.findOne('#' + sysId);
            if (grp) selectNode(sysId, sectorId, grp);
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  FIT
    // ═══════════════════════════════════════════════════════════════════════════
    function fitPoints(pts) {
        if (!pts.length) return;
        const xs = pts.map(p => p.x), ys = pts.map(p => p.y);
        const minX = Math.min(...xs), maxX = Math.max(...xs);
        const minY = Math.min(...ys), maxY = Math.max(...ys);
        const pw = stage.width(), ph = stage.height();
        const dw = maxX - minX || 400, dh = maxY - minY || 400;
        const sc = Math.min(pw / (dw + 200), ph / (dh + 200), 2);
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        [bgLayer, refLayer, polyLayer, laneLayer, nodeLayer, previewLayer].forEach(l => {
            l.scale({ x: sc, y: sc });
            l.position({ x: pw / 2 - cx * sc, y: ph / 2 - cy * sc });
        });
        syncDensityCanvasSize();
        updateLOD(sc);
    }

    function fitGalaxy() {
        const pts = (universe?.sectors_index ?? []).flatMap(s => s.polygon ?? []);
        if (pts.length) fitPoints(pts);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  SCATTER (galaxy-space within selected sector polygon)
    // ═══════════════════════════════════════════════════════════════════════════
    function scatterBBox() {
        const entry = (universe?.sectors_index ?? []).find(s => s.id === selectedSectorId);
        if (!entry?.polygon?.length) return null;
        return polyBBox(entry.polygon);
    }

    function gridToScene(gx, gy) {
        const bb = scatterBBox();
        if (!bb) return { x: 0, y: 0 };
        const w = (bb.maxX - bb.minX) || 1, h = (bb.maxY - bb.minY) || 1;
        return { x: bb.minX + (gx / DENSITY_W) * w, y: bb.minY + (gy / DENSITY_H) * h };
    }

    function sceneToGrid(sx, sy) {
        const bb = scatterBBox();
        if (!bb) return { gx: 0, gy: 0 };
        const w = (bb.maxX - bb.minX) || 1, h = (bb.maxY - bb.minY) || 1;
        return {
            gx: Math.round(((sx - bb.minX) / w) * DENSITY_W),
            gy: Math.round(((sy - bb.minY) / h) * DENSITY_H),
        };
    }

    function syncDensityCanvasSize() {
        const dc = el['gp-density-canvas'];
        if (!dc || !stage) return;
        dc.width  = stage.width();
        dc.height = stage.height();
        renderDensityCanvas();
    }

    function showDensityCanvas() { if (el['gp-density-canvas']) el['gp-density-canvas'].style.display = ''; }
    function hideDensityCanvas() { if (el['gp-density-canvas']) el['gp-density-canvas'].style.display = 'none'; }
    function showBrushCursor()   { if (el['gp-brush-cursor'])   el['gp-brush-cursor'].style.display   = ''; }
    function hideBrushCursor()   { if (el['gp-brush-cursor'])   el['gp-brush-cursor'].style.display   = 'none'; }

    function updateBrushCursor(ev) {
        const bc = el['gp-brush-cursor'];
        if (!bc) return;
        const rect = (el['gp-canvas-container'] || stage.container()).getBoundingClientRect();
        bc.style.left   = (ev.clientX - rect.left) + 'px';
        bc.style.top    = (ev.clientY - rect.top)  + 'px';
        const pxR = brushSceneToPx();
        bc.style.width  = (pxR * 2) + 'px';
        bc.style.height = (pxR * 2) + 'px';
    }

    function brushSceneToPx() {
        return parseFloat(el['gp-scat-size']?.value ?? 80) * nodeLayer.scaleX();
    }

    function paintAtEvent(ev) {
        const rect   = stage.container().getBoundingClientRect();
        const scale  = nodeLayer.scaleX();
        const sceneX = (ev.clientX - rect.left - nodeLayer.x()) / scale;
        const sceneY = (ev.clientY - rect.top  - nodeLayer.y()) / scale;
        const brushR = parseFloat(el['gp-scat-size']?.value ?? 80);
        const str    = parseFloat(el['gp-scat-strength']?.value ?? 60) / 100;
        paintDensity(sceneX, sceneY, brushR, str, scatterErasing);
        renderDensityCanvas();
    }

    function paintDensity(sx, sy, radiusScene, strength, erase) {
        const bb = scatterBBox();
        if (!bb) return;
        const w = (bb.maxX - bb.minX) || 1;
        const { gx: gcx, gy: gcy } = sceneToGrid(sx, sy);
        const grR = Math.max(1, Math.round((radiusScene / w) * DENSITY_W));
        for (let dy = -grR; dy <= grR; dy++) {
            for (let dx = -grR; dx <= grR; dx++) {
                const gx = gcx + dx, gy = gcy + dy;
                if (gx < 0 || gx >= DENSITY_W || gy < 0 || gy >= DENSITY_H) continue;
                const d = Math.hypot(dx, dy) / grR;
                if (d > 1) continue;
                const g   = Math.exp(-d * d * 2.5);
                const idx = gy * DENSITY_W + gx;
                if (erase) densityGrid[idx] = Math.max(0, densityGrid[idx] - g * strength * 0.6);
                else       densityGrid[idx] = Math.min(1, densityGrid[idx] + g * strength * 0.3);
            }
        }
    }

    function renderDensityCanvas() {
        const dc = el['gp-density-canvas'];
        const bb = scatterBBox();
        if (!dc || !bb) return;
        const ctx = dc.getContext('2d');
        const w = dc.width, h = dc.height;
        ctx.clearRect(0, 0, w, h);
        const bw = (bb.maxX - bb.minX) || 1, bh = (bb.maxY - bb.minY) || 1;
        const scale = nodeLayer.scaleX();
        const offX  = nodeLayer.x(), offY = nodeLayer.y();
        const img   = ctx.createImageData(w, h);
        const pxW = Math.ceil((bw / DENSITY_W) * scale) + 2;
        const pxH = Math.ceil((bh / DENSITY_H) * scale) + 2;

        for (let gy = 0; gy < DENSITY_H; gy++) {
            for (let gx = 0; gx < DENSITY_W; gx++) {
                const v = densityGrid[gy * DENSITY_W + gx];
                if (v < 0.01) continue;
                const sceneX = bb.minX + ((gx + 0.5) / DENSITY_W) * bw;
                const sceneY = bb.minY + ((gy + 0.5) / DENSITY_H) * bh;
                const px = Math.round(sceneX * scale + offX);
                const py = Math.round(sceneY * scale + offY);
                const r = 255, g = Math.round(80 + v * 175), b = Math.round(v * 40), a = Math.round(v * 180);
                for (let ry = 0; ry < pxH; ry++) {
                    for (let rx = 0; rx < pxW; rx++) {
                        const pixx = px + rx - Math.floor(pxW / 2);
                        const pixy = py + ry - Math.floor(pxH / 2);
                        if (pixx < 0 || pixx >= w || pixy < 0 || pixy >= h) continue;
                        const i = (pixy * w + pixx) * 4;
                        if (a > img.data[i + 3]) { img.data[i] = r; img.data[i+1] = g; img.data[i+2] = b; img.data[i+3] = a; }
                    }
                }
            }
        }
        ctx.putImageData(img, 0, 0);
    }

    function clearDensity() {
        densityGrid.fill(0);
        previewSystems = null;
        renderDensityCanvas();
        if (el['gp-scat-commit']) el['gp-scat-commit'].disabled = true;
        if (el['gp-scat-info'])   el['gp-scat-info'].textContent = 'Paint a density map, then preview.';
    }

    function makePRNG(seed) {
        let s = seed >>> 0;
        return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    }

    function previewScatter() {
        if (!selectedSectorId) { notify('Select a sector first.', 'warning'); return; }
        const bb = scatterBBox();
        if (!bb) { notify('No polygon for selected sector.', 'warning'); return; }
        const entry   = universe.sectors_index.find(s => s.id === selectedSectorId);
        const polygon = entry?.polygon;

        const count  = Math.max(1, parseInt(el['gp-scat-count']?.value ?? 30));
        const minSep = parseFloat(el['gp-scat-minsep']?.value ?? 25);
        const prefix = (el['gp-scat-prefix']?.value ?? 'sys').trim() || 'sys';
        const seed   = parseInt(el['gp-scat-seed']?.value ?? 42);
        const bw = (bb.maxX - bb.minX) || 1, bh = (bb.maxY - bb.minY) || 1;
        const rng = makePRNG(seed);

        let total = 0;
        const cum = new Float64Array(DENSITY_W * DENSITY_H);
        for (let i = 0; i < densityGrid.length; i++) { total += densityGrid[i]; cum[i] = total; }
        const useUniform = total < 0.001;

        const sd = sectorCache.get(selectedSectorId);
        const existing = (sd?.systems ?? []).map(s => s.coordinates);
        const placed = [], results = [];
        const maxTries = count * 40;
        let tries = 0;

        while (results.length < count && tries < maxTries) {
            tries++;
            let gx, gy;
            if (useUniform) {
                gx = rng() * DENSITY_W; gy = rng() * DENSITY_H;
            } else {
                const r = rng() * total;
                let lo = 0, hi = cum.length - 1;
                while (lo < hi) { const m = (lo + hi) >> 1; cum[m] < r ? (lo = m + 1) : (hi = m); }
                gx = lo % DENSITY_W + rng() - 0.5;
                gy = Math.floor(lo / DENSITY_W) + rng() - 0.5;
                gx = Math.min(DENSITY_W - 1, Math.max(0, gx));
                gy = Math.min(DENSITY_H - 1, Math.max(0, gy));
            }
            const sx = bb.minX + ((gx + rng() * 0.8 - 0.4) / DENSITY_W) * bw;
            const sy = bb.minY + ((gy + rng() * 0.8 - 0.4) / DENSITY_H) * bh;
            if (polygon?.length >= 3 && !pointInPolygon(sx, sy, polygon)) continue;
            const tooClose = [...existing, ...placed].some(p => Math.hypot(p.x - sx, p.y - sy) < minSep);
            if (tooClose) continue;
            placed.push({ x: sx, y: sy });
            results.push({ x: Math.round(sx), y: Math.round(sy), name: prefix + '_' + (results.length + 1) });
        }

        previewSystems = results;
        renderAll();
        const n = results.length;
        if (el['gp-scat-info'])   el['gp-scat-info'].textContent = 'Preview: ' + n + '/' + count + ' placed (' + tries + ' tries)';
        if (el['gp-scat-commit']) el['gp-scat-commit'].disabled = n === 0;
        notify('Scatter preview: ' + n + ' systems.' + (useUniform ? ' No density — used uniform.' : ''), n > 0 ? 'info' : 'warning', 5000);
    }

    function commitScatter() {
        if (!previewSystems?.length || !selectedSectorId) { notify('Nothing to commit.', 'warning'); return; }
        const sd = sectorCache.get(selectedSectorId);
        if (!sd) return;
        if (!sd.systems) sd.systems = [];
        const ts = Date.now();
        previewSystems.forEach((ps, i) => {
            const id = ps.name + '_' + ts + '_' + i;
            sd.systems.push({
                id, name: ps.name,
                coordinates: { x: ps.x, y: ps.y },
                political_alignment: '', status: 'Unknown',
                file: 'data/systems/' + id + '.json',
                main: false,
            });
        });
        dirtySectors.add(selectedSectorId);
        const added = previewSystems.length;
        previewSystems = null;
        clearDensity();
        renderAll();
        updateCounts();
        notify(added + ' systems committed.', 'success');
        if (el['gp-scat-commit']) el['gp-scat-commit'].disabled = true;
        if (el['gp-scat-info'])   el['gp-scat-info'].textContent = added + ' systems added.';
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  REFERENCE IMAGE
    // ═══════════════════════════════════════════════════════════════════════════
    function drawRefImage(src) {
        refLayer.destroyChildren();
        refImageNode = null;
        const img = new window.Image();
        img.onload = () => {
            refImageNode = new Konva.Image({
                image: img, x: 0, y: 0,
                width: img.naturalWidth, height: img.naturalHeight,
                opacity: parseFloat(el['gp-ref-opacity']?.value ?? 35) / 100,
                draggable: true,
                listening: true,
            });
            refLayer.add(refImageNode);
            if (el['gp-ref-controls']) el['gp-ref-controls'].style.display = '';
            if (el['gp-ref-toggle'])   el['gp-ref-toggle'].textContent     = '👁 HIDE';
            // sync scale UI
            if (el['gp-ref-scale'])     el['gp-ref-scale'].value = 100;
            if (el['gp-ref-scale-val']) el['gp-ref-scale-val'].textContent = '100%';
            if (el['gp-ref-pos-x'])     el['gp-ref-pos-x'].value = 0;
            if (el['gp-ref-pos-y'])     el['gp-ref-pos-y'].value = 0;
            // Update position fields when dragged
            refImageNode.on('dragend', () => {
                if (el['gp-ref-pos-x']) el['gp-ref-pos-x'].value = Math.round(refImageNode.x());
                if (el['gp-ref-pos-y']) el['gp-ref-pos-y'].value = Math.round(refImageNode.y());
            });
            notify('Reference loaded (' + img.naturalWidth + '×' + img.naturalHeight + ')', 'info');
        };
        img.src = src;
    }

    function clearRefImage() {
        refLayer.destroyChildren();
        refImageNode = null;
        if (el['gp-ref-controls']) el['gp-ref-controls'].style.display = 'none';
        notify('Reference cleared.', 'info');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  COUNTS
    // ═══════════════════════════════════════════════════════════════════════════
    function updateCounts() {
        if (el['gp-count-sectors']) el['gp-count-sectors'].textContent = universe?.sectors_index?.length ?? 0;
        if (el['gp-count-systems']) el['gp-count-systems'].textContent = totalSystemCount();
        let lanes = 0;
        for (const sd of sectorCache.values()) lanes += (sd.jump_lanes?.length ?? 0);
        if (el['gp-count-lanes']) el['gp-count-lanes'].textContent = lanes;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  FACTIONS
    // ═══════════════════════════════════════════════════════════════════════════
    function loadFactions() {
        factions = universe?.factions || [];
        renderFactionList();
        refreshAlignDropdown();
    }

    function saveFactions() {
        if (universe) universe.factions = factions;
    }

    function renderFactionList() {
        const container = el['gp-faction-list'];
        if (!container) return;
        container.innerHTML = '';
        factions.forEach((f, i) => {
            const row = document.createElement('div');
            row.style.cssText = 'display:flex;align-items:center;gap:4px;';
            const span = document.createElement('span');
            span.style.cssText = 'flex:1;font-size:0.75rem;color:#ccc';
            span.textContent = f;
            const stampBtn = document.createElement('button');
            stampBtn.className = 'btn btn-sm';
            stampBtn.title = 'Stamp: ' + f;
            stampBtn.style.cssText = 'padding:0 4px;font-size:0.65rem;' + (factionStamp === f ? 'background:#ffd700;color:#000' : '');
            stampBtn.textContent = '\u{1F3AF}';
            stampBtn.addEventListener('click', () => setFactionStamp(factionStamp === f ? null : f));
            const delBtn = document.createElement('button');
            delBtn.className = 'btn btn-sm btn-danger';
            delBtn.title = 'Remove';
            delBtn.style.cssText = 'padding:0 4px;font-size:0.65rem';
            delBtn.textContent = '\u2715';
            delBtn.addEventListener('click', () => {
                if (factionStamp === f) setFactionStamp(null);
                factions.splice(i, 1);
                saveFactions();
                renderFactionList();
                refreshAlignDropdown();
            });
            row.appendChild(span);
            row.appendChild(stampBtn);
            row.appendChild(delBtn);
            container.appendChild(row);
        });
    }

    function addFaction() {
        const inp = el['gp-faction-new'];
        if (!inp) return;
        const name = inp.value.trim();
        if (!name || factions.includes(name)) return;
        factions.push(name);
        inp.value = '';
        saveFactions();
        renderFactionList();
        refreshAlignDropdown();
    }

    function refreshAlignDropdown() {
        const sel = el['gp-node-align'];
        if (!sel) return;
        const current = sel.value;
        sel.innerHTML = '<option value="">— none —</option>';
        factions.forEach(f => {
            const opt = document.createElement('option');
            opt.value = f;
            opt.textContent = f;
            sel.appendChild(opt);
        });
        sel.value = current;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  STATUS STAMP MODE
    // ═══════════════════════════════════════════════════════════════════════════
    function setStamp(status) {
        stampStatus = status || null;
        if (stampStatus && factionStamp) setFactionStamp(null);
        document.querySelectorAll('.gp-stamp-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.stamp === stampStatus);
        });
        if (el['gp-stamp-active']) el['gp-stamp-active'].style.display = stampStatus ? '' : 'none';
        if (el['gp-stamp-label'])  el['gp-stamp-label'].textContent = stampStatus || '';
        if (stampStatus) {
            setStatus('Stamp mode: click systems to set ' + stampStatus);
        }
    }

    function applyStampToSystem(sysId, sectorId) {
        if (!stampStatus) return;
        const sd  = sectorCache.get(sectorId);
        const sys = sd?.systems?.find(s => s.id === sysId);
        if (!sys) return;
        sys.status = stampStatus;
        dirtySectors.add(sectorId);
        // Rebuild node
        const oldGrp = nodeLayer.findOne('#' + sysId);
        if (oldGrp) oldGrp.destroy();
        const entry = universe.sectors_index.find(s => s.id === sectorId);
        createSystemNode(sys, sectorId, entry?.color || '#00d2ff');
        updateLOD(nodeLayer.scaleX());
        notify(sys.name + ' → ' + stampStatus, 'info', 1500);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  FACTION STAMP MODE
    // ═══════════════════════════════════════════════════════════════════════════
    function setFactionStamp(f) {
        factionStamp = f || null;
        if (factionStamp && stampStatus) setStamp(null);
        renderFactionList();
        if (el['gp-fstamp-active']) el['gp-fstamp-active'].style.display = factionStamp ? '' : 'none';
        if (el['gp-fstamp-label'])  el['gp-fstamp-label'].textContent = factionStamp || '';
        if (factionStamp) {
            setStatus('Faction stamp: click systems to assign ' + factionStamp);
        }
    }

    function applyFactionStampToSystem(sysId, sectorId) {
        if (!factionStamp) return;
        const sd  = sectorCache.get(sectorId);
        const sys = sd?.systems?.find(s => s.id === sysId);
        if (!sys) return;
        sys.political_alignment = factionStamp;
        dirtySectors.add(sectorId);
        notify(sys.name + ' → ' + factionStamp, 'info', 1500);
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  EVENT WIRING
    // ═══════════════════════════════════════════════════════════════════════════
    function wireEvents() {
        // ── Tool buttons ──────────────────────────────────────────────────────
        document.querySelectorAll('[data-gtool]').forEach(btn => {
            btn.addEventListener('click', () => {
                const t = btn.dataset.gtool;
                if (t === 'draw') { startDrawMode(); return; }
                cancelPolygon();
                setTool(t);
            });
        });

        // ── Save + Fit ────────────────────────────────────────────────────────
        el['gp-save-all']?.addEventListener('click', saveAll);
        el['gp-fit-view']?.addEventListener('click', fitGalaxy);
        el['gp-clear-systems']?.addEventListener('click', clearAllSystems);

        // ── Snap options ──────────────────────────────────────────────────────
        el['gp-snap-enabled']?.addEventListener('change', () => { snapEnabled = el['gp-snap-enabled'].checked; });
        el['gp-snap-thresh']?.addEventListener('input',   () => { snapThreshPx = parseInt(el['gp-snap-thresh'].value) || 18; });

        // ── Sector properties ─────────────────────────────────────────────────
        el['gp-sec-color-picker']?.addEventListener('input', ev => {
            if (el['gp-sec-color']) el['gp-sec-color'].value = ev.target.value;
        });
        el['gp-sec-apply']?.addEventListener('click', async () => {
            if (!selectedSectorId) return;
            const entry = universe.sectors_index.find(s => s.id === selectedSectorId);
            if (!entry) return;
            entry.name  = el['gp-sec-name']?.value.trim()  || entry.name;
            entry.color = el['gp-sec-color']?.value.trim() || entry.color;
            await API.saveUniverse(universe);
            renderAll();
            selectSector(selectedSectorId);
            notify('Sector updated.', 'success');
        });
        el['gp-sec-forge']?.addEventListener('click', forgeSector);

        // ── System properties ─────────────────────────────────────────────────
        el['gp-node-apply']?.addEventListener('click', applyNodeEdit);
        el['gp-node-open-system']?.addEventListener('click', () => {
            const file = el['gp-node-file']?.value;
            if (file && typeof OrreryBuilder !== 'undefined') {
                document.querySelector('[data-module="orrery"]')?.click();
                OrreryBuilder.loadByFile(file);
            }
        });
        el['gp-node-forge']?.addEventListener('click', forgeSystem);

        // ── Lane properties ───────────────────────────────────────────────────
        el['gp-lane-apply']?.addEventListener('click', applyLaneEdit);
        el['gp-lane-delete']?.addEventListener('click', () => {
            if (selectedLane) deleteLane(selectedLane.from, selectedLane.to, selectedLane.sectorId);
        });

        // ── Factions ──────────────────────────────────────────────────────────
        el['gp-faction-add']?.addEventListener('click', addFaction);
        el['gp-faction-new']?.addEventListener('keydown', e => { if (e.key === 'Enter') addFaction(); });

        // ── Status stamp ──────────────────────────────────────────────────────
        document.querySelectorAll('.gp-stamp-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                setStamp(btn.dataset.stamp === stampStatus ? null : btn.dataset.stamp);
            });
        });
        el['gp-stamp-cancel']?.addEventListener('click', () => setStamp(null));

        // ── Faction stamp ─────────────────────────────────────────────────────
        el['gp-fstamp-cancel']?.addEventListener('click', () => setFactionStamp(null));

        // ── Scatter ───────────────────────────────────────────────────────────
        el['gp-scat-size']?.addEventListener('input', () => {
            if (el['gp-scat-size-val']) el['gp-scat-size-val'].textContent = el['gp-scat-size'].value;
        });
        el['gp-scat-strength']?.addEventListener('input', () => {
            if (el['gp-scat-strength-val']) el['gp-scat-strength-val'].textContent = el['gp-scat-strength'].value + '%';
        });
        el['gp-scat-randseed']?.addEventListener('click', () => {
            if (el['gp-scat-seed']) el['gp-scat-seed'].value = Math.floor(Math.random() * 99999);
        });
        el['gp-scat-preview']?.addEventListener('click',       previewScatter);
        el['gp-scat-commit']?.addEventListener('click',        commitScatter);
        el['gp-scat-clear-density']?.addEventListener('click', () => { clearDensity(); notify('Density cleared.', 'info'); });

        // ── BG Reference ──────────────────────────────────────────────────────
        el['gp-ref-load']?.addEventListener('click', () => el['gp-ref-file']?.click());
        el['gp-ref-file']?.addEventListener('change', ev => {
            const file = ev.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = evt => drawRefImage(evt.target.result);
            reader.readAsDataURL(file);
            ev.target.value = '';
        });
        el['gp-ref-opacity']?.addEventListener('input', () => {
            const v = parseFloat(el['gp-ref-opacity'].value) / 100;
            if (el['gp-ref-opacity-val']) el['gp-ref-opacity-val'].textContent = el['gp-ref-opacity'].value + '%';
            if (refImageNode) refImageNode.opacity(v);
        });
        el['gp-ref-toggle']?.addEventListener('click', () => {
            if (!refImageNode) return;
            const vis = refImageNode.visible();
            refImageNode.visible(!vis);
            el['gp-ref-toggle'].textContent = vis ? '👁 SHOW' : '👁 HIDE';
        });
        el['gp-ref-clear']?.addEventListener('click', clearRefImage);
        el['gp-ref-scale']?.addEventListener('input', () => {
            const pct = parseFloat(el['gp-ref-scale'].value) || 100;
            if (el['gp-ref-scale-val']) el['gp-ref-scale-val'].textContent = pct + '%';
            if (refImageNode) {
                const s = pct / 100;
                refImageNode.scaleX(s);
                refImageNode.scaleY(s);
            }
        });
        el['gp-ref-pos-apply']?.addEventListener('click', () => {
            if (!refImageNode) return;
            refImageNode.x(parseFloat(el['gp-ref-pos-x']?.value) || 0);
            refImageNode.y(parseFloat(el['gp-ref-pos-y']?.value) || 0);
        });
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  PUBLIC API
    // ═══════════════════════════════════════════════════════════════════════════
    return {
        init() {
            cacheEls();
            setupStage();
            wireEvents();
            loadGalaxy().catch(err => notify('Galaxy Plotter: ' + err.message, 'error'));
        },
        reload: loadGalaxy,
        /** Called by Orrery when a system is saved — syncs name/star_color in sector cache. */
        syncSystemFromFile(filePath, systemData) {
            for (const [secId, sd] of sectorCache) {
                const sys = sd.systems?.find(s => s.file === filePath);
                if (sys) {
                    sys.name       = systemData.name || systemData.star?.name || sys.name;
                    sys.star_color = systemData.star?.color_hex || sys.star_color;
                    dirtySectors.add(secId);
                    // Rebuild the Konva node
                    const oldGrp = nodeLayer.findOne('#' + sys.id);
                    if (oldGrp) oldGrp.destroy();
                    const entry = universe.sectors_index.find(s => s.id === secId);
                    createSystemNode(sys, secId, entry?.color || '#00d2ff');
                    updateLOD(nodeLayer.scaleX());
                    return;
                }
            }
        },
    };

})();
