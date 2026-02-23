/**
 * import_ruleset.js
 * 
 * Imports Starfinder ruleset data (races, classes, themes, feats, class features,
 * racial features, theme features) from the FoundryVTT Starfinder source files.
 * 
 * Outputs: data/ruleset.json
 * 
 * Each entry includes a normalized `source` field for filtering by manual/book.
 */

const fs = require('fs');
const path = require('path');

const REFERENCE_DIR = path.join(__dirname, 'REFERENCE', 'foundryvtt-starfinder-development', 'src', 'items');
const OUTPUT_FILE = path.join(__dirname, 'data', 'ruleset.json');

// --- SOURCE NORMALIZATION ---
const SOURCE_ABBREVIATION_MAP = {
    'crb': 'CRB',
    'core rulebook': 'CRB',
    'core': 'CRB',
    'aa': 'AA1',
    'alien archive': 'AA1',
    'aa1': 'AA1',
    'aa2': 'AA2',
    'alien archive 2': 'AA2',
    'aa3': 'AA3',
    'alien archive 3': 'AA3',
    'aa4': 'AA4',
    'alien archive 4': 'AA4',
    'aa5': 'AA5',
    'alien archive 5': 'AA5',
    'aa6': 'AA6',
    'alien archive 6': 'AA6',
    'pw': 'PW',
    'pact worlds': 'PW',
    'arm': 'ARM',
    'armory': 'ARM',
    'com': 'COM',
    'character operations manual': 'COM',
    'ns': 'NS',
    'near space': 'NS',
    'gem': 'GEM',
    'galactic exploration manual': 'GEM',
    'gm': 'GEM',
    'tr': 'TR',
    'tech revolution': 'TR',
    'dc': 'DC',
    'drift crisis': 'DC',
    'is': 'IS',
    'interstellar species': 'IS',
    'galactic magic': 'GM',
    'som': 'SOM',
    'starfinder operations manual': 'SOM',
    'sf': 'SF',
    'sfs': 'SFS',
    'starfinder society': 'SFS',
    'ap': 'AP',
    'adventure path': 'AP',
    'pw2': 'PW2',
    'ports of call': 'POC',
    'poc': 'POC',
    'evolutions unleashed': 'EU',
    'eu': 'EU',
    // Class names -> their source books
    'soldier': 'CRB',
    'mystic': 'CRB',
    'mechanic': 'CRB',
    'operative': 'CRB',
    'envoy': 'CRB',
    'solarian': 'CRB',
    'technomancer': 'CRB',
    'biohacker': 'COM',
    'vanguard': 'COM',
    'witchwarper': 'COM',
    'nanocyte': 'TR',
    'evolutionist': 'IS',
    'precog': 'GEM',
    // Common feature-source identifiers
    'fighting style': 'CRB',
    'connection': 'CRB',
    'stellar revelation': 'CRB',
    'magic hack': 'CRB',
    'operative exploit': 'CRB',
    'mechanic trick': 'CRB',
    'envoy improvisation': 'CRB',
    'gear boost': 'CRB',
    'theorem': 'COM',
    'discipline': 'COM',
    'paradigm shift': 'COM',
    'feat': 'CRB',
    'racial': 'CRB',
    'species': 'CRB',
    // Sub-feature patterns
    'cache capacitor': 'TR',
    'field of study': 'COM',
    'niche': 'IS',
    'anchor': 'GEM',
    'paradox': 'GEM',
    'epiphany': 'CRB',
};

const SOURCE_FULL_NAMES = {
    'CRB': 'Core Rulebook',
    'AA1': 'Alien Archive',
    'AA2': 'Alien Archive 2',
    'AA3': 'Alien Archive 3',
    'AA4': 'Alien Archive 4',
    'AA5': 'Alien Archive 5',
    'AA6': 'Alien Archive 6',
    'PW': 'Pact Worlds',
    'ARM': 'Armory',
    'COM': 'Character Operations Manual',
    'NS': 'Near Space',
    'GEM': 'Galactic Exploration Manual',
    'TR': 'Tech Revolution',
    'DC': 'Drift Crisis',
    'IS': 'Interstellar Species',
    'GM': 'Galactic Magic',
    'SOM': 'Starfinder Operations Manual',
    'SFS': 'Starfinder Society',
    'AP': 'Adventure Path',
    'POC': 'Ports of Call',
    'EU': 'Evolutions Unleashed',
};

