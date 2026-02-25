const fs = require('fs');
const path = require('path');
const config = require('./config');

const DATA_DIR = path.join(config.CAMPAIGN_DIR, config.DATA_SUBDIR);
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const itemsFilePath = path.join(DATA_DIR, 'items.json');
const sourceDir = path.join(__dirname, 'REFERENCE', 'foundryvtt-starfinder-development', 'src', 'items', 'equipment');

// Helper to read existing items
function getExistingItems() {
    if (fs.existsSync(itemsFilePath)) {
        const data = fs.readFileSync(itemsFilePath, 'utf8');
        try {
            return JSON.parse(data);
        } catch (e) {
            console.error("Error parsing items.json:", e);
            return [];
        }
    }
    return [];
}

// Helper to clean text from Foundry formatting
function cleanText(text) {
    if (!text) return '';
    // Remove @UUID[...] {Text} -> Text
    text = text.replace(/@UUID\[[^\]]+\]\{([^}]+)\}/g, '$1');
    text = text.replace(/@Compendium\[[^\]]+\]\{([^}]+)\}/g, '$1');
    text = text.replace(/@Item\[[^\]]+\]\{([^}]+)\}/g, '$1');
    // Replace @abilities.str.mod -> STR
    text = text.replace(/@abilities\.(\w+)\.mod/g, (match, p1) => p1.toUpperCase());
    return text;
}

// Helper to map FoundryVTT item to our structure
function mapItem(sourceItem) {
    const system = sourceItem.system || {};
    
    let category = 'Equipment';
    if (sourceItem.type === 'weapon') category = 'Weapon';
    else if (sourceItem.type === 'equipment' && system.armor && system.armor.type) category = 'Armor';
    else if (sourceItem.type === 'technological') category = 'Technological';
    else if (sourceItem.type === 'consumable') category = 'Consumable';
    else if (sourceItem.type === 'goods') category = 'Goods';
    else if (sourceItem.type === 'fusion') category = 'Fusion';
    else if (sourceItem.type === 'upgrade') category = 'Upgrade';
    else if (sourceItem.type === 'augmentation') category = 'Augmentation';
    else if (sourceItem.type === 'magic') category = 'Magic';
    
    // Extract core stats
    const level = system.level || 0;
    const price = system.price || 0;
    const bulk = system.bulk || '-';

    // Construct stats string (Legacy support + quick view)
    let stats = [];
    stats.push(`Lvl ${level}`);
    stats.push(`${price} Cr`);
    
    // Extract detailed stats based on category
    let details = {
        bulk: bulk
    };

    // Clean Description
    let description = system.description ? system.description.value : '';
    description = cleanText(description);

    if (category === 'Weapon') {
        if (system.damage && system.damage.parts && system.damage.parts.length > 0) {
            details.damage = system.damage.parts.map(part => {
                // Handle Object format (New Starfinder JSON)
                if (typeof part === 'object' && !Array.isArray(part)) {
                    const types = [];
                    if (part.types) {
                        for (const [t, active] of Object.entries(part.types)) {
                            if (active) types.push(t);
                        }
                    }
                    return `${part.formula} ${types.join('/')}`;
                } 
                // Handle Array format (Old/Generic Foundry)
                else if (Array.isArray(part)) {
                    return `${part[0]} ${part[1]}`;
                }
                return '';
            }).join(' + ');
            stats.push(`Dmg: ${details.damage}`);
        }
        
        if (system.range && system.range.value) {
            details.range = `${system.range.value} ${system.range.units}`;
            stats.push(`Rng: ${details.range}`);
        }
        
        if (system.capacity) {
            details.capacity = system.capacity.max;
            details.usage = system.usage ? system.usage.value : 1;
            details.ammoType = system.ammunitionType || 'charge';
            stats.push(`Cap: ${details.capacity}`);
        }
        
        // Critical
        let critParts = [];
        if (system.critical) {
            if (system.critical.effect) {
                critParts.push(system.critical.effect);
            }
            if (system.critical.parts && system.critical.parts.length > 0) {
                const parts = system.critical.parts.map(part => {
                     if (typeof part === 'object' && !Array.isArray(part)) {
                        const types = [];
                        if (part.types) {
                            for (const [t, active] of Object.entries(part.types)) {
                                if (active) types.push(t);
                            }
                        }
                        return `${part.formula} ${types.join('/')}`;
                    } else if (Array.isArray(part)) {
                        return `${part[0]} ${part[1]}`;
                    }
                    return '';
                });
                critParts = critParts.concat(parts);
            }
        }
        if (critParts.length > 0) {
            details.critical = critParts.join(', ');
        }

        if (system.special) {
            details.special = system.special;
        }
        details.weaponType = system.weaponType || 'unknown';
        details.ability = system.ability || '';
        
        const actionTypeMap = {
            'mwak': 'Melee',
            'rwak': 'Ranged',
            'msak': 'Melee Spell',
            'rsak': 'Ranged Spell',
            'save': 'Save',
            'heal': 'Heal',
            'util': 'Utility'
        };
        details.actionType = actionTypeMap[system.actionType] || system.actionType || '';
    } else if (category === 'Armor') {
        if (system.armor) {
            details.eac = system.armor.eac;
            details.kac = system.armor.kac;
            details.maxDex = system.armor.dex;
            details.acp = system.armor.acp;
            details.upgradeSlots = system.armor.upgradeSlots;
            
            stats.push(`EAC: ${details.eac}`);
            stats.push(`KAC: ${details.kac}`);
        }
    } else if (category === 'Consumable') {
        details.consumableType = system.consumableType;
    }

    // Recursively clean details object
    function cleanObject(obj) {
        for (const key in obj) {
            if (typeof obj[key] === 'string') {
                obj[key] = cleanText(obj[key]);
            } else if (typeof obj[key] === 'object' && obj[key] !== null) {
                cleanObject(obj[key]);
            }
        }
    }
    cleanObject(details);

    return {
        id: sourceItem._id,
        name: sourceItem.name,
        category: category,
        level: level,
        price: price,
        source: system.source || '',
        details: details,
        description: description,
        stats: stats.join(', '),
        image: sourceItem.img
    };
}

