// =============================================================================
//  GEMINI ARCHITECT — Settlement Renderer v3
//  Google-Maps style Canvas 2D renderer with density map support
// =============================================================================

const SettlementRenderer = (() => {

    // ── Colour palette ──────────────────────────────────────────────────────
    const PAL = {
        bg:           '#e8e4d8',
        boundary:     '#556b2f',
        boundaryFill: 'rgba(144,178,111,0.12)',
        road: {
            primary:   { fill: '#ffffff', casing: '#888888', w: 14 },
            secondary: { fill: '#f0ece0', casing: '#999999', w: 9  },
            tertiary:  { fill: '#f0ece0', casing: '#aaaaaa', w: 5  }
        },
        building: {
            residential: '#d4c4a8',
            commercial:  '#b8c5d4',
            industrial:  '#c8b89a',
            civic:       '#c4d4c4',
            stroke:      '#7a6e5a'
        },
        park:      '#a8d5a0',
        parkStroke: '#6aaa60',
        treeDot:   '#5ca05c',
        userRoad:  '#ff9900',
        densityLow:  'rgba(60,140,220,0.12)',
        densityHigh: 'rgba(220,60,60,0.22)',
        densityBrush:'rgba(255,150,0,0.3)'
    };

    // ── Camera ──────────────────────────────────────────────────────────────
    class Camera {
        constructor() { this.x = 0; this.y = 0; this.zoom = 1; this.tX = 0; this.tY = 0; this.tZ = 1; }
        lerp(t = 0.15) {
            this.x += (this.tX - this.x) * t;
            this.y += (this.tY - this.y) * t;
            this.zoom += (this.tZ - this.zoom) * t;
        }
        screenToWorld(sx, sy, canvas) {
            return [(sx - canvas.width / 2) / this.zoom + this.x,
                    (sy - canvas.height / 2) / this.zoom + this.y];
        }
        worldToScreen(wx, wy, canvas) {
            return [(wx - this.x) * this.zoom + canvas.width / 2,
                    (wy - this.y) * this.zoom + canvas.height / 2];
        }
        fitBounds(bounds, canvas, pad = 60) {
            const bw = bounds.maxX - bounds.minX, bh = bounds.maxY - bounds.minY;
            this.tX = this.x = bounds.minX + bw / 2;
            this.tY = this.y = bounds.minY + bh / 2;
            this.tZ = this.zoom = Math.min((canvas.width - pad * 2) / bw, (canvas.height - pad * 2) / bh);
        }
    }

    // ── Renderer ────────────────────────────────────────────────────────────
    class Renderer {
        constructor(canvas) {
            this.canvas = canvas;
            this.ctx = canvas.getContext('2d');
            this.camera = new Camera();
            this.settlement = null;
            this.showDensity = false;
            this.showGrid = false;
            this.currentFloor = 0;
            this.drawingPts = [];         // live drawing preview
            this.drawingMode = null;      // 'road'|'park'|'boundary'|null
            this.densityBrush = null;     // {x, y, radius} for brush preview
            this.userFeatures = { roads: [], parks: [], boundary: null };
            // Offscreen cache
            this._cache = null;
            this._cacheCtx = null;
            this._dirty = true;
            this._cacheCamera = { x: 0, y: 0, zoom: 1, w: 0, h: 0 };
            this._cacheFloor = 0;
            this._cacheDensity = false;
            // Pre-categorized feature arrays
            this._roads = [];
            this._parks = [];
            this._buildingsByCat = {};
        }

        setSettlement(s) {
            this.settlement = s;
            this._dirty = true;
            this._categorizeFeatures(s);
            if (s && s.bounds) this.camera.fitBounds(s.bounds, this.canvas);
        }

        invalidate() { this._dirty = true; }

        _categorizeFeatures(s) {
            this._roads = []; this._parks = []; this._buildingsByCat = {};
            if (!s || !s.features) return;
            for (const f of s.features) {
                const t = f.properties.type;
                if (t === 'road') this._roads.push(f);
                else if (t === 'park') this._parks.push(f);
                else if (t === 'building') {
                    const cat = f.properties.category || 'residential';
                    (this._buildingsByCat[cat] ||= []).push(f);
                }
            }
        }

        render() {
            const { ctx, canvas, camera, settlement: S } = this;
            camera.lerp();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = PAL.bg;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Drawing preview & density brush work even without settlement
            const hasOverlay = (this.drawingPts && this.drawingPts.length > 0) || this.densityBrush;
            const uf = this.userFeatures;
            const hasUserContent = uf && (uf.roads.length || uf.parks.length || uf.boundary);
            const hasContent = S || hasUserContent;

            if (hasContent) {
                const cc = this._cacheCamera;
                const w = canvas.width / devicePixelRatio;
                const h = canvas.height / devicePixelRatio;
                const zoomChanged = cc.zoom > 0 && Math.abs(camera.zoom - cc.zoom) / cc.zoom > 0.03;
                const panTooFar = Math.abs(cc.x - camera.x) * camera.zoom > w * 0.3 ||
                                  Math.abs(cc.y - camera.y) * camera.zoom > h * 0.3;
                const sizeChanged = cc.w !== canvas.width || cc.h !== canvas.height;

                if (this._dirty || zoomChanged || panTooFar || sizeChanged ||
                    this._cacheFloor !== this.currentFloor ||
                    this._cacheDensity !== this.showDensity) {
                    this._rebuildCache(S);
                }

                // Blit cached content with offset for smooth panning
                if (this._cache) {
                    const ox = (this._cacheCamera.x - camera.x) * camera.zoom;
                    const oy = (this._cacheCamera.y - camera.y) * camera.zoom;
                    ctx.drawImage(this._cache, ox, oy);
                }
            }

            // Overlays (drawing preview, density brush) — always drawn live
            if (hasOverlay) {
                ctx.save();
                ctx.translate(canvas.width / 2, canvas.height / 2);
                ctx.scale(camera.zoom, camera.zoom);
                ctx.translate(-camera.x, -camera.y);

                this._drawLivePreview(ctx);

                if (this.densityBrush) {
                    ctx.beginPath();
                    ctx.arc(this.densityBrush.x, this.densityBrush.y, this.densityBrush.radius, 0, Math.PI * 2);
                    ctx.fillStyle = PAL.densityBrush;
                    ctx.fill();
                    ctx.strokeStyle = 'rgba(255,150,0,0.6)';
                    ctx.lineWidth = 2 / camera.zoom;
                    ctx.stroke();
                }

                ctx.restore();
            }

            this._drawHUD(ctx, canvas);
        }

        _rebuildCache(S) {
            const { canvas, camera } = this;
            // Ensure offscreen canvas exists and is sized correctly
            if (!this._cache || this._cache.width !== canvas.width || this._cache.height !== canvas.height) {
                this._cache = document.createElement('canvas');
                this._cache.width = canvas.width;
                this._cache.height = canvas.height;
                this._cacheCtx = this._cache.getContext('2d');
            }
            const ctx = this._cacheCtx;
            ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
            const w = canvas.width / devicePixelRatio;
            const h = canvas.height / devicePixelRatio;
            ctx.clearRect(0, 0, w, h);

            ctx.save();
            ctx.translate(w / 2, h / 2);
            ctx.scale(camera.zoom, camera.zoom);
            ctx.translate(-camera.x, -camera.y);

            // Compute visible bounds for culling
            const invZ = 1 / camera.zoom;
            const vx0 = camera.x - (w / 2) * invZ - 50 * invZ;
            const vy0 = camera.y - (h / 2) * invZ - 50 * invZ;
            const vx1 = camera.x + (w / 2) * invZ + 50 * invZ;
            const vy1 = camera.y + (h / 2) * invZ + 50 * invZ;

            // Density overlay
            if (this.showDensity && S && S.densityMap) this._drawDensityMap(ctx, S.densityMap, vx0, vy0, vx1, vy1);

            // Boundary (settlement + user)
            if (S) this._drawBoundary(ctx, S.boundary);
            const uf = this.userFeatures;
            if (uf && uf.boundary) this._drawBoundary(ctx, uf.boundary);

            const floor = this.currentFloor;
            const zoom = camera.zoom;

            // Parks (settlement + user)
            for (const f of this._parks) {
                if ((f.properties.floor ?? 0) !== floor) continue;
                if (!this._inView(f, vx0, vy0, vx1, vy1)) continue;
                this._drawPark(ctx, f, zoom);
            }
            if (uf) for (const f of uf.parks) {
                if (!this._inView(f, vx0, vy0, vx1, vy1)) continue;
                this._drawPark(ctx, f, zoom);
            }

            // ── Roads: batch casings then fills ─────────────────────────
            const skipTert = zoom < 0.12;
            const skipSec = zoom < 0.05;

            // Casings pass
            ctx.lineCap = 'round'; ctx.lineJoin = 'round';
            let lastCasingStyle = '', lastCasingWidth = 0;
            ctx.beginPath();
            for (let i = 0; i < this._roads.length; i++) {
                const f = this._roads[i], p = f.properties;
                if ((p.floor ?? 0) !== floor) continue;
                if (skipTert && p.hierarchy === 'tertiary') continue;
                if (skipSec && p.hierarchy === 'secondary') continue;
                if (!this._inView(f, vx0, vy0, vx1, vy1)) continue;
                const pal = PAL.road[p.hierarchy] || PAL.road.tertiary;
                const style = p.userDrawn ? PAL.userRoad : pal.casing;
                const w = (p.width || pal.w) + 3;
                if (style !== lastCasingStyle || w !== lastCasingWidth) {
                    if (lastCasingStyle) ctx.stroke();
                    ctx.beginPath();
                    ctx.strokeStyle = style; ctx.lineWidth = w;
                    lastCasingStyle = style; lastCasingWidth = w;
                }
                const pts = f.geometry.coordinates;
                ctx.moveTo(pts[0][0], pts[0][1]);
                for (let j = 1; j < pts.length; j++) ctx.lineTo(pts[j][0], pts[j][1]);
            }
            if (uf) for (const f of uf.roads) {
                if (!this._inView(f, vx0, vy0, vx1, vy1)) continue;
                const w = (f.properties?.width || 14) + 3;
                if (PAL.userRoad !== lastCasingStyle || w !== lastCasingWidth) {
                    if (lastCasingStyle) ctx.stroke();
                    ctx.beginPath();
                    ctx.strokeStyle = PAL.userRoad; ctx.lineWidth = w;
                    lastCasingStyle = PAL.userRoad; lastCasingWidth = w;
                }
                const pts = f.geometry.coordinates;
                ctx.moveTo(pts[0][0], pts[0][1]);
                for (let j = 1; j < pts.length; j++) ctx.lineTo(pts[j][0], pts[j][1]);
            }
            if (lastCasingStyle) ctx.stroke();

            // Fills pass
            let lastFillStyle = '', lastFillWidth = 0;
            ctx.beginPath();
            for (let i = 0; i < this._roads.length; i++) {
                const f = this._roads[i], p = f.properties;
                if ((p.floor ?? 0) !== floor) continue;
                if (skipTert && p.hierarchy === 'tertiary') continue;
                if (skipSec && p.hierarchy === 'secondary') continue;
                if (!this._inView(f, vx0, vy0, vx1, vy1)) continue;
                const pal = PAL.road[p.hierarchy] || PAL.road.tertiary;
                const style = pal.fill;
                const w = p.width || pal.w;
                if (style !== lastFillStyle || w !== lastFillWidth) {
                    if (lastFillStyle) ctx.stroke();
                    ctx.beginPath();
                    ctx.strokeStyle = style; ctx.lineWidth = w;
                    lastFillStyle = style; lastFillWidth = w;
                }
                const pts = f.geometry.coordinates;
                ctx.moveTo(pts[0][0], pts[0][1]);
                for (let j = 1; j < pts.length; j++) ctx.lineTo(pts[j][0], pts[j][1]);
            }
            if (uf) for (const f of uf.roads) {
                if (!this._inView(f, vx0, vy0, vx1, vy1)) continue;
                const w = f.properties?.width || 14;
                if (PAL.road.primary.fill !== lastFillStyle || w !== lastFillWidth) {
                    if (lastFillStyle) ctx.stroke();
                    ctx.beginPath();
                    ctx.strokeStyle = PAL.road.primary.fill; ctx.lineWidth = w;
                    lastFillStyle = PAL.road.primary.fill; lastFillWidth = w;
                }
                const pts = f.geometry.coordinates;
                ctx.moveTo(pts[0][0], pts[0][1]);
                for (let j = 1; j < pts.length; j++) ctx.lineTo(pts[j][0], pts[j][1]);
            }
            if (lastFillStyle) ctx.stroke();

            // ── Buildings: batched by category ──────────────────────────
            if (zoom >= 0.05) {
                const skipStroke = zoom < 0.3;
                for (const cat in this._buildingsByCat) {
                    const arr = this._buildingsByCat[cat];
                    ctx.beginPath();
                    let count = 0;
                    for (const f of arr) {
                        if ((f.properties.floor ?? 0) !== floor) continue;
                        if (!this._inView(f, vx0, vy0, vx1, vy1)) continue;
                        const pts = f.geometry.coordinates[0];
                        ctx.moveTo(pts[0][0], pts[0][1]);
                        for (let j = 1; j < pts.length; j++) ctx.lineTo(pts[j][0], pts[j][1]);
                        ctx.closePath();
                        count++;
                    }
                    if (!count) continue;
                    ctx.fillStyle = PAL.building[cat] || PAL.building.residential;
                    ctx.fill();
                    if (!skipStroke) {
                        ctx.strokeStyle = PAL.building.stroke;
                        ctx.lineWidth = 0.7 / zoom;
                        ctx.stroke();
                    }
                }
            }

            // Connectors
            if (S && S.connectors) for (const c of S.connectors) this._drawConnector(ctx, c);

            ctx.restore();

            // Update cache tracking
            this._cacheCamera = { x: camera.x, y: camera.y, zoom: camera.zoom, w: canvas.width, h: canvas.height };
            this._cacheFloor = this.currentFloor;
            this._cacheDensity = this.showDensity;
            this._dirty = false;
        }

        _inView(f, vx0, vy0, vx1, vy1) {
            const coords = f.geometry.coordinates;
            // LineString or Polygon outer ring
            const pts = f.geometry.type === 'Polygon' ? coords[0] : coords;
            for (let i = 0; i < pts.length; i++) {
                const [x, y] = pts[i];
                if (x >= vx0 && x <= vx1 && y >= vy0 && y <= vy1) return true;
            }
            return false;
        }

        _drawDensityMap(ctx, dm, vx0, vy0, vx1, vy1) {
            const cs = dm.cellSize;
            const c0 = Math.max(0, Math.floor((vx0 - dm.originX) / cs));
            const c1 = Math.min(dm.cols - 1, Math.ceil((vx1 - dm.originX) / cs));
            const r0 = Math.max(0, Math.floor((vy0 - dm.originY) / cs));
            const r1 = Math.min(dm.rows - 1, Math.ceil((vy1 - dm.originY) / cs));
            for (let r = r0; r <= r1; r++) {
                for (let c = c0; c <= c1; c++) {
                    const v = dm.cells[r * dm.cols + c];
                    if (v < 0.05) continue;
                    const x = dm.originX + c * cs, y = dm.originY + r * cs;
                    const t = Math.min(1, v);
                    const red = Math.floor(60 + 160 * t);
                    const blue = Math.floor(220 - 160 * t);
                    ctx.fillStyle = `rgba(${red},${Math.floor(80+60*(1-t))},${blue},${0.08 + t * 0.18})`;
                    ctx.fillRect(x, y, cs, cs);
                }
            }
        }

        _drawBoundary(ctx, b) {
            if (!b || b.length < 3) return;
            ctx.beginPath(); ctx.moveTo(b[0][0], b[0][1]);
            for (let i = 1; i < b.length; i++) ctx.lineTo(b[i][0], b[i][1]);
            ctx.closePath();
            ctx.fillStyle = PAL.boundaryFill; ctx.fill();
            ctx.strokeStyle = PAL.boundary; ctx.lineWidth = 3 / this.camera.zoom;
            ctx.setLineDash([8 / this.camera.zoom, 6 / this.camera.zoom]); ctx.stroke(); ctx.setLineDash([]);
        }

        _drawPark(ctx, f, zoom) {
            const pts = f.geometry.coordinates[0];
            ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
            ctx.closePath();
            ctx.fillStyle = PAL.park; ctx.fill();
            ctx.strokeStyle = PAL.parkStroke; ctx.lineWidth = 1.5 / zoom; ctx.stroke();
            // Tree dots (skip if very zoomed out)
            if (zoom < 0.2) return;
            let cx = 0, cy = 0;
            for (const [x, y] of pts) { cx += x; cy += y; }
            cx /= pts.length; cy /= pts.length;
            const r = 3 / zoom;
            ctx.fillStyle = PAL.treeDot;
            for (let i = 0; i < 12; i++) {
                const a = i * 0.52 + i * 1.17, d = 5 + (i % 3) * 8;
                ctx.beginPath();
                ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, Math.PI * 2);
                ctx.fill();
            }
        }

        _drawConnector(ctx, c) {
            if ((c.from !== this.currentFloor && c.to !== this.currentFloor)) return;
            const [x, y] = c.position;
            ctx.beginPath();
            ctx.arc(x, y, 6 / this.camera.zoom, 0, Math.PI * 2);
            ctx.fillStyle = '#f0c040'; ctx.fill();
            ctx.strokeStyle = '#af8a20'; ctx.lineWidth = 1.5 / this.camera.zoom; ctx.stroke();
            ctx.fillStyle = '#333'; ctx.font = `${Math.max(8, 10 / this.camera.zoom)}px sans-serif`;
            ctx.textAlign = 'center'; ctx.fillText(c.type === 'elevator' ? '▲' : '⇵', x, y + 3 / this.camera.zoom);
        }

        _drawLivePreview(ctx) {
            const pts = this.drawingPts;
            if (!pts || pts.length < 1) return;
            ctx.setLineDash([6 / this.camera.zoom, 4 / this.camera.zoom]);
            if (this.drawingMode === 'road') {
                ctx.strokeStyle = '#ff6600'; ctx.lineWidth = 4 / this.camera.zoom;
                ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
                for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
                ctx.stroke();
                for (const [x, y] of pts) {
                    ctx.beginPath(); ctx.arc(x, y, 3 / this.camera.zoom, 0, Math.PI * 2);
                    ctx.fillStyle = '#ff6600'; ctx.fill();
                }
            } else if (this.drawingMode === 'park' || this.drawingMode === 'boundary') {
                const color = this.drawingMode === 'park' ? '#33aa33' : '#aa3333';
                ctx.strokeStyle = color; ctx.lineWidth = 2.5 / this.camera.zoom;
                ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
                for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
                if (pts.length > 2) ctx.lineTo(pts[0][0], pts[0][1]);
                ctx.stroke();
                for (const [x, y] of pts) {
                    ctx.beginPath(); ctx.arc(x, y, 3 / this.camera.zoom, 0, Math.PI * 2);
                    ctx.fillStyle = color; ctx.fill();
                }
            }
            ctx.setLineDash([]);
        }

        _drawHUD(ctx, canvas) {
            const S = this.settlement;
            const lines = [];
            if (S) {
                lines.push(S.name || 'Settlement');
                lines.push(`${S.size} · pop ${(S.population||0).toLocaleString()}`);
                lines.push(`Floor: ${this.currentFloor} · Feats: ${S.features.length}`);
            } else {
                lines.push('No settlement loaded');
            }
            lines.push(`Zoom: ${this.camera.zoom.toFixed(2)}`);

            ctx.save();
            const pad = 10, lineH = 18, w = 220, h = pad * 2 + lines.length * lineH;
            const hx = canvas.width - w - 12, hy = 12;
            ctx.fillStyle = 'rgba(15,15,21,0.75)';
            this._roundRect(ctx, hx, hy, w, h, 8); ctx.fill();
            ctx.fillStyle = '#ccc'; ctx.font = '13px monospace'; ctx.textAlign = 'left';
            for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], hx + pad, hy + pad + 13 + i * lineH);
            ctx.restore();
        }

        _roundRect(ctx, x, y, w, h, r) {
            ctx.beginPath();
            ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
            ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
            ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
            ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
            ctx.closePath();
        }
    }

    return { Camera, Renderer, PAL };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = SettlementRenderer;