function normalizeSource(rawSource) {
    if (!rawSource || typeof rawSource !== 'string') return { code: 'UNK', name: 'Unknown', page: '', raw: rawSource || '' };

    const raw = rawSource.trim();

    // Try to extract book abbreviation and page from patterns like:
    // "CRB pg. 44", "Core Rulebook, pg 163", "AA2 pg. 76", "PW pg. 211"
    // Also handle: "CRB, p. 110", "Core Rulebook"
    const pageMatch = raw.match(/(?:pg\.?|p\.?|page)\s*(\d+)/i);
    const page = pageMatch ? pageMatch[1] : '';

    // Get the book part (before pg/p/page or the whole string)
    let bookPart = raw.replace(/[,;]\s*(pg\.?|p\.?|page)\s*\d+.*/i, '').replace(/(pg\.?|p\.?|page)\s*\d+.*/i, '').trim();
    // Remove trailing comma/period
    bookPart = bookPart.replace(/[,.\s]+$/, '').toLowerCase();

    // Try direct lookup
    if (SOURCE_ABBREVIATION_MAP[bookPart]) {
        const code = SOURCE_ABBREVIATION_MAP[bookPart];
        return { code, name: SOURCE_FULL_NAMES[code] || code, page, raw };
    }

    // Try partial match
    for (const [key, code] of Object.entries(SOURCE_ABBREVIATION_MAP)) {
        if (bookPart.includes(key) || key.includes(bookPart)) {
            return { code, name: SOURCE_FULL_NAMES[code] || code, page, raw };
        }
    }

    // If it looks like an AP reference (e.g., "AP #1" or "Dead Suns")
    if (/^ap\s*#?\d/i.test(bookPart) || /adventure path/i.test(bookPart)) {
        return { code: 'AP', name: 'Adventure Path', page, raw };
    }

    // Check for SFS scenarios
    if (/^sfs\s*#?\d/i.test(bookPart) || /society/i.test(bookPart)) {
        return { code: 'SFS', name: 'Starfinder Society', page, raw };
    }

    // Fallback: use first word as code
    const firstWord = bookPart.split(/\s+/)[0].toUpperCase().replace(/[^A-Z0-9]/g, '');
    return { code: firstWord || 'UNK', name: raw.replace(/\s*(pg\.?|p\.?|page)\s*\d+.*/i, '').trim(), page, raw };
}

// --- TEXT CLEANING ---
function cleanText(text) {
    if (!text) return '';
    text = text.replace(/@UUID\[[^\]]+\]\{([^}]+)\}/g, '$1');
    text = text.replace(/@Compendium\[[^\]]+\]\{([^}]+)\}/g, '$1');
    text = text.replace(/@Item\[[^\]]+\]\{([^}]+)\}/g, '$1');
    text = text.replace(/@Check\[[^\]]+\]\{([^}]+)\}/g, '$1');
    text = text.replace(/@Check\[[^\]]+\]/g, '');
    text = text.replace(/@abilities\.(\w+)\.mod/g, (match, p1) => p1.toUpperCase());
    text = text.replace(/@details\.level\.value/g, 'character level');
    return text;
}

// --- FILE READING ---
function readJsonFilesFromDir(dirName) {
    const dirPath = path.join(REFERENCE_DIR, dirName);
    if (!fs.existsSync(dirPath)) {
        console.warn(`Directory not found: ${dirPath}`);
        return [];
    }

    const results = [];
    const files = fs.readdirSync(dirPath);

    files.forEach(file => {
        if (!file.endsWith('.json')) return;
        try {
            const content = fs.readFileSync(path.join(dirPath, file), 'utf8');
            results.push(JSON.parse(content));
        } catch (e) {
            console.error(`Error reading ${dirName}/${file}:`, e.message);
        }
    });

    return results;
}

