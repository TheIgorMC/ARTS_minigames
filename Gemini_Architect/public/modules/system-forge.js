// =============================================================================
//  GEMINI ARCHITECT — Module E: System Forge (Procedural Engine)
//  Seed-based star system generator + Asset Manifest Manager + Asset Dropper
// =============================================================================

const SystemForge = (() => {

    // ── Seeded PRNG (mulberry32) ───────────────────────────────────────────────
    function makePRNG(seed) {
        let s = seed >>> 0;
        return function () {
            s |= 0; s = s + 0x6D2B79F5 | 0;
            let t = Math.imul(s ^ s >>> 15, 1 | s);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }

    function strToSeed(str) {
        let h = 0x811c9dc5;
        for (let i = 0; i < str.length; i++) {
            h ^= str.charCodeAt(i);
            h = Math.imul(h, 0x01000193) >>> 0;
        }
        return h;
    }

    function weightedPick(rng, entries) {
        const total = entries.reduce((s, e) => s + e.weight, 0);
        let r = rng() * total;
        for (const e of entries) {
            r -= e.weight;
            if (r <= 0) return e.value;
        }
        return entries[entries.length - 1].value;
    }

    function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
    function randInt(rng, min, max) { return Math.floor(rng() * (max - min + 1)) + min; }

    // ── Star Class Definitions ─────────────────────────────────────────────────
    const STAR_CLASSES = {
        O: { weight: 0.05, colors: ['#9bb0ff', '#aabfff'],       radius_range: [6, 15],   hz_inner: 50,  hz_outer: 150, suffixes: ['Beacon', 'Blaze', 'Prime'] },
        B: { weight: 0.5,  colors: ['#aabfff', '#cad7ff'],       radius_range: [2, 6],    hz_inner: 20,  hz_outer: 80,  suffixes: ['Prime', 'Star', 'Arc'] },
        A: { weight: 1,    colors: ['#f8f7ff', '#ddeeff'],       radius_range: [1.5, 2.5],hz_inner: 8,   hz_outer: 35,  suffixes: ['Major', 'Rex', 'Light'] },
        F: { weight: 3,    colors: ['#fff4ea', '#ffeedd'],       radius_range: [1.1, 1.5],hz_inner: 2,   hz_outer: 10,  suffixes: ['Prime', 'Core', 'Sun'] },
        G: { weight: 7,    colors: ['#ffcc00', '#ffe0a0'],       radius_range: [0.8, 1.2],hz_inner: 1,   hz_outer: 5,   suffixes: ['Prime', 'Sol', 'Dawn'] },
        K: { weight: 12,   colors: ['#ffae66', '#ff9944'],       radius_range: [0.6, 0.9],hz_inner: 0.5, hz_outer: 2,   suffixes: ['Dim', 'Ember', 'Glow'] },
        M: { weight: 76,   colors: ['#ff4400', '#ff6600', '#cc2200'], radius_range: [0.08, 0.6], hz_inner: 0.1, hz_outer: 0.5, suffixes: ['Dwarf', 'Red', 'Ember'] },
    };

    // ── Planet Types per Zone ──────────────────────────────────────────────────
    const ZONE_PLANETS = {
        furnace: [
            { value: 'Barren',  weight: 4 },
            { value: 'Lava',    weight: 3 },
            { value: 'Rock',    weight: 3 },
        ],
        cradle: [
            { value: 'Terran',  weight: 4 },
            { value: 'Ocean',   weight: 2 },
            { value: 'Jungle',  weight: 2 },
            { value: 'Desert',  weight: 2 },
        ],
        deep: [
            { value: 'Gas Giant',  weight: 5 },
            { value: 'Ice Giant',  weight: 4 },
            { value: 'Barren',     weight: 1 },
        ],
    };

    // ── Planet Name Pools ──────────────────────────────────────────────────────
    const PLANET_NAMES = {
        Terran:      ['Vitara', 'Neova', 'Greenmere', 'Arcadia', 'Verdun', 'Hallava', 'Ternex'],
        Ocean:       ['Oceanus', 'Mareas', 'Poseidon', 'Undine', 'Deluge', 'Pelagis', 'Abyssia'],
        Jungle:      ['Ferox', 'Verdax', 'Sylvara', 'Thornveil', 'Canopy', 'Deeproot', 'Overia'],
        Desert:      ['Saren', 'Dune', 'Aethon', 'Ashveil', 'Scorch', 'Sandara', 'Ariden'],
        Barren:      ['Cinder', 'Grit', 'Ashen', 'Desolus', 'Rubble', 'Pebrix', 'Dusthaven'],
        Lava:        ['Ignar', 'Pyroc', 'Scald', 'Moltis', 'Flare', 'Caldera', 'Embrix'],
        Rock:        ['Chert', 'Gravel', 'Obsid', 'Flint', 'Slag', 'Quarrite', 'Ironrock'],
        'Gas Giant': ['Jovara', 'Magnax', 'Stratum', 'Nebular', 'Galex', 'Colossex', 'Vortania'],
        'Ice Giant': ['Cryox', 'Frostia', 'Glacian', 'Iceval', 'Brine', 'Polaris', 'Winteris'],
    };

    // ── Body render metadata by planet type ────────────────────────────────────
    const ATMOSPHERE_COLOR = {
        Terran:         '#88aaff',
        Ocean:          '#2244ee',
        Jungle:         '#44aa44',
        Desert:         '#cc8844',
        'Gas Giant':    '#cc8866',
        'Ice Giant':    '#aaccff',
        Lava:           '#ff4400',
        Barren:         '#888888',
        Rock:           '#666655',
        'Dwarf Planet': '#555555',
    };

    const TEXTURE_PREFIX = {
        Terran:         'terran',
        Ocean:          'ocean',
        Jungle:         'jungle',
        Desert:         'desert',
        'Gas Giant':    'gas_giant',
        'Ice Giant':    'ice_giant',
        Lava:           'lava',
        Barren:         'barren',
        Rock:           'rock',
    };

    // ── Default Station Templates (fallback when manifest is empty) ────────────
    const STATION_TEMPLATES = {
        trade:    { name: 'Trade Hub',        model_3d: 'assets/models/station_ring_01.glb',   scale: 1.0, faction: 'Merchant_Guild' },
        refinery: { name: 'Refinery Station', model_3d: 'assets/models/refinery_01.glb',       scale: 0.9, faction: 'Corporate' },
        mining:   { name: 'Mining Rig',       model_3d: 'assets/models/mining_rig_small.glb',  scale: 0.8, faction: 'Independent' },
        military: { name: 'Defense Platform', model_3d: 'assets/models/mil_platform_01.glb',   scale: 1.2, faction: 'Gemini_Defense_Force' },
        outpost:  { name: 'Outpost Alpha',    model_3d: 'assets/models/station_outpost_01.glb',scale: 0.7, faction: 'Independent' },
        debris:   { name: 'Wreckage',         model_3d: 'assets/models/wreckage_capital.glb',  scale: 0.8, faction: null },
    };

    // ── Syllable pools for name generation ────────────────────────────────────
    const SYL  = ['Kil','Vor','Aex','Sol','Dra','Nex','Vel','Zar','Om','Ker','Thal','Ixar','Mor','Tar','Bel','Anx',
                  'Eth','Cyr','Pal','Ryn','Hox','Fex','Wur','Tev','Ori','Cass','Lyr','Phe','Dor','Sax','Wyn','Brak'];
    const SYL2 = ['ara','ix','on','ax','us','an','or','el','is','ar','en','ox','ia','ex','ath','eon','ion','ux','os','eth'];
    const GREEK = ['Alpha','Beta','Gamma','Delta','Epsilon','Zeta','Eta','Theta','Kappa','Lambda',
                   'Mu','Nu','Sigma','Tau','Upsilon','Phi','Chi','Psi','Omega','Iota','Pi','Rho'];
    const SF_CONSTELLATIONS = ['Arconis','Velara','Dravus','Serpenix','Kethis','Mordain','Tylath','Nexara',
                               'Glorian','Velphos','Tharux','Zimon','Corvath','Ixelon','Praelar','Suneth',
                               'Orrath','Belnyx','Solvaer','Hyparis','Draventis','Caelux'];
    const CATALOG_PFXS = ['HX','GJ','KIC','BD','HD','VT','TYC','XR','NZ','RG'];

    function genStarName(rng) {
        const pattern = randInt(rng, 0, 2);
        if (pattern === 0) {
            return pick(rng, SYL) + pick(rng, SYL2);
        } else if (pattern === 1) {
            return `${pick(rng, CATALOG_PFXS)}-${randInt(rng, 100, 9999)}`;
        } else {
            return `${pick(rng, GREEK)} ${pick(rng, SF_CONSTELLATIONS)}`;
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Core Procedural Generator
    // ─────────────────────────────────────────────────────────────────────────
    function generateSystem(params, manifest) {
        const { seed, archetype, planetDensity, civDensity } = params;
        const rng = makePRNG(strToSeed(seed || 'default'));

        // 1. Star
        let spectralClass;
        if      (archetype === 'Red Dwarf')  spectralClass = 'M';
        else if (archetype === 'Blue Giant') spectralClass = 'B';
        else if (archetype === 'Dead System') spectralClass = weightedPick(rng, [
            { value: 'K', weight: 5 }, { value: 'M', weight: 5 }, { value: 'G', weight: 2 },
        ]);
        else spectralClass = weightedPick(rng,
            Object.entries(STAR_CLASSES).map(([k, v]) => ({ value: k, weight: v.weight }))
        );

        const starDef    = STAR_CLASSES[spectralClass];
        const starColor  = pick(rng, starDef.colors);
        const starRadius = Math.round((starDef.radius_range[0] + rng() * (starDef.radius_range[1] - starDef.radius_range[0])) * 696000);
        const isDead     = archetype === 'Dead System';
        const starName   = isDead
            ? (pick(rng, ['Cinder', 'Ash', 'Null', 'Void']) + ' ' + pick(rng, ['Zero', 'Wraith', 'End']))
            : (genStarName(rng) + ' ' + pick(rng, starDef.suffixes));

        const hz_inner   = starDef.hz_inner;
        const hz_outer   = starDef.hz_outer;
        const sysRange   = hz_outer * 10;

        // 2. Orbital count (based on planet density slider 0–1)
        const wealthLevel = isDead ? 0 : Math.round(civDensity * 10);
        const baseCount   = isDead ? randInt(rng, 0, 3)
            : planetDensity < 0.33 ? randInt(rng, 1, 3)
            : planetDensity < 0.66 ? randInt(rng, 3, 6)
            :                        randInt(rng, 5, 10);

        // 3. Build orbital slots with radii
        const orbitals = [];
        const slots    = buildOrbitSlots(rng, baseCount, hz_inner, hz_outer, sysRange);

        for (let i = 0; i < slots.length; i++) {
            const orb = buildOrbital(rng, i + 1, slots[i], isDead);
            if (!isDead && wealthLevel > 0) addStations(rng, orb, wealthLevel, archetype, manifest);
            orbitals.push(orb);
        }

        // 4. Asteroid belt (probabilistic)
        if (rng() < (isDead ? 0.7 : 0.45)) {
            const beltR    = hz_outer * (1.5 + rng() * 2);
            const beltDef  = {
                id:           `belt_${randInt(rng, 1000, 9999)}`,
                name:         pick(rng, ['The Iron Ring', 'The Dust Belt', 'Shattered Mantle', 'The Debris Field', 'Outer Ring']),
                type:         'Asteroid Belt',
                orbit_index:  orbitals.length + 1,
                orbit_radius: +beltR.toFixed(2),
                width:        +(0.1 + rng() * 0.3).toFixed(2),
                density:      pick(rng, ['Low', 'Medium', 'High']),
                texture:      'assets/textures/belts/rocky_ring.png',
                children:     [],
            };
            // Mining outposts in belt
            if (wealthLevel >= 3) {
                const mCount = randInt(rng, 1, Math.min(3, Math.ceil(wealthLevel / 3)));
                for (let k = 0; k < mCount; k++) {
                    beltDef.children.push({
                        id:             `mining_${k}_${randInt(rng, 100, 999)}`,
                        name:           `Deep Dig ${String(k + 1).padStart(2, '0')}`,
                        type:           'Station',
                        model_3d:       resolveModel(rng, 'mining', manifest),
                        scale:          +(0.7 + rng() * 0.3).toFixed(2),
                        orbit_distance: +(0.002 + rng() * 0.005).toFixed(4),
                        faction:        'Independent',
                    });
                }
            }
            orbitals.push(beltDef);
        }

        // 5. Binary companion (placeholder — second star as special orbital)
        if (archetype === 'Binary') {
            const cls2 = weightedPick(rng, [
                { value: 'K', weight: 8 }, { value: 'M', weight: 12 }, { value: 'G', weight: 3 },
            ]);
            const def2 = STAR_CLASSES[cls2];
            orbitals.push({
                id:           `companion_star`,
                name:         genStarName(rng) + ' (Companion)',
                type:         'Companion Star',
                orbit_index:  orbitals.length + 1,
                orbit_radius: +(hz_outer * (8 + rng() * 4)).toFixed(2),
                spectral_class: cls2,
                color_hex:    pick(rng, def2.colors),
                children:     [],
            });
        }

        const systemId = (seed || 'generated').toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        return {
            id:   `sys_${systemId}`,
            name: starName,
            star: {
                name:           starName,
                spectral_class: spectralClass + '2V',
                radius_km:      starRadius,
                color_hex:      starColor,
            },
            orbitals,
        };
    }

    function buildOrbitSlots(rng, count, hz_inner, hz_outer, sysRange) {
        const slots = [];
        let r = hz_inner * 0.1;
        const step = sysRange / Math.max(count, 1);
        for (let i = 0; i < count; i++) {
            r += step * (0.5 + rng() * 1.0);
            slots.push({
                radius: +r.toFixed(2),
                zone:   r < hz_inner ? 'furnace' : r <= hz_outer ? 'cradle' : 'deep',
            });
        }
        return slots;
    }

    function buildOrbital(rng, index, slot, isDead) {
        const plantTypes = isDead
            ? [{ value: 'Barren', weight: 5 }, { value: 'Rock', weight: 3 }, { value: 'Dwarf Planet', weight: 2 }]
            : ZONE_PLANETS[slot.zone];
        const pType = weightedPick(rng, plantTypes);
        const id    = `planet_${String(index).padStart(2, '0')}_${randInt(rng, 1000, 9999)}`;
        const names = PLANET_NAMES[pType] || PLANET_NAMES.Barren;

        const orb = {
            id,
            name:         pick(rng, names),
            type:         pType.includes('Giant') ? pType : 'Planet',
            planet_type:  pType,
            orbit_index:  index,
            orbit_radius: slot.radius,
            texture:      `assets/textures/planets/${TEXTURE_PREFIX[pType] || 'barren'}_${String(randInt(rng, 1, 6)).padStart(2, '0')}.webp`,
            file:         `data/bodies/${id}.json`,
            children:     [],
        };

        // Moons
        if (!isDead) {
            const moonProb  = slot.zone === 'cradle' ? 0.4 : slot.zone === 'deep' ? 0.85 : 0;
            const moonCount = slot.zone === 'deep' ? randInt(rng, 1, 4) : randInt(rng, 1, 2);
            if (rng() < moonProb) {
                const labels = ['I', 'II', 'III', 'IV'];
                for (let m = 0; m < moonCount; m++) {
                    orb.children.push({
                        id:             `moon_${m}_${randInt(rng, 100, 999)}`,
                        name:           `${orb.name} ${labels[m] || (m + 1)}`,
                        type:           'Moon',
                        orbit_distance: +(0.02 + rng() * 0.08).toFixed(3),
                    });
                }
            }
        }
        return orb;
    }

    function addStations(rng, orb, wealthLevel, archetype, manifest) {
        if (archetype === 'Dead System') return;
        const habitable    = ['Terran', 'Ocean', 'Jungle'].includes(orb.type);
        const isGasGiant   = orb.type === 'Gas Giant';
        const wFactor      = wealthLevel / 10;

        const candidates = [];
        if (isGasGiant   && rng() < 0.45 * wFactor) candidates.push('refinery');
        if (habitable    && rng() < 0.50 * wFactor) candidates.push(wealthLevel >= 7 ? 'military' : 'trade');
        if (!isGasGiant  && rng() < 0.25 * wFactor) candidates.push('outpost');

        for (const sType of candidates) {
            const tpl = STATION_TEMPLATES[sType];
            orb.children.push({
                id:             `${sType}_${randInt(rng, 100, 9999)}`,
                name:           tpl.name,
                type:           'Station',
                model_3d:       resolveModel(rng, sType, manifest),
                scale:          +(tpl.scale * (0.8 + rng() * 0.4)).toFixed(2),
                orbit_distance: +(0.003 + rng() * 0.008).toFixed(4),
                faction:        tpl.faction,
            });
        }
    }

    // ── Body File Construction ────────────────────────────────────────────────
    function buildBodyFile(orbital, rng) {
        const pType  = orbital.planet_type || orbital.type || 'Barren';
        const prefix = TEXTURE_PREFIX[pType] || 'barren';
        const tidx   = String(randInt(rng, 1, 8)).padStart(2, '0');
        const atmo   = ATMOSPHERE_COLOR[pType] || '#888888';
        return {
            id:          orbital.id,
            render_data: {
                texture_diffuse:  `assets/textures/planets/${prefix}_${tidx}.webp`,
                texture_bump:     `assets/textures/planets/${prefix}_bump_${tidx}.webp`,
                texture_specular: `assets/textures/planets/${prefix}_spec_${tidx}.webp`,
                atmosphere_color: atmo,
                rotation_speed:   +(0.001 + rng() * 0.009).toFixed(4),
            },
            pois: [],
        };
    }

    async function saveBodyFiles(systemData) {
        const bodyRng = makePRNG(strToSeed((systemData.id || 'bodies') + '_bodies'));
        for (const orb of (systemData.orbitals || [])) {
            if (orb.file && orb.type !== 'Asteroid Belt' && orb.type !== 'Companion Star') {
                const bodyData = buildBodyFile(orb, bodyRng);
                await API.saveFile(orb.file, bodyData);
            }
        }
    }

    function resolveModel(rng, sType, manifest) {
        const lib = manifest?.models_library || [];
        let pool;
        if      (sType === 'trade')    pool = lib.filter(m => m.tags?.includes('trade') || m.type === 'Trade_Station');
        else if (sType === 'refinery') pool = lib.filter(m => m.type === 'Refinery');
        else if (sType === 'military') pool = lib.filter(m => m.type === 'Military_Base' || m.tags?.includes('high_security'));
        else if (sType === 'mining')   pool = lib.filter(m => m.type === 'Mining_Outpost' || m.tags?.includes('mining'));
        else if (sType === 'outpost')  pool = lib.filter(m => m.type === 'Civilian_Outpost');
        else pool = [];

        if (pool && pool.length > 0) return `assets/models/${pick(rng, pool).file}`;
        return STATION_TEMPLATES[sType]?.model_3d || 'assets/models/unknown.glb';
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Module State
    // ─────────────────────────────────────────────────────────────────────────
    let manifest      = { models_library: [] };
    let lastGenerated = null;

    // ─────────────────────────────────────────────────────────────────────────
    //  DOM Cache
    // ─────────────────────────────────────────────────────────────────────────
    const el = {};

    function cacheEls() {
        [
            'sf-seed', 'sf-archetype',
            'sf-density-planets', 'sf-density-planets-val',
            'sf-density-civ', 'sf-density-civ-val',
            'sf-generate-btn', 'sf-result-box', 'sf-result-json',
            'sf-save-name', 'sf-save-btn',
            'sf-manifest-filter', 'sf-manifest-list', 'sf-manifest-add-btn',
            'sf-ad-filter', 'sf-ad-list',
        ].forEach(id => { el[id] = document.getElementById(id); });
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Manifest Manager
    // ─────────────────────────────────────────────────────────────────────────
    async function loadManifest() {
        try {
            manifest = await API.getManifest();
        } catch {
            manifest = { models_library: [] };
        }
        renderManifestList();
        renderAssetDropper();
    }

    function renderManifestList() {
        const filter = (el['sf-manifest-filter']?.value || '').toLowerCase();
        const list   = el['sf-manifest-list'];
        if (!list) return;

        const models = (manifest.models_library || []).filter(m =>
            !filter || m.id?.toLowerCase().includes(filter) || m.type?.toLowerCase().includes(filter)
        );

        list.innerHTML = '';
        if (!models.length) {
            list.innerHTML = '<div class="sf-empty">No models in manifest.</div>';
            return;
        }
        models.forEach((model, idx) => {
            const row      = document.createElement('div');
            row.className  = 'sf-manifest-row';
            row.innerHTML  = `
                <span class="sf-model-type">[${model.type || '?'}]</span>
                <span class="sf-model-id">${model.id}</span>
                <span class="sf-model-file">${model.file}</span>
                <button class="btn btn-sm btn-danger sf-del-model" data-idx="${idx}" title="Remove">✕</button>
            `;
            row.querySelector('.sf-del-model').addEventListener('click', async () => {
                const realIdx = manifest.models_library.indexOf(model);
                if (realIdx > -1) manifest.models_library.splice(realIdx, 1);
                await API.saveManifest(manifest);
                notify('Model removed from manifest.', 'warning');
                renderManifestList();
                renderAssetDropper();
            });
            list.appendChild(row);
        });
    }

    function renderAssetDropper() {
        const filter = (el['sf-ad-filter']?.value || '').toLowerCase();
        const list   = el['sf-ad-list'];
        if (!list) return;

        const models = (manifest.models_library || []).filter(m =>
            !filter || m.type?.toLowerCase().includes(filter) || m.tags?.some(t => t.toLowerCase().includes(filter))
        );

        list.innerHTML = '';
        if (!models.length) {
            list.innerHTML = '<div class="sf-empty">No matching models.<br>Add entries in the Manifest tab.</div>';
            return;
        }
        models.forEach(model => {
            const row      = document.createElement('div');
            row.className  = 'sf-asset-row';
            row.draggable  = true;
            row.innerHTML  = `
                <span class="sf-asset-icon" title="${model.type}">📦</span>
                <div class="sf-asset-info">
                    <span class="sf-asset-id">${model.id}</span>
                    <span class="sf-asset-type">${model.type || '—'}</span>
                </div>
                <span class="sf-asset-scale">×${model.default_scale ?? 1}</span>
                <button class="btn btn-sm sf-asset-send" title="Add to selected orbital in Orrery Builder">→ Orrery</button>
            `;
            row.addEventListener('dragstart', e => {
                e.dataTransfer.setData('application/json', JSON.stringify(model));
                e.dataTransfer.effectAllowed = 'copy';
            });
            row.querySelector('.sf-asset-send').addEventListener('click', () => sendToOrrery(model));
            list.appendChild(row);
        });
    }

    function sendToOrrery(model) {
        if (typeof OrreryBuilder !== 'undefined' && OrreryBuilder.addChildStation) {
            const station = {
                id:             `${model.id.replace(/[^a-z0-9]/gi, '_')}_${(Date.now() & 0xFFFF).toString(16)}`,
                name:           model.id.replace(/_/g, ' '),
                type:           'Station',
                model_3d:       `assets/models/${model.file}`,
                scale:          model.default_scale ?? 1.0,
                orbit_distance: 0.005,
                faction:        model.type?.includes('Military') ? 'Defense_Force' : 'Independent',
            };
            const added = OrreryBuilder.addChildStation(station);
            if (added) {
                document.querySelector('[data-module="orrery"]').click();
                notify(`Sent "${model.id}" to Orrery Builder.`, 'success');
            } else {
                notify('Select an orbital in the Orrery Builder first.', 'warning');
            }
        } else {
            notify('Open a system in the Orrery Builder first.', 'warning');
        }
    }

    async function addModelToManifest() {
        const bodyHTML = `
            <label class="form-label">GLB FILE (filename only)</label>
            <input class="form-input" id="sf-mi-file" placeholder="station_ring_01.glb" style="margin-bottom:6px" />
            <label class="form-label">MODEL ID</label>
            <input class="form-input" id="sf-mi-id" placeholder="model_station_ring_01" style="margin-bottom:6px" />
            <label class="form-label">TYPE</label>
            <select class="form-select" id="sf-mi-type" style="margin-bottom:6px">
                <option>Civilian_Outpost</option>
                <option>Military_Base</option>
                <option>Trade_Station</option>
                <option>Refinery</option>
                <option>Mining_Outpost</option>
                <option>Debris</option>
                <option>Ship</option>
                <option>Other</option>
            </select>
            <label class="form-label">TAGS (comma-separated)</label>
            <input class="form-input" id="sf-mi-tags" placeholder="trade, common, low_security" style="margin-bottom:6px" />
            <label class="form-label">DEFAULT SCALE</label>
            <input class="form-input" id="sf-mi-scale" type="number" step="0.1" value="1.0" />
        `;
        const ok = await showModal('Add Model to Manifest', bodyHTML);
        if (!ok) return;
        const file  = document.getElementById('sf-mi-file')?.value?.trim();
        const id    = document.getElementById('sf-mi-id')?.value?.trim()  || file?.replace(/\.glb$/i, '');
        const type  = document.getElementById('sf-mi-type')?.value;
        const tags  = (document.getElementById('sf-mi-tags')?.value || '').split(',').map(t => t.trim()).filter(Boolean);
        const scale = parseFloat(document.getElementById('sf-mi-scale')?.value) || 1.0;
        if (!file || !id) { notify('File and ID are required.', 'warning'); return; }
        if (!manifest.models_library) manifest.models_library = [];
        manifest.models_library.push({ file, id, type, tags, default_scale: scale });
        await API.saveManifest(manifest);
        notify(`Model "${id}" added.`, 'success');
        renderManifestList();
        renderAssetDropper();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Generation
    // ─────────────────────────────────────────────────────────────────────────
    function doGenerate() {
        const seed          = el['sf-seed']?.value?.trim() || 'Campaign2026';
        const archetype     = el['sf-archetype']?.value    || 'Random';
        const planetDensity = parseFloat(el['sf-density-planets']?.value || 50) / 100;
        const civDensity    = parseFloat(el['sf-density-civ']?.value    || 50) / 100;
        try {
            lastGenerated = generateSystem({ seed, archetype, planetDensity, civDensity }, manifest);
            el['sf-result-json'].textContent = JSON.stringify(lastGenerated, null, 2);
            el['sf-result-box'].style.display = 'flex';
            el['sf-placeholder'].style.display = 'none';
            // Default save name to star name
            const starName = lastGenerated.star?.name || lastGenerated.id;
            el['sf-save-name'].value = starName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/__+/g, '_');
            if (el['sf-save-section']) el['sf-save-section'].style.display = '';
            // Canvas preview
            const canvas = document.getElementById('sf-orbit-canvas');
            if (canvas && typeof renderOrreryMap === 'function') {
                requestAnimationFrame(() => renderOrreryMap(canvas, lastGenerated));
            }
            const star = lastGenerated.star;
            const orbs = lastGenerated.orbitals;
            const stationCount = orbs.reduce((s, o) => s + (o.children?.filter(c => c.type === 'Station').length || 0), 0);
            notify(`Generated: ${star.name} (${star.spectral_class}) — ${orbs.length} orbitals, ${stationCount} stations`, 'success');
            setStatus(`System Forge: "${star.name}" — ${orbs.length} orbitals`, lastGenerated.id);
        } catch (e) {
            notify(`Generation error: ${e.message}`, 'error');
            console.error(e);
        }
    }

    async function doSave() {
        if (!lastGenerated) { notify('Generate a system first.', 'warning'); return; }
        const rawName = el['sf-save-name']?.value?.trim() || lastGenerated.star?.name || lastGenerated.id;
        const id      = rawName.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        const rel     = `data/systems/${id}.json`;
        const data    = { ...lastGenerated, id };
        try {
            await saveBodyFiles(data);
            await API.saveFile(rel, data);
            if (typeof OrreryBuilder !== 'undefined') {
                await OrreryBuilder.reload();
                await OrreryBuilder.loadByFile(rel);
            }
            document.querySelector('[data-module="orrery"]')?.click();
            notify(`Saved "${id}" + body files, opened in Orrery Builder.`, 'success');
        } catch (e) {
            notify(`Save failed: ${e.message}`, 'error');
        }
    }

    // ── Bulk / External Generation ───────────────────────────────────────────
    async function generateAndLink(nodeId, options, callback) {
        const opts          = options || {};
        const archetype     = opts.archetype     || 'Random';
        const planetDensity = opts.planetDensity ?? 0.5;
        const civDensity    = opts.civDensity    ?? 0.4;
        try {
            const systemData = generateSystem({ seed: nodeId, archetype, planetDensity, civDensity }, manifest);
            const starName   = systemData.star?.name || nodeId;
            const id         = starName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/__+/g, '_');
            const rel        = `data/systems/${id}.json`;
            const saveData   = { ...systemData, id };
            notify(`Forging "${starName}"…`, 'info', 2000);
            await saveBodyFiles(saveData);
            await API.saveFile(rel, saveData);
            notify(`Forged "${starName}" (${saveData.orbitals?.length} orbitals).`, 'success');
            if (callback) callback(rel, starName);
        } catch (err) {
            notify(`Forge failed for ${nodeId}: ${err.message}`, 'error');
            console.error(err);
        }
    }

    async function populateSector(sectorData, onProgress, onDone) {
        const nodes = sectorData.systems || [];
        const total = nodes.length;
        let done = 0;
        for (const sys of nodes) {
            const nodeId = sys.id;
            try {
                const systemData = generateSystem(
                    { seed: nodeId, archetype: 'Random', planetDensity: 0.5, civDensity: 0.4 },
                    manifest
                );
                const starName = systemData.star?.name || nodeId;
                const id       = starName.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/__+/g, '_');
                const rel      = `data/systems/${id}.json`;
                const saveData = { ...systemData, id };
                await saveBodyFiles(saveData);
                await API.saveFile(rel, saveData);
                sys.file = rel;
                sys.name = starName;   // update node label to match star name
            } catch (err) {
                console.error(`Failed to forge ${nodeId}:`, err);
            }
            done++;
            if (onProgress) onProgress(done, total, sys);
        }
        if (onDone) onDone();
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Event Wiring
    // ─────────────────────────────────────────────────────────────────────────
    function wireEvents() {
        el['sf-density-planets']?.addEventListener('input', () => {
            const v = parseInt(el['sf-density-planets'].value);
            el['sf-density-planets-val'].textContent = v < 33 ? 'SPARSE' : v < 66 ? 'AVERAGE' : 'CROWDED';
        });
        el['sf-density-civ']?.addEventListener('input', () => {
            const v = parseInt(el['sf-density-civ'].value);
            el['sf-density-civ-val'].textContent = v < 25 ? 'EMPTY' : v < 50 ? 'FRONTIER' : v < 75 ? 'SETTLED' : 'CORE WORLD';
        });
        el['sf-generate-btn']?.addEventListener('click', doGenerate);
        el['sf-save-btn']?.addEventListener('click', doSave);
        el['sf-manifest-add-btn']?.addEventListener('click', addModelToManifest);
        el['sf-manifest-filter']?.addEventListener('input', renderManifestList);
        el['sf-ad-filter']?.addEventListener('input', renderAssetDropper);
    }

    // ─────────────────────────────────────────────────────────────────────────
    //  Public API
    // ─────────────────────────────────────────────────────────────────────────
    return {
        init() {
            cacheEls();
            wireEvents();
            loadManifest();
        },
        getManifest:      () => manifest,
        reloadManifest:   loadManifest,
        generateAndLink,
        populateSector,
    };

})();
