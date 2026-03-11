// =============================================================================
//  GEMINI ARCHITECT — Module: Settlement Generator
//  Procedural city/settlement generation with multi-floor support
//  Outputs GeoJSON-compliant settlement data with buildings, roads, and floors
// =============================================================================

const SettlementGenerator = (() => {

    // ── Data Structure ──────────────────────────────────────────────────────────
    /**
     * Settlement schema (GeoJSON-like):
     * {
     *   id: "settlement_ID",
     *   name: "Settlement Name",
     *   type: "city" | "outpost" | "spaceport" | "colony" | etc.
     *   size: "tiny" | "small" | "medium" | "large" | "metropolis",
     *   population: 0-∞,
     *   boundingBox: { minX, minY, maxX, maxY },  // in map units
     *   bounds: Polygon,  // GeoJSON polygon of settlement extent
     *   
     *   // Generation metadata
     *   generated: true,
     *   generationMethod: "auto" | "guided",
     *   expansionLevel: 0-5,  // how developed/spread out
     *   densityVariation: { center: 0-1, outer: 0-1 },
     *   
     *   // Floor system
     *   floors: [
     *     {
     *       floor: -2 to N (negative = underground, 0 = ground, positive = elevated/ship levels),
     *       name: "Lower Caverns" or "Ground" or "Deck 2",
     *       type: "underground" | "ground" | "elevated" | "ship_deck",
     *       features: [ ... geom features for this floor ... ]
     *     }
     *   ],
     *   
     *   // For multi-floor navigation
     *   connectors: [
     *     { type: "elevator" | "stairs" | "ramp", position: [x,y], from: floor1, to: floor2, name?: "East Elevator" }
     *   ],
     *   
     *   // GeoJSON FeatureCollection for all geometry
     *   features: [
     *     {
     *       type: "Feature",
     *       geometry: { type: "LineString", coordinates: [[x1,y1],[x2,y2],...] },  // roads
     *       properties: {
     *         type: "road",
     *         hierarchy: "primary" | "secondary" | "tertiary" | "local",
     *         width: 20-100,
     *         floor: -2...0...N,
     *         name?: "Main Street"
     *       }
     *     },
     *     {
     *       type: "Feature",
     *       geometry: { type: "Polygon", coordinates: [[[x,y],...]] },  // buildings
     *       properties: {
     *         type: "building",
     *         category: "residential" | "commercial" | "industrial" | "civic" | "transport",
     *         name?: "Town Hall",
     *         floor: -2...0...N,
     *         height: 5-50,  // meters
     *         population?: 50
     *       }
     *     },
     *     {
     *       type: "Feature",
     *       geometry: { type: "Polygon", ... },  // parks, plazas
     *       properties: {
     *         type: "park",
     *         floor: 0,
     *         name?: "Central Plaza"
     *       }
     *     }
     *   ]
     * }
     */

    // ── Utility: Random with seed ───────────────────────────────────────────────
    function seededRandom(seed) {
        const x = Math.sin(seed++) * 10000;
        return x - Math.floor(x);
    }

    class SeededRNG {
        constructor(seed) {
            this.seed = seed || Date.now();
        }
        next() {
            this.seed = (this.seed * 9301 + 49297) % 233280;
            return this.seed / 233280;
        }
        range(min, max) {
            return Math.floor(this.next() * (max - min + 1)) + min;
        }
        choice(arr) {
            return arr[Math.floor(this.next() * arr.length)];
        }
    }

    // ── Utility: Geometry helpers ───────────────────────────────────────────────
    function distance(p1, p2) {
        return Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    }

    function midpoint(p1, p2) {
        return [(p1[0] + p2[0]) / 2, (p1[1] + p2[1]) / 2];
    }

    function lineIntersection(p1, p2, p3, p4) {
        // Does segment p1-p2 intersect segment p3-p4? (2D)
        const ccw = (A, B, C) => {
            return (C[1] - A[1]) * (B[0] - A[0]) > (B[1] - A[1]) * (C[0] - A[0]);
        };
        return ccw(p1, p3, p4) !== ccw(p2, p3, p4) && ccw(p1, p2, p3) !== ccw(p1, p2, p4);
    }

    function pointInPolygon(point, polygon) {
        // Ray casting algorithm for point-in-polygon
        const [x, y] = point;
        let inside = false;
        for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
            const [xi, yi] = polygon[i];
            const [xj, yj] = polygon[j];
            if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
                inside = !inside;
            }
        }
        return inside;
    }

    // ── Procedural Road Network ─────────────────────────────────────────────────
    /**
     * Generate road network:
     * 1. Guided: User provides main roads/sketch → fill secondary roads
     * 2. Auto: Create hierarchical grid with organic variation
     */
    function generateRoadNetwork(bounds, options = {}) {
        const {
            mainRoads = [],  // User-drawn main roads [GeoJSON LineStrings]
            rng = new SeededRNG(),
            density = 0.6,  // 0-1, affects road spacing
            hierarchyDepth = 3,  // primary, secondary, tertiary
            floor = 0
        } = options;

        const roads = [];
        const { minX, minY, maxX, maxY } = bounds;
        const width = maxX - minX;
        const height = maxY - minY;

        // Primary roads (user-drawn or generated)
        if (mainRoads.length > 0) {
            mainRoads.forEach(road => {
                roads.push({
                    type: "Feature",
                    geometry: road,
                    properties: {
                        type: "road",
                        hierarchy: "primary",
                        width: 60 + rng.range(-10, 10),
                        floor,
                        name: road.properties?.name || null
                    }
                });
            });
        } else {
            // Auto-generate primary roads (loose grid with variation)
            const spacing = Math.max(100, 300 / density);
            for (let x = minX; x < maxX; x += spacing) {
                const wiggle = rng.range(-spacing * 0.2, spacing * 0.2);
                roads.push({
                    type: "Feature",
                    geometry: {
                        type: "LineString",
                        coordinates: [
                            [x + wiggle, minY],
                            [x + wiggle + rng.range(-spacing * 0.1, spacing * 0.1), maxY]
                        ]
                    },
                    properties: {
                        type: "road",
                        hierarchy: "primary",
                        width: 60,
                        floor
                    }
                });
            }
            for (let y = minY; y < maxY; y += spacing) {
                const wiggle = rng.range(-spacing * 0.2, spacing * 0.2);
                roads.push({
                    type: "Feature",
                    geometry: {
                        type: "LineString",
                        coordinates: [
                            [minX, y + wiggle],
                            [maxX, y + wiggle + rng.range(-spacing * 0.1, spacing * 0.1)]
                        ]
                    },
                    properties: {
                        type: "road",
                        hierarchy: "primary",
                        width: 60,
                        floor
                    }
                });
            }
        }

        // Secondary roads: perpendicular subdivisions
        const secondarySpacing = (maxX - minX) / (4 + rng.range(-2, 3));
        for (let x = minX; x < maxX; x += secondarySpacing) {
            roads.push({
                type: "Feature",
                geometry: {
                    type: "LineString",
                    coordinates: [
                        [x + rng.range(-20, 20), minY],
                        [x + rng.range(-20, 20), maxY]
                    ]
                },
                properties: {
                    type: "road",
                    hierarchy: "secondary",
                    width: 40,
                    floor
                }
            });
        }
        for (let y = minY; y < maxY; y += secondarySpacing) {
            roads.push({
                type: "Feature",
                geometry: {
                    type: "LineString",
                    coordinates: [
                        [minX, y + rng.range(-20, 20)],
                        [maxX, y + rng.range(-20, 20)]
                    ]
                },
                properties: {
                    type: "road",
                    hierarchy: "secondary",
                    width: 40,
                    floor
                }
            });
        }

        // Tertiary roads: finer local streets (sparse in outer areas)
        const tertiaryDensity = density * 0.7;
        const numTertiary = Math.floor((width / 50) * (height / 50) * tertiaryDensity);
        for (let i = 0; i < numTertiary; i++) {
            const isVertical = rng.next() > 0.5;
            if (isVertical) {
                const x = minX + rng.next() * width;
                const y1 = minY + rng.next() * height;
                const len = rng.range(40, 150);
                roads.push({
                    type: "Feature",
                    geometry: {
                        type: "LineString",
                        coordinates: [[x, Math.max(minY, y1 - len / 2)], [x, Math.min(maxY, y1 + len / 2)]]
                    },
                    properties: {
                        type: "road",
                        hierarchy: "tertiary",
                        width: 25,
                        floor
                    }
                });
            } else {
                const y = minY + rng.next() * height;
                const x1 = minX + rng.next() * width;
                const len = rng.range(40, 150);
                roads.push({
                    type: "Feature",
                    geometry: {
                        type: "LineString",
                        coordinates: [[Math.max(minX, x1 - len / 2), y], [Math.min(maxX, x1 + len / 2), y]]
                    },
                    properties: {
                        type: "road",
                        hierarchy: "tertiary",
                        width: 25,
                        floor
                    }
                });
            }
        }

        return roads;
    }

    // ── Procedural Building Placement ───────────────────────────────────────────
    function generateBuildings(bounds, roads, options = {}) {
        const {
            rng = new SeededRNG(),
            density = 0.6,  // 0-1
            centerDensity = 0.8,  // higher density near center
            categories = ["residential", "commercial", "industrial", "civic"],
            floor = 0,
            populationPerBuilding = 50
        } = options;

        const buildings = [];
        const { minX, minY, maxX, maxY } = bounds;
        const centerX = (minX + maxX) / 2;
        const centerY = (minY + maxY) / 2;
        const radius = Math.min(maxX - minX, maxY - minY) / 2;

        // Generate candidate positions in a grid, then cull based on density
        const cellSize = 40;
        const targetCount = Math.floor((maxX - minX) / cellSize * (maxY - minY) / cellSize * density);

        for (let i = 0; i < targetCount; i++) {
            const x = minX + rng.next() * (maxX - minX);
            const y = minY + rng.next() * (maxY - minY);

            // Distance-based density falloff from center
            const dist = Math.hypot(x - centerX, y - centerY);
            const distFactor = Math.max(0.1, 1 - (dist / radius) * 0.5);
            const localDensity = density * (0.5 + centerDensity * 0.5) * distFactor;

            if (rng.next() > localDensity) continue;

            // Building size (smaller = more buildings)
            const bw = rng.range(30, 80);
            const bh = rng.range(30, 80);
            const bx = x - bw / 2;
            const by = y - bh / 2;

            // Check overlap with roads (buildings should NOT be on roads)
            let overlapsRoad = false;
            for (const road of roads) {
                if (road.geometry.type === "LineString") {
                    const coords = road.geometry.coordinates;
                    for (let j = 0; j < coords.length - 1; j++) {
                        const [rx1, ry1] = coords[j];
                        const [rx2, ry2] = coords[j + 1];
                        const roadWidth = road.properties.width;
                        // Simple check: is building rect close to road line?
                        if (distanceToLineSegment([bx + bw / 2, by + bh / 2], [rx1, ry1], [rx2, ry2]) < roadWidth / 2 + 50) {
                            overlapsRoad = true;
                            break;
                        }
                    }
                }
                if (overlapsRoad) break;
            }
            if (overlapsRoad) continue;

            // Choose category (avoid industrial in dense center)
            let category = rng.choice(categories);
            if (distFactor > 0.8 && category === "industrial") {
                category = "residential";
            }

            buildings.push({
                type: "Feature",
                geometry: {
                    type: "Polygon",
                    coordinates: [[[bx, by], [bx + bw, by], [bx + bw, by + bh], [bx, by + bh], [bx, by]]]
                },
                properties: {
                    type: "building",
                    category,
                    floor,
                    height: rng.range(10, 50),
                    population: rng.range(populationPerBuilding * 0.5, populationPerBuilding * 2)
                }
            });
        }

        return buildings;
    }

    function distanceToLineSegment(point, p1, p2) {
        const [px, py] = point;
        const [x1, y1] = p1;
        const [x2, y2] = p2;
        const A = px - x1;
        const B = py - y1;
        const C = x2 - x1;
        const D = y2 - y1;
        const dot = A * C + B * D;
        const lenSq = C * C + D * D;
        let param = -1;
        if (lenSq !== 0) param = dot / lenSq;
        let xx, yy;
        if (param < 0) {
            xx = x1;
            yy = y1;
        } else if (param > 1) {
            xx = x2;
            yy = y2;
        } else {
            xx = x1 + param * C;
            yy = y1 + param * D;
        }
        return Math.hypot(px - xx, py - yy);
    }

    // ── Main Settlement Generation ──────────────────────────────────────────────
    function generateSettlement(options = {}) {
        const {
            id = `settlement_${Date.now()}`,
            name = "New Settlement",
            type = "city",
            size = "medium",  // tiny, small, medium, large, metropolis
            population = 10000,
            boundingBox = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 },
            generationMethod = "auto",  // "auto" | "guided"
            guidedSketch = null,  // { mainRoads: [...], parks: [...] }
            expansionLevel = 3,  // 0-5
            seed = Math.random()
        } = options;

        const rng = new SeededRNG(seed);

        // Size-to-density mapping
        const sizeDensityMap = {
            tiny: 0.3,
            small: 0.45,
            medium: 0.6,
            large: 0.75,
            metropolis: 0.9
        };
        const baseDensity = sizeDensityMap[size] || 0.6;
        const density = baseDensity * (0.5 + expansionLevel / 10);

        const bounds = boundingBox;
        const features = [];

        // Floor 0 (ground level) - main settlement
        const mainFloor = {
            floor: 0,
            name: "Ground Level",
            type: "ground",
            features: []
        };

        // Roads
        const roadOptions = {
            mainRoads: generationMethod === "guided" && guidedSketch?.mainRoads ? guidedSketch.mainRoads : [],
            rng,
            density,
            floor: 0
        };
        const roads = generateRoadNetwork(bounds, roadOptions);
        mainFloor.features.push(...roads);
        features.push(...roads);

        // Buildings
        const buildingOptions = {
            rng,
            density,
            centerDensity: 0.8,
            floor: 0,
            populationPerBuilding: population / 100
        };
        const buildings = generateBuildings(bounds, roads, buildingOptions);
        mainFloor.features.push(...buildings);
        features.push(...buildings);

        // Parks (if guided sketch provided, or randomly placed)
        const parks = [];
        if (generationMethod === "guided" && guidedSketch?.parks) {
            parks.push(...guidedSketch.parks);
        } else {
            const numParks = Math.max(1, Math.floor(density * 3));
            for (let i = 0; i < numParks; i++) {
                const pw = rng.range(150, 350);
                const ph = rng.range(150, 350);
                const px = bounds.minX + rng.next() * (bounds.maxX - bounds.minX);
                const py = bounds.minY + rng.next() * (bounds.maxY - bounds.minY);
                parks.push({
                    type: "Feature",
                    geometry: {
                        type: "Polygon",
                        coordinates: [[[px - pw / 2, py - ph / 2], [px + pw / 2, py - ph / 2], [px + pw / 2, py + ph / 2], [px - pw / 2, py + ph / 2], [px - pw / 2, py - ph / 2]]]
                    },
                    properties: {
                        type: "park",
                        floor: 0,
                        name: rng.choice(["Central Park", "Memorial Gardens", "City Plaza", "Recreation Area", "Green Space"])
                    }
                });
            }
        }
        mainFloor.features.push(...parks);
        features.push(...parks);

        // Multi-floor support: add underground levels if specified
        const floors = [mainFloor];
        const connectors = [];

        // Optional: add underground level for large settlements
        if (size === "large" || size === "metropolis") {
            const undergroundFloor = {
                floor: -1,
                name: "Underground Level",
                type: "underground",
                features: []
            };
            // Underground passages, transport hubs, storage
            const undergroundRoads = generateRoadNetwork(bounds, { ...roadOptions, floor: -1, density: density * 0.5 });
            undergroundFloor.features.push(...undergroundRoads);
            features.push(...undergroundRoads);

            floors.push(undergroundFloor);

            // Add elevators/stairs connecting levels
            const numConnectors = rng.range(3, 8);
            for (let i = 0; i < numConnectors; i++) {
                const cx = bounds.minX + rng.next() * (bounds.maxX - bounds.minX);
                const cy = bounds.minY + rng.next() * (bounds.maxY - bounds.minY);
                connectors.push({
                    type: rng.choice(["elevator", "stairs", "ramp"]),
                    position: [cx, cy],
                    from: -1,
                    to: 0,
                    name: rng.choice(["North Elevator", "Central Lift", "East Stairs", "West Passage"]) + ` #${i + 1}`
                });
            }
        }

        // Build settlement object
        const settlement = {
            type: "FeatureCollection",
            id,
            name,
            settlement_type: type,
            size,
            population,
            bounds: {
                type: "Polygon",
                coordinates: [[
                    [bounds.minX, bounds.minY],
                    [bounds.maxX, bounds.minY],
                    [bounds.maxX, bounds.maxY],
                    [bounds.minX, bounds.maxY],
                    [bounds.minX, bounds.minY]
                ]]
            },
            generationMethod,
            generatedAt: new Date().toISOString(),
            expansionLevel,
            floors,
            connectors,
            features
        };

        return settlement;
    }

    // ── Public API ──────────────────────────────────────────────────────────────
    return {
        // Generate a complete settlement
        generate(options) {
            return generateSettlement(options);
        },

        // Generate just roads for a region
        roads(bounds, options) {
            return generateRoadNetwork(bounds, options);
        },

        // Generate just buildings for a region
        buildings(bounds, roads, options) {
            return generateBuildings(bounds, roads, options);
        },

        // Export settlement as GeoJSON (for file storage)
        toGeoJSON(settlement) {
            return {
                type: "FeatureCollection",
                properties: {
                    id: settlement.id,
                    name: settlement.name,
                    type: settlement.settlement_type,
                    size: settlement.size,
                    population: settlement.population,
                    generationMethod: settlement.generationMethod,
                    expansionLevel: settlement.expansionLevel,
                    generatedAt: settlement.generatedAt
                },
                floors: settlement.floors,
                connectors: settlement.connectors,
                features: settlement.features
            };
        },

        // Import settlement from stored GeoJSON
        fromGeoJSON(geojson) {
            return {
                type: "FeatureCollection",
                id: geojson.properties?.id || geojson.id,
                name: geojson.properties?.name || "Settlement",
                settlement_type: geojson.properties?.type || "city",
                size: geojson.properties?.size || "medium",
                population: geojson.properties?.population || 0,
                bounds: geojson.properties?.bounds || null,
                generationMethod: geojson.properties?.generationMethod || "auto",
                generatedAt: geojson.properties?.generatedAt,
                expansionLevel: geojson.properties?.expansionLevel || 3,
                floors: geojson.floors || [],
                connectors: geojson.connectors || [],
                features: geojson.features || []
            };
        }
    };
})();

// Expose for use in other modules
if (typeof module !== 'undefined' && module.exports) {
    module.exports = SettlementGenerator;
}