// --- MAPPERS ---

function mapRace(src) {
    const sys = src.system || {};
    const abilityMods = (sys.abilityMods && sys.abilityMods.parts) || [];
    const source = normalizeSource(sys.source);

    return {
        id: src._id,
        name: src.name,
        type: sys.type || 'humanoid',
        subtype: sys.subtype || '',
        size: sys.size || 'medium',
        hp: (sys.hp && sys.hp.value) || 0,
        abilityMods: abilityMods.map(mod => ({
            value: mod[0],
            ability: mod[1]  // 'str', 'dex', etc. or 'any'
        })),
        description: cleanText(sys.description ? sys.description.value : ''),
        source: source,
        img: src.img || ''
    };
}

function mapClass(src) {
    const sys = src.system || {};
    const source = normalizeSource(sys.source);

    // Map class skills
    const classSkillIds = [];
    if (sys.csk) {
        for (const [key, val] of Object.entries(sys.csk)) {
            if (val) classSkillIds.push(key);
        }
    }

    // Map proficiencies
    const proficiencies = {
        armor: {},
        weapon: {}
    };
    if (sys.proficiencies) {
        if (sys.proficiencies.armor) {
            for (const [key, val] of Object.entries(sys.proficiencies.armor)) {
                if (val) proficiencies.armor[key] = true;
            }
        }
        if (sys.proficiencies.weapon) {
            for (const [key, val] of Object.entries(sys.proficiencies.weapon)) {
                if (val) proficiencies.weapon[key] = true;
            }
        }
    }

    return {
        id: src._id,
        name: src.name,
        kas: sys.kas || '',           // Key Ability Score
        hp: (sys.hp && sys.hp.value) || 0,
        sp: (sys.sp && sys.sp.value) || 0,
        skillRanks: (sys.skillRanks && sys.skillRanks.value) || 4,
        bab: sys.bab || 'moderate',   // 'full' or 'moderate'
        fort: sys.fort || 'slow',     // 'fast' or 'slow'
        ref: sys.ref || 'slow',
        will: sys.will || 'slow',
        isCaster: sys.isCaster || false,
        spellAbility: sys.spellAbility || '',
        classSkills: classSkillIds,
        proficiencies: proficiencies,
        description: cleanText(sys.description ? sys.description.value : ''),
        source: source,
        img: src.img || ''
    };
}

function mapTheme(src) {
    const sys = src.system || {};
    const source = normalizeSource(sys.source);

    const abilityMod = sys.abilityMod || {};

    return {
        id: src._id,
        name: src.name,
        abilityMod: {
            ability: abilityMod.ability || '',
            value: abilityMod.mod || 1
        },
        skill: sys.skill || '',
        description: cleanText(sys.description ? sys.description.value : ''),
        source: source,
        img: src.img || ''
    };
}

function mapFeat(src) {
    const sys = src.system || {};
    const source = normalizeSource(sys.source);
    const details = sys.details || {};

    // Determine the category
    let category = 'feat';
    if (details.category === 'classFeature') category = 'classFeature';
    else if (details.category === 'speciesFeature') category = 'racialFeature';
    else if (details.category === 'themeFeature') category = 'themeFeature';

    // Extract modifiers
    const modifiers = (sys.modifiers || []).map(mod => ({
        name: mod.name || '',
        type: mod.type || 'untyped',
        effectType: mod.effectType || '',
        modifier: mod.modifier || '0',
        modifierType: mod.modifierType || 'constant',
        enabled: mod.enabled !== false,
        valueAffected: mod.valueAffected || '',
        notes: mod.notes || ''
    }));

    return {
        id: src._id,
        name: src.name,
        category: category,
        isCombat: details.combat || false,
        requirements: sys.requirements || '',
        description: cleanText(sys.description ? sys.description.value : ''),
        modifiers: modifiers,
        source: source,
        img: src.img || ''
    };
}

