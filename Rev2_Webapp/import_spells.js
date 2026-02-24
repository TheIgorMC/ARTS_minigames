const fs = require('fs');
const path = require('path');

const spellsFilePath = path.join(__dirname, 'data', 'spells.json');
const sourceDir = path.join(__dirname, 'REFERENCE', 'foundryvtt-starfinder-development', 'src', 'items', 'spells');

// Clean Foundry-formatted text
function cleanText(text) {
    if (!text) return '';
    text = text.replace(/@UUID\[[^\]]+\]\{([^}]+)\}/g, '$1');
    text = text.replace(/@Compendium\[[^\]]+\]\{([^}]+)\}/g, '$1');
    text = text.replace(/@Item\[[^\]]+\]\{([^}]+)\}/g, '$1');
    text = text.replace(/@abilities\.(\w+)\.mod/g, (m, p) => p.toUpperCase());
    return text;
}

// Map school codes to full names
const SCHOOL_NAMES = {
    abj: 'Abjuration', con: 'Conjuration', div: 'Divination', enc: 'Enchantment',
    evo: 'Evocation', ill: 'Illusion', nec: 'Necromancy', trs: 'Transmutation', uni: 'Universal'
};

// Map class codes to full names
const CLASS_NAMES = {
    myst: 'Mystic', tech: 'Technomancer', wysh: 'Witchwarper', precog: 'Precog'
};

// Map range unit codes
const RANGE_UNITS = {
    close: 'Close (25 ft. + 5 ft./2 levels)',
    medium: 'Medium (100 ft. + 10 ft./level)',
    long: 'Long (400 ft. + 40 ft./level)',
    touch: 'Touch', personal: 'Personal', planetary: 'Planetary',
    system: 'System-wide', plane: 'Plane', unlimited: 'Unlimited',
    ft: 'ft.', mi: 'mi.', none: '', other: ''
};

// Map save types
const SAVE_TYPES = { fort: 'Fortitude', reflex: 'Reflex', will: 'Will' };

// Map duration units
const DURATION_UNITS = {
    instantaneous: 'Instantaneous', permanent: 'Permanent',
    round: 'round', minute: 'minute', hour: 'hour', day: 'day',
    concentration: 'Concentration', special: 'Special', '': ''
};

function mapSpell(src) {
    const sys = src.system || {};

    // Allowed classes: { myst: true, tech: false, ... } → ['Mystic']
    const classes = [];
    if (sys.allowedClasses) {
        for (const [code, allowed] of Object.entries(sys.allowedClasses)) {
            if (allowed && CLASS_NAMES[code]) classes.push(CLASS_NAMES[code]);
        }
    }

    // Range string
    let range = '';
    if (sys.range) {
        if (sys.range.value) {
            range = sys.range.value + ' ' + (RANGE_UNITS[sys.range.units] || sys.range.units || '');
        } else {
            range = RANGE_UNITS[sys.range.units] || sys.range.units || '';
        }
    }

    // Duration string
    let duration = '';
    if (sys.duration) {
        const val = sys.duration.value;
        const unit = DURATION_UNITS[sys.duration.units] || sys.duration.units || '';
        if (val && unit) duration = `${val} ${unit}${parseInt(val) > 1 ? 's' : ''}`;
        else if (unit) duration = unit;
        else if (val) duration = val;
    }

    // Save string
    let save = '';
    if (sys.save && sys.save.type) {
        save = SAVE_TYPES[sys.save.type] || sys.save.type;
        if (sys.save.descriptor) save += ` (${sys.save.descriptor})`;
    }

    // Area/target/effect
    let target = '';
    if (sys.target && sys.target.value) target = sys.target.value;
    let area = '';
    if (sys.area && sys.area.value) area = `${sys.area.value} ${sys.area.units === 'ft' ? 'ft.' : sys.area.units || ''}`.trim();
    else if (sys.area && sys.area.shape) area = sys.area.shape;

    // Damage
    let damage = '';
    if (sys.damage && sys.damage.parts && sys.damage.parts.length > 0) {
        damage = sys.damage.parts.map(part => {
            if (typeof part === 'object' && !Array.isArray(part)) {
                const types = part.types ? Object.entries(part.types).filter(([, v]) => v).map(([k]) => k).join('/') : '';
                return `${part.formula || ''} ${types}`.trim();
            } else if (Array.isArray(part)) {
                return `${part[0]} ${part[1] || ''}`.trim();
            }
            return '';
        }).filter(Boolean).join(' + ');
    }

    // Description
    let description = sys.description ? sys.description.value : '';
    description = cleanText(description);

    // Source
    const source = sys.source || '';

    return {
        id: src._id,
        name: src.name,
        level: sys.level || 0,
        school: SCHOOL_NAMES[sys.school] || sys.school || '',
        schoolCode: sys.school || '',
        classes: classes,
        castingTime: sys.activation ? `${sys.activation.cost || 1} ${sys.activation.type || 'action'}` : '',
        range: range.trim(),
        area: area,
        target: target,
        duration: duration.trim(),
        dismissible: sys.dismissible || false,
        save: save,
        sr: sys.sr || false,
        damage: damage,
        actionType: sys.actionType || '',
        concentration: sys.concentration || false,
        description: description,
        source: source,
        image: src.img || ''
    };
}

function importSpells() {
    console.log('Starting spell import...');

    if (!fs.existsSync(sourceDir)) {
        console.error(`Source directory not found: ${sourceDir}`);
        return;
    }

    const files = fs.readdirSync(sourceDir).filter(f => f.endsWith('.json'));
    const spells = [];
    let count = 0;

    files.forEach(file => {
        try {
            const raw = fs.readFileSync(path.join(sourceDir, file), 'utf8');
            const src = JSON.parse(raw);
            spells.push(mapSpell(src));
            count++;
        } catch (e) {
            console.error(`Error processing ${file}:`, e.message);
        }
    });

    // Sort by level, then name
    spells.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));

    fs.writeFileSync(spellsFilePath, JSON.stringify(spells, null, 2));
    console.log(`Spell import complete. Processed ${count} spells → ${spellsFilePath}`);

    // Stats
    const byLevel = {};
    const bySchool = {};
    const byClass = {};
    spells.forEach(s => {
        byLevel[s.level] = (byLevel[s.level] || 0) + 1;
        bySchool[s.school] = (bySchool[s.school] || 0) + 1;
        s.classes.forEach(c => byClass[c] = (byClass[c] || 0) + 1);
    });
    console.log('By level:', byLevel);
    console.log('By school:', bySchool);
    console.log('By class:', byClass);
}

importSpells();
