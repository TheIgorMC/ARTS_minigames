// =============================================================================
//  GEMINI ARCHITECT — Settlement Generator v3
//  Graph-based connected road network, road-aligned buildings, density maps
// =============================================================================

const SettlementGenerator = (() => {

    // ── Seeded RNG ──────────────────────────────────────────────────────────
    class RNG {
        constructor(seed) {
            if (typeof seed === 'string') {
                let h = 0;
                for (let i = 0; i < seed.length; i++) h = ((h << 5) - h + seed.charCodeAt(i)) | 0;
                this.s = Math.abs(h) || 1;
            } else {
                this.s = Math.abs(Math.floor(seed * 100000)) || 1;
            }
        }
        next() { this.s = (this.s * 9301 + 49297) % 233280; return this.s / 233280; }
        range(a, b) { return Math.floor(this.next() * (b - a + 1)) + a; }
        float(a, b) { return a + this.next() * (b - a); }
        choice(arr) { return arr[Math.floor(this.next() * arr.length)]; }
    }

    // ── Geometry ────────────────────────────────────────────────────────────
    function dist(a, b) { return Math.hypot(b[0] - a[0], b[1] - a[1]); }

    function distToSeg(px, py, ax, ay, bx, by) {
        const dx = bx - ax, dy = by - ay, lenSq = dx * dx + dy * dy;
        if (lenSq < 0.001) return Math.hypot(px - ax, py - ay);
        const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
        return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    }

    function pointInPoly(pt, poly) {
        const [x, y] = pt; let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const [xi, yi] = poly[i], [xj, yj] = poly[j];
            if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
    }

    function rotRect(cx, cy, w, h, angle) {
        const c = Math.cos(angle), s = Math.sin(angle), hw = w / 2, hh = h / 2;
        return [
            [cx - c * hw + s * hh, cy - s * hw - c * hh],
            [cx + c * hw + s * hh, cy + s * hw - c * hh],
            [cx + c * hw - s * hh, cy + s * hw + c * hh],
            [cx - c * hw - s * hh, cy - s * hw + c * hh],
            [cx - c * hw + s * hh, cy - s * hw - c * hh]
        ];
    }

    // ── Size configs ────────────────────────────────────────────────────────
    const CFG = {
        tiny:       { radius: 300,   primary: 3,  rings: 1, secProb: 0.55, tertProb: 0.35, maxBldg: 400,   parks: 1  },
        small:      { radius: 700,   primary: 4,  rings: 2, secProb: 0.60, tertProb: 0.40, maxBldg: 1500,  parks: 2  },
        medium:     { radius: 1500,  primary: 6,  rings: 3, secProb: 0.65, tertProb: 0.45, maxBldg: 5000,  parks: 4  },
        large:      { radius: 3000,  primary: 8,  rings: 4, secProb: 0.70, tertProb: 0.50, maxBldg: 14000, parks: 7  },
        metropolis: { radius: 7000,  primary: 12, rings: 6, secProb: 0.75, tertProb: 0.55, maxBldg: 40000, parks: 12 }
    };

    // ── Boundary shapes ─────────────────────────────────────────────────────
    function generateBoundary(shape, cx, cy, radius, rng) {
        const pts = [], N = 36;
        switch (shape) {
            case 'rectangle': {
                const hw = radius * rng.float(0.85, 1.2), hh = radius * rng.float(0.6, 0.95);
                const c = [[-hw,-hh],[hw,-hh],[hw,hh],[-hw,hh]];
                for (let i = 0; i < 4; i++) {
                    const [ax, ay] = c[i], [bx, by] = c[(i+1)%4];
                    for (let j = 0; j < 9; j++) {
                        const t = j / 9;
                        pts.push([cx + ax + (bx-ax)*t + rng.float(-radius*0.02,radius*0.02),
                                  cy + ay + (by-ay)*t + rng.float(-radius*0.02,radius*0.02)]);
                    }
                }
                break;
            }
            case 'oval': {
                const rx = radius * rng.float(1.2, 1.5), ry = radius * rng.float(0.55, 0.8);
                for (let i = 0; i < N; i++) {
                    const a = (Math.PI * 2 / N) * i;
                    pts.push([cx + Math.cos(a) * rx * rng.float(0.96, 1.04),
                              cy + Math.sin(a) * ry * rng.float(0.96, 1.04)]);
                }
                break;
            }
            case 'star': {
                const arms = rng.range(5, 8);
                for (let i = 0; i < arms * 6; i++) {
                    const a = (Math.PI * 2 / (arms * 6)) * i;
                    const peak = (i % 6) < 3;
                    const r = peak ? radius * rng.float(0.95, 1.15) : radius * rng.float(0.5, 0.65);
                    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
                }
                break;
            }
            case 'linear': {
                const len = radius * 2.5, w = radius * 0.35;
                const c = [[-len/2,-w],[len/2,-w],[len/2,w],[-len/2,w]];
                for (let i = 0; i < 4; i++) {
                    const [ax, ay] = c[i], [bx, by] = c[(i+1)%4];
                    const steps = i % 2 === 0 ? 16 : 4;
                    for (let j = 0; j < steps; j++) {
                        const t = j / steps;
                        pts.push([cx + ax + (bx-ax)*t + rng.float(-w*0.06,w*0.06),
                                  cy + ay + (by-ay)*t + rng.float(-w*0.06,w*0.06)]);
                    }
                }
                break;
            }
            default: // circle
                for (let i = 0; i < N; i++) {
                    const a = (Math.PI * 2 / N) * i;
                    pts.push([cx + Math.cos(a) * radius * rng.float(0.82, 1.15),
                              cy + Math.sin(a) * radius * rng.float(0.82, 1.15)]);
                }
        }
        pts.push(pts[0].slice());
        return pts;
    }

    function computeBounds(poly) {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [x, y] of poly) {
            minX = Math.min(minX, x); minY = Math.min(minY, y);
            maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
        return { minX, minY, maxX, maxY };
    }

    // ── Density map ─────────────────────────────────────────────────────────
    function createDefaultDensity(bounds, cx, cy, centers) {
        const cell = 30;
        const cols = Math.ceil((bounds.maxX - bounds.minX) / cell);
        const rows = Math.ceil((bounds.maxY - bounds.minY) / cell);
        const cells = new Float32Array(cols * rows);
        const maxD = Math.hypot(bounds.maxX - bounds.minX, bounds.maxY - bounds.minY) / 2;
        const cList = centers && centers.length > 0 ? centers : [[cx, cy]];
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const x = bounds.minX + (c + 0.5) * cell;
                const y = bounds.minY + (r + 0.5) * cell;
                let minD = Infinity;
                for (const [px, py] of cList) { const d = Math.hypot(x - px, y - py); if (d < minD) minD = d; }
                cells[r * cols + c] = Math.max(0.05, 1 - minD / maxD * 1.2);
            }
        }
        return { cellSize: cell, originX: bounds.minX, originY: bounds.minY, cols, rows, cells };
    }

    function sampleDensity(x, y, dm) {
        if (!dm) return 0.5;
        const c = Math.floor((x - dm.originX) / dm.cellSize);
        const r = Math.floor((y - dm.originY) / dm.cellSize);
        if (c < 0 || c >= dm.cols || r < 0 || r >= dm.rows) return 0;
        return dm.cells[r * dm.cols + c];
    }

    // ── Road graph ──────────────────────────────────────────────────────────
    // Nodes: [{x, y}]  Edges: [{from, to, hierarchy, width, userDrawn}]
    // All generated roads START from existing nodes → connected by construction

    function buildRoadNetwork(cx, cy, radius, boundary, userRoads, densityMap, rng, cfg, expMul, centers) {
        const step = Math.max(35, radius / Math.max(8, Math.floor(radius / 55)));
        const SNAP = Math.min(step * 0.4, 25);
        const nodes = [];
        const edges = [];
        const edgeSet = new Set();
        const nHash = new Map();
        const CELL = Math.max(20, SNAP * 1.5);

        function addNode(x, y) {
            const gx = Math.floor(x / CELL), gy = Math.floor(y / CELL);
            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    for (const i of (nHash.get(`${gx+dx},${gy+dy}`) || [])) {
                        if (dist([x, y], [nodes[i].x, nodes[i].y]) < SNAP) return i;
                    }
                }
            }
            const i = nodes.length;
            nodes.push({ x, y });
            const k = `${gx},${gy}`;
            if (!nHash.has(k)) nHash.set(k, []);
            nHash.get(k).push(i);
            return i;
        }

        function edgeKey(a, b) { return a < b ? `${a},${b}` : `${b},${a}`; }
        function edgeExists(a, b) { return edgeSet.has(edgeKey(a, b)); }
        function addEdge(from, to, hierarchy, width, userDrawn) {
            const k = edgeKey(from, to);
            if (edgeSet.has(k)) return;
            edgeSet.add(k);
            edges.push({ from, to, hierarchy, width, userDrawn: userDrawn || false });
        }

        // Nearest-center distance helper (for multi-nuclei cities)
        function nearestCenterDist(x, y) {
            let min = Infinity;
            for (const [px, py] of centers) { const d = Math.hypot(x - px, y - py); if (d < min) min = d; }
            return min;
        }

        // Center nodes + inter-center boulevard roads
        const centerIndices = centers.map(([x, y]) => addNode(x, y));
        for (let ci = 1; ci < centerIndices.length; ci++) {
            const fc = centers[ci - 1], tc = centers[ci];
            const blvdDist = dist(fc, tc);
            const blvdSteps = Math.max(2, Math.floor(blvdDist / step));
            let prev = centerIndices[ci - 1];
            for (let s = 1; s <= blvdSteps; s++) {
                const t = s / blvdSteps;
                const nx = fc[0] + (tc[0] - fc[0]) * t + rng.float(-2, 2);
                const ny = fc[1] + (tc[1] - fc[1]) * t + rng.float(-2, 2);
                const idx = s === blvdSteps ? centerIndices[ci] : addNode(nx, ny);
                if (idx !== prev) addEdge(prev, idx, 'primary', 16);
                prev = idx;
            }
        }

        // ── User roads ──────────────────────────────────────────────────
        for (const road of userRoads) {
            const pts = road.geometry?.coordinates;
            if (!pts || pts.length < 2) continue;
            let prev = addNode(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) {
                const next = addNode(pts[i][0], pts[i][1]);
                if (next !== prev) {
                    addEdge(prev, next, road.properties?.hierarchy || 'primary', road.properties?.width || 14, true);
                    prev = next;
                }
            }
        }

        // ── Primary radial roads (from each center nucleus) ────────────
        const stepsN = Math.floor(radius * 1.05 / step);
        const userAngles = userRoads.map(r => {
            const p = r.geometry?.coordinates;
            return p && p.length >= 2 ? Math.atan2(p[p.length-1][1] - p[0][1], p[p.length-1][0] - p[0][0]) : null;
        }).filter(a => a !== null);

        const primaryNodes = new Set();
        for (const ci of centerIndices) primaryNodes.add(ci);
        const primaryPerCenter = Math.max(3, Math.ceil(cfg.primary / centers.length));

        for (let ci = 0; ci < centers.length; ci++) {
            const [ccx, ccy] = centers[ci];
            const cIdx = centerIndices[ci];
            for (let i = 0; i < primaryPerCenter; i++) {
                const baseA = (Math.PI * 2 / primaryPerCenter) * i + rng.float(-0.12, 0.12);
                if (userAngles.some(ua => { let d = Math.abs(baseA - ua) % (Math.PI*2); if (d > Math.PI) d = Math.PI*2 - d; return d < Math.PI/(primaryPerCenter*1.5); })) continue;

                let prev = cIdx;
                for (let s = 1; s <= stepsN; s++) {
                    const d = s * step;
                    const nx = ccx + Math.cos(baseA) * d + rng.float(-2, 2);
                    const ny = ccy + Math.sin(baseA) * d + rng.float(-2, 2);
                    if (!pointInPoly([nx, ny], boundary)) break;
                    const idx = addNode(nx, ny);
                    if (idx !== prev) {
                        addEdge(prev, idx, 'primary', 14);
                        primaryNodes.add(idx);
                        prev = idx;
                    }
                }
            }
        }

        // ── Ring roads ──────────────────────────────────────────────────
        for (let ri = 1; ri <= cfg.rings; ri++) {
            const ringR = (radius / (cfg.rings + 1)) * ri;
            // Find nodes near this ring distance
            const candidates = [];
            for (let ni = 0; ni < nodes.length; ni++) {
                const nd = nearestCenterDist(nodes[ni].x, nodes[ni].y);
                if (Math.abs(nd - ringR) < step * 0.9) candidates.push(ni);
            }
            if (candidates.length < 2) continue;
            candidates.sort((a, b) => Math.atan2(nodes[a].y - cy, nodes[a].x - cx) - Math.atan2(nodes[b].y - cy, nodes[b].x - cx));

            for (let i = 0; i < candidates.length; i++) {
                const fIdx = candidates[i], tIdx = candidates[(i + 1) % candidates.length];
                const fa = Math.atan2(nodes[fIdx].y - cy, nodes[fIdx].x - cx);
                let ta = Math.atan2(nodes[tIdx].y - cy, nodes[tIdx].x - cx);
                if (ta < fa) ta += Math.PI * 2;
                const arcLen = (ta - fa) * ringR;
                const arcSteps = Math.max(2, Math.floor(arcLen / 55));
                let prev = fIdx;
                for (let s = 1; s <= arcSteps; s++) {
                    const t = s / arcSteps;
                    const a = fa + (ta - fa) * t;
                    const r = ringR + rng.float(-6, 6);
                    const nx = cx + Math.cos(a) * r, ny = cy + Math.sin(a) * r;
                    if (!pointInPoly([nx, ny], boundary)) break;
                    const idx = s === arcSteps ? tIdx : addNode(nx, ny);
                    if (idx !== prev) {
                        addEdge(prev, idx, ri <= 2 ? 'secondary' : 'tertiary', ri <= 2 ? 9 : 5);
                        prev = idx;
                    }
                }
            }
        }

        // ── Branch helper ───────────────────────────────────────────────
        function growBranch(startIdx, dir, hier, width, maxLen, stepLen) {
            let prev = startIdx;
            let x = nodes[prev].x, y = nodes[prev].y, len = 0;
            while (len < maxLen) {
                x += Math.cos(dir) * stepLen + rng.float(-1.5, 1.5);
                y += Math.sin(dir) * stepLen + rng.float(-1.5, 1.5);
                len += stepLen;
                if (!pointInPoly([x, y], boundary)) break;
                const pre = nodes.length;
                const idx = addNode(x, y);
                if (idx !== prev) {
                    addEdge(prev, idx, hier, width);
                }
                if (idx !== prev && nodes.length === pre) return idx; // snapped → connected
                if (idx === prev) break;
                prev = idx;
            }
            return prev;
        }

        // ── Secondary branches (90° from primary/ring) ─────────────────
        const branched = new Set();
        const secStart = edges.length;
        for (let ei = 0; ei < secStart; ei++) {
            const e = edges[ei];
            if (e.userDrawn) continue;
            const fn = nodes[e.from], tn = nodes[e.to];
            const dir = Math.atan2(tn.y - fn.y, tn.x - fn.x);
            for (const ni of [e.from, e.to]) {
                if (branched.has(ni) || rng.next() > cfg.secProb) continue;
                branched.add(ni);
                for (const sign of [1, -1]) {
                    if (rng.next() > 0.6) continue;
                    const bDir = dir + sign * Math.PI / 2;
                    const maxL = step * rng.float(2, 6);
                    growBranch(ni, bDir, 'secondary', 9, maxL, step * 0.85);
                }
            }
        }

        // ── Tertiary branches (90° or 45° from secondary) ──────────────
        const secEnd = edges.length;
        const tertBranched = new Set();
        for (let ei = secStart; ei < secEnd; ei++) {
            const e = edges[ei];
            if (e.userDrawn) continue;
            const fn = nodes[e.from], tn = nodes[e.to];
            const dir = Math.atan2(tn.y - fn.y, tn.x - fn.x);
            for (const ni of [e.from, e.to]) {
                if (tertBranched.has(ni) || rng.next() > cfg.tertProb) continue;
                tertBranched.add(ni);
                for (const sign of [1, -1]) {
                    if (rng.next() > 0.5) continue;
                    const angle = dir + sign * (rng.next() > 0.7 ? Math.PI / 4 : Math.PI / 2);
                    growBranch(ni, angle, 'tertiary', 4, step * rng.float(1, 3), step * 0.7);
                }
            }
        }

        // ── Connect dead-ends (spatial hash accelerated) ────────────────
        const edgeCounts = new Uint16Array(nodes.length);
        for (const e of edges) { edgeCounts[e.from]++; edgeCounts[e.to]++; }
        const DEADEND_R = 80;
        for (let ni = 0; ni < nodes.length; ni++) {
            if (edgeCounts[ni] !== 1) continue;
            const nx = nodes[ni].x, ny = nodes[ni].y;
            let bestI = -1, bestD = DEADEND_R;
            const gx0 = Math.floor((nx - DEADEND_R) / CELL) - 1;
            const gy0 = Math.floor((ny - DEADEND_R) / CELL) - 1;
            const gx1 = Math.floor((nx + DEADEND_R) / CELL) + 1;
            const gy1 = Math.floor((ny + DEADEND_R) / CELL) + 1;
            for (let gy = gy0; gy <= gy1; gy++) {
                for (let gx = gx0; gx <= gx1; gx++) {
                    const bucket = nHash.get(gx + ',' + gy);
                    if (!bucket) continue;
                    for (const oi of bucket) {
                        if (oi === ni) continue;
                        const d = dist([nx, ny], [nodes[oi].x, nodes[oi].y]);
                        if (d < bestD && d > SNAP && !edgeExists(ni, oi)) { bestD = d; bestI = oi; }
                    }
                }
            }
            if (bestI >= 0) addEdge(ni, bestI, 'tertiary', 4);
        }

        return { nodes, edges };
    }

    // ── Buildings along roads ───────────────────────────────────────────────
    function placeBuildings(nodes, edges, boundary, densityMap, rng, maxCount, cx, cy, radius) {
        const buildings = [];
        const bounds = computeBounds(boundary);

        // ── Occupancy grid: prevents building–road and building–building overlap
        const GCELL = Math.max(3, Math.ceil(radius / 1500));
        const gw = Math.ceil((bounds.maxX - bounds.minX) / GCELL) + 4;
        const gh = Math.ceil((bounds.maxY - bounds.minY) / GCELL) + 4;
        const grid = new Uint8Array(gw * gh);
        const gox = bounds.minX - GCELL * 2;
        const goy = bounds.minY - GCELL * 2;

        // Mark all road segments (with width + margin) on the grid
        for (const edge of edges) {
            const fn = nodes[edge.from], tn = nodes[edge.to];
            const hw = ((edge.width || 6) / 2) + 0.5;
            const minC = Math.max(0, Math.floor((Math.min(fn.x, tn.x) - hw - gox) / GCELL));
            const maxC = Math.min(gw - 1, Math.floor((Math.max(fn.x, tn.x) + hw - gox) / GCELL));
            const minR = Math.max(0, Math.floor((Math.min(fn.y, tn.y) - hw - goy) / GCELL));
            const maxR = Math.min(gh - 1, Math.floor((Math.max(fn.y, tn.y) + hw - goy) / GCELL));
            for (let r = minR; r <= maxR; r++) {
                for (let c = minC; c <= maxC; c++) {
                    const px = gox + (c + 0.5) * GCELL;
                    const py = goy + (r + 0.5) * GCELL;
                    if (distToSeg(px, py, fn.x, fn.y, tn.x, tn.y) <= hw) {
                        grid[r * gw + c] = 1;
                    }
                }
            }
        }

        // Precise rotated-rect grid test (local coordinate transform)
        function checkFootprint(bcx, bcy, hw, hh, cos, sin) {
            const ext = Math.max(hw, hh) + GCELL;
            const c0 = Math.max(0, Math.floor((bcx - ext - gox) / GCELL));
            const c1 = Math.min(gw - 1, Math.floor((bcx + ext - gox) / GCELL));
            const r0 = Math.max(0, Math.floor((bcy - ext - goy) / GCELL));
            const r1 = Math.min(gh - 1, Math.floor((bcy + ext - goy) / GCELL));
            for (let r = r0; r <= r1; r++) {
                for (let c = c0; c <= c1; c++) {
                    if (!grid[r * gw + c]) continue;
                    const px = gox + (c + 0.5) * GCELL - bcx;
                    const py = goy + (r + 0.5) * GCELL - bcy;
                    if (Math.abs(px * cos + py * sin) <= hw && Math.abs(-px * sin + py * cos) <= hh) return true;
                }
            }
            return false;
        }

        function markFootprint(bcx, bcy, hw, hh, cos, sin) {
            const ext = Math.max(hw, hh) + GCELL;
            const c0 = Math.max(0, Math.floor((bcx - ext - gox) / GCELL));
            const c1 = Math.min(gw - 1, Math.floor((bcx + ext - gox) / GCELL));
            const r0 = Math.max(0, Math.floor((bcy - ext - goy) / GCELL));
            const r1 = Math.min(gh - 1, Math.floor((bcy + ext - goy) / GCELL));
            for (let r = r0; r <= r1; r++) {
                for (let c = c0; c <= c1; c++) {
                    const px = gox + (c + 0.5) * GCELL - bcx;
                    const py = goy + (r + 0.5) * GCELL - bcy;
                    if (Math.abs(px * cos + py * sin) <= hw && Math.abs(-px * sin + py * cos) <= hh) {
                        grid[r * gw + c] = 1;
                    }
                }
            }
        }

        // Intersection visual clearance
        const eCounts = new Uint16Array(nodes.length);
        for (const e of edges) { eCounts[e.from]++; eCounts[e.to]++; }
        const intHash = new Map();
        for (let i = 0; i < nodes.length; i++) {
            if (eCounts[i] < 3) continue;
            const k = `${Math.floor(nodes[i].x / 40)},${Math.floor(nodes[i].y / 40)}`;
            if (!intHash.has(k)) intHash.set(k, []);
            intHash.get(k).push([nodes[i].x, nodes[i].y]);
        }
        function nearIntersection(px, py, minD) {
            const gx = Math.floor(px / 40), gy = Math.floor(py / 40);
            for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
                for (const [ix, iy] of (intHash.get(`${gx + dx},${gy + dy}`) || [])) {
                    if (dist([px, py], [ix, iy]) < minD) return true;
                }
            }
            return false;
        }

        // Walk each road edge, place buildings on both sides
        for (const edge of edges) {
            if (buildings.length >= maxCount) break;
            const fn = nodes[edge.from], tn = nodes[edge.to];
            const eLen = dist([fn.x, fn.y], [tn.x, tn.y]);
            if (eLen < 15) continue;

            const dir = Math.atan2(tn.y - fn.y, tn.x - fn.x);
            const cosD = Math.cos(dir), sinD = Math.sin(dir);
            const perpX = -sinD, perpY = cosD;
            const roadHW = (edge.width || 6) / 2;
            const bStep = rng.float(14, 22);

            for (let t = bStep; t < eLen - bStep * 0.4; t += bStep) {
                if (buildings.length >= maxCount) break;
                const frac = t / eLen;
                const px = fn.x + (tn.x - fn.x) * frac;
                const py = fn.y + (tn.y - fn.y) * frac;

                if (nearIntersection(px, py, 14)) continue;
                const den = sampleDensity(px, py, densityMap);

                for (const side of [1, -1]) {
                    if (buildings.length >= maxCount) break;
                    if (rng.next() > den * 0.85) continue;

                    const bw = rng.float(bStep * 0.55, bStep - 2);
                    const bd = rng.float(8, 18);
                    const gap = rng.float(1, 2.5);
                    const off = roadHW + gap + bd / 2;
                    const bcx = px + perpX * off * side;
                    const bcy = py + perpY * off * side;

                    if (!pointInPoly([bcx, bcy], boundary)) continue;

                    const hw = bw / 2 + 1, hh = bd / 2 + 1; // +1 margin
                    if (checkFootprint(bcx, bcy, hw, hh, cosD, sinD)) continue;

                    const corners = rotRect(bcx, bcy, bw, bd, dir);
                    const dRatio = dist([bcx, bcy], [cx, cy]) / radius;
                    let cat;
                    if (dRatio < 0.15) cat = rng.choice(['commercial', 'civic', 'commercial']);
                    else if (dRatio < 0.4) cat = rng.choice(['commercial', 'residential', 'residential']);
                    else if (dRatio < 0.7) cat = rng.choice(['residential', 'residential', 'residential', 'industrial']);
                    else cat = rng.choice(['residential', 'industrial']);

                    buildings.push({
                        type: "Feature",
                        geometry: { type: "Polygon", coordinates: [corners] },
                        properties: { type: "building", category: cat, floor: 0, height: rng.range(5, den > 0.6 ? 35 : 15) }
                    });
                    markFootprint(bcx, bcy, bw / 2, bd / 2, cosD, sinD);
                }
            }
        }
        return buildings;
    }

    // ── Parks ────────────────────────────────────────────────────────────────
    function genParks(boundary, rng, count, cx, cy, radius) {
        const parks = [];
        const names = ["Central Park","Memorial Gardens","City Plaza","Green Zone","Rec Area","Botanical Gardens","Liberation Square","Haven Park","Founders Garden","Riverside Walk"];
        for (let i = 0; i < count * 2 && parks.length < count; i++) {
            const a = rng.next() * Math.PI * 2;
            const d = rng.float(0.05, 0.6) * radius;
            const px = cx + Math.cos(a) * d, py = cy + Math.sin(a) * d;
            if (!pointInPoly([px, py], boundary)) continue;
            const verts = rng.range(5, 9), pR = rng.float(20, Math.min(80, radius * 0.06));
            const pts = [];
            for (let j = 0; j < verts; j++) {
                const va = (Math.PI * 2 / verts) * j;
                pts.push([px + Math.cos(va) * pR * rng.float(0.6, 1), py + Math.sin(va) * pR * rng.float(0.6, 1)]);
            }
            pts.push(pts[0].slice());
            parks.push({ type: "Feature", geometry: { type: "Polygon", coordinates: [pts] },
                properties: { type: "park", floor: 0, name: rng.choice(names) } });
        }
        return parks;
    }

    // ── Main generation ─────────────────────────────────────────────────────
    function generateSettlement(options = {}) {
        const {
            id = `settlement_${Date.now()}`,
            name = "New Settlement",
            type = "city",
            size = "medium",
            population = 10000,
            shape = "circle",
            expansionLevel = 3,
            seed = Date.now(),
            density: userDensity,
            centerDensity: userCenterDensity,
            userRoads = [],
            userParks = [],
            customBoundary = null,
            densityMap: userDensityMap = null
        } = options;

        const rng = new RNG(seed);
        const cfg = CFG[size] || CFG.medium;
        const expMul = 0.6 + (expansionLevel / 5) * 0.8;
        const radius = cfg.radius * expMul;
        const cx = 0, cy = 0;

        // Generate nuclei for multi-center cities
        const numCenters = { tiny: 1, small: 1, medium: rng.range(1, 2), large: rng.range(2, 3), metropolis: rng.range(3, 5) }[size] || 1;
        const centers = [];
        if (numCenters <= 1) {
            centers.push([cx, cy]);
        } else {
            const axisAngle = rng.float(0, Math.PI);
            const spread = radius * rng.float(0.25, 0.45);
            for (let i = 0; i < numCenters; i++) {
                const t = (i / (numCenters - 1)) - 0.5;
                const perp = rng.float(-spread * 0.12, spread * 0.12);
                centers.push([
                    cx + Math.cos(axisAngle) * t * spread * 2 + Math.cos(axisAngle + Math.PI / 2) * perp,
                    cy + Math.sin(axisAngle) * t * spread * 2 + Math.sin(axisAngle + Math.PI / 2) * perp
                ]);
            }
        }

        // Boundary
        const boundary = customBoundary && customBoundary.length >= 3
            ? (customBoundary[customBoundary.length-1][0] !== customBoundary[0][0] ? [...customBoundary, customBoundary[0].slice()] : customBoundary)
            : generateBoundary(shape, cx, cy, radius, rng);
        const bounds = computeBounds(boundary);

        // Density map
        const densityMap = userDensityMap || createDefaultDensity(bounds, cx, cy, centers);

        // Roads
        const { nodes, edges } = buildRoadNetwork(cx, cy, radius, boundary, userRoads, densityMap, rng, cfg, expMul, centers);

        // Convert edges to road features
        const features = [];
        for (const e of edges) {
            features.push({
                type: "Feature",
                geometry: { type: "LineString", coordinates: [[nodes[e.from].x, nodes[e.from].y], [nodes[e.to].x, nodes[e.to].y]] },
                properties: { type: "road", hierarchy: e.hierarchy, width: e.width, floor: 0, userDrawn: e.userDrawn || false }
            });
        }

        // Parks (user + generated)
        const parks = [...userParks, ...genParks(boundary, rng, cfg.parks, cx, cy, radius)];
        features.push(...parks);

        // Buildings
        const buildings = placeBuildings(nodes, edges, boundary, densityMap, rng, Math.floor(cfg.maxBldg * expMul), cx, cy, radius);
        features.push(...buildings);

        // Floors
        const mainFloor = { floor: 0, name: "Ground Level", type: "ground", features: features.slice() };
        const floors = [mainFloor];
        const connectors = [];

        // Underground for large+
        if (size === 'large' || size === 'metropolis') {
            const ugEdges = [];
            for (let ei = 0; ei < Math.min(edges.length, Math.floor(edges.length * 0.3)); ei++) {
                const e = edges[ei];
                ugEdges.push({
                    type: "Feature",
                    geometry: { type: "LineString", coordinates: [[nodes[e.from].x, nodes[e.from].y], [nodes[e.to].x, nodes[e.to].y]] },
                    properties: { type: "road", hierarchy: e.hierarchy, width: e.width, floor: -1 }
                });
            }
            features.push(...ugEdges);
            floors.push({ floor: -1, name: "Underground", type: "underground", features: ugEdges });
            const nc = rng.range(3, 8);
            for (let i = 0; i < nc; i++) {
                const ca = rng.next() * Math.PI * 2, cd = rng.float(0.15, 0.55) * radius;
                connectors.push({ type: rng.choice(["elevator","stairs","ramp"]),
                    position: [cx + Math.cos(ca) * cd, cy + Math.sin(ca) * cd], from: -1, to: 0,
                    name: `${rng.choice(["N","S","E","W","Central"])} ${rng.choice(["Elevator","Lift","Stairs"])} #${i+1}` });
            }
        }

        return {
            type: "FeatureCollection", id, name, settlement_type: type,
            size, population, boundary, bounds, densityMap,
            generationMethod: userRoads.length > 0 ? 'guided' : 'auto',
            generatedAt: new Date().toISOString(),
            expansionLevel, shape, floors, connectors, features
        };
    }

    // ── Public API ──────────────────────────────────────────────────────────
    return {
        generate(options) { return generateSettlement(options); },
        createDensityMap: createDefaultDensity,
        sampleDensity,
        toGeoJSON(s) {
            return { type: "FeatureCollection",
                properties: { id: s.id, name: s.name, type: s.settlement_type, size: s.size, population: s.population,
                    generationMethod: s.generationMethod, expansionLevel: s.expansionLevel, shape: s.shape },
                boundary: s.boundary, densityMap: s.densityMap,
                floors: s.floors, connectors: s.connectors, features: s.features };
        },
        fromGeoJSON(gj) {
            return { type: "FeatureCollection", id: gj.properties?.id, name: gj.properties?.name || "Settlement",
                settlement_type: gj.properties?.type || "city", size: gj.properties?.size || "medium",
                population: gj.properties?.population || 0, boundary: gj.boundary || [],
                bounds: computeBounds(gj.boundary || [[-500,-500],[500,-500],[500,500],[-500,500]]),
                densityMap: gj.densityMap, shape: gj.properties?.shape || 'circle',
                generationMethod: gj.properties?.generationMethod || 'auto',
                expansionLevel: gj.properties?.expansionLevel || 3,
                floors: gj.floors || [], connectors: gj.connectors || [], features: gj.features || [] };
        }
    };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SettlementGenerator;