// --- MAIN IMPORT ---

function importRuleset() {
    console.log('=== Importing Starfinder Ruleset ===\n');

    // Import Races
    console.log('Importing Races...');
    const rawRaces = readJsonFilesFromDir('races');
    const races = rawRaces.map(mapRace).sort((a, b) => a.name.localeCompare(b.name));
    console.log(`  Found ${races.length} races`);

    // Import Classes
    console.log('Importing Classes...');
    const rawClasses = readJsonFilesFromDir('classes');
    const classes = rawClasses.map(mapClass).sort((a, b) => a.name.localeCompare(b.name));
    console.log(`  Found ${classes.length} classes`);

    // Import Themes
    console.log('Importing Themes...');
    const rawThemes = readJsonFilesFromDir('themes');
    const themes = rawThemes.map(mapTheme).sort((a, b) => a.name.localeCompare(b.name));
    console.log(`  Found ${themes.length} themes`);

    // Import Feats (general feats only from feats/ dir)
    console.log('Importing Feats...');
    const rawFeats = readJsonFilesFromDir('feats');
    const safeSort = (a, b) => (a.name || '').localeCompare(b.name || '');
    const feats = rawFeats.map(mapFeat).filter(f => f.name).sort(safeSort);
    console.log(`  Found ${feats.length} feats`);

    // Import Class Features
    console.log('Importing Class Features...');
    const rawClassFeatures = readJsonFilesFromDir('class-features');
    const classFeatures = rawClassFeatures.map(mapFeat).filter(f => f.name).sort(safeSort);
    console.log(`  Found ${classFeatures.length} class features`);

    // Import Racial Features
    console.log('Importing Racial Features...');
    const rawRacialFeatures = readJsonFilesFromDir('racial-features');
    const racialFeatures = rawRacialFeatures.map(mapFeat).filter(f => f.name).sort(safeSort);
    console.log(`  Found ${racialFeatures.length} racial features`);

    // Import Theme Features
    console.log('Importing Theme Features...');
    const rawThemeFeatures = readJsonFilesFromDir('theme-features');
    const themeFeatures = rawThemeFeatures.map(mapFeat).filter(f => f.name).sort(safeSort);
    console.log(`  Found ${themeFeatures.length} theme features`);

    // Collect all unique sources
    const allSourceCodes = new Set();
    const addSources = (arr) => arr.forEach(item => {
        if (item.source && item.source.code) allSourceCodes.add(item.source.code);
    });
    addSources(races);
    addSources(classes);
    addSources(themes);
    addSources(feats);
    addSources(classFeatures);
    addSources(racialFeatures);
    addSources(themeFeatures);

    const sources = Array.from(allSourceCodes).sort().map(code => ({
        code,
        name: SOURCE_FULL_NAMES[code] || code
    }));

    console.log(`\nFound ${sources.length} unique sources:`);
    sources.forEach(s => console.log(`  ${s.code} = ${s.name}`));

    // Build output
    const ruleset = {
        _meta: {
            importedAt: new Date().toISOString(),
            version: '1.0',
            sourceCount: sources.length
        },
        sources,
        races,
        classes,
        themes,
        feats,
        classFeatures,
        racialFeatures,
        themeFeatures
    };

    // Write output
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(ruleset, null, 2));

    const fileSizeMB = (fs.statSync(OUTPUT_FILE).size / (1024 * 1024)).toFixed(2);
    console.log(`\n=== Import Complete ===`);
    console.log(`Output: ${OUTPUT_FILE} (${fileSizeMB} MB)`);
    console.log(`Races: ${races.length}, Classes: ${classes.length}, Themes: ${themes.length}`);
    console.log(`Feats: ${feats.length}, Class Features: ${classFeatures.length}`);
    console.log(`Racial Features: ${racialFeatures.length}, Theme Features: ${themeFeatures.length}`);
}

importRuleset();