function importItems() {
    console.log("Starting import...");
    // Always overwrite for now to ensure new fields are populated
    // But we want to keep manual items if any? 
    // The user said "hold them all in the db", implying the file source is the truth.
    // But I might have added manual items.
    // Let's read existing, filter out the ones that look like imports (have _id style?), or just rebuild.
    // To be safe and clean, I'll rebuild the list from the source files, 
    // but I should preserve any items that are NOT in the source files (manual adds).
    
    const existingItems = getExistingItems();
    const manualItems = existingItems.filter(i => !i.id || i.id.length < 10 || i.id.startsWith('manual_')); 
    // Foundry IDs are usually 16 chars. Manual ones might be different.
    // Actually, let's just re-import everything from source. 
    // If I want to keep manual items, I should check if they exist in source.
    
    const newItems = [];
    const sourceIds = new Set();

    if (!fs.existsSync(sourceDir)) {
        console.error(`Source directory not found: ${sourceDir}`);
        return;
    }

    const files = fs.readdirSync(sourceDir);
    let count = 0;

    files.forEach(file => {
        if (file.endsWith('.json')) {
            const filePath = path.join(sourceDir, file);
            try {
                const fileContent = fs.readFileSync(filePath, 'utf8');
                const sourceItem = JSON.parse(fileContent);
                const newItem = mapItem(sourceItem);
                newItems.push(newItem);
                sourceIds.add(newItem.id);
                count++;
            } catch (e) {
                console.error(`Error processing ${file}:`, e);
            }
        }
    });

    // Append manual items that are not in source
    existingItems.forEach(item => {
        if (!sourceIds.has(item.id)) {
            newItems.push(item);
        }
    });

    fs.writeFileSync(itemsFilePath, JSON.stringify(newItems, null, 2));
    console.log(`Import complete. Processed ${count} source items. Total items: ${newItems.length}`);
}

importItems();
