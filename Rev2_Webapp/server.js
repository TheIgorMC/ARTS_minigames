const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const config = require('./config');

app.use(cors());

// ─── Path Resolution ─────────────────────────────────
// All campaign data lives under one folder (campaign/)
const CAMPAIGN_DIR = config.CAMPAIGN_DIR;
const DATA_DIR = path.join(CAMPAIGN_DIR, config.DATA_SUBDIR);
const MEDIA_DIR = path.join(CAMPAIGN_DIR, config.MEDIA_SUBDIR);

// Bootstrap: if campaign/ doesn't exist, create from defaults
function bootstrapCampaign() {
    if (!fs.existsSync(CAMPAIGN_DIR)) {
        console.log('First run detected — creating campaign folder from defaults...');
        fs.mkdirSync(CAMPAIGN_DIR, { recursive: true });
    }
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(MEDIA_DIR)) fs.mkdirSync(MEDIA_DIR, { recursive: true });

    // Copy default data files if they don't exist in campaign/data/
    const defaultsDir = config.DEFAULTS_DIR;
    if (fs.existsSync(defaultsDir)) {
        const defaultDataDir = path.join(defaultsDir, 'data');
        if (fs.existsSync(defaultDataDir)) {
            fs.readdirSync(defaultDataDir).forEach(file => {
                const dest = path.join(DATA_DIR, file);
                if (!fs.existsSync(dest)) {
                    fs.copyFileSync(path.join(defaultDataDir, file), dest);
                    console.log(`  Copied default: ${file}`);
                }
            });
        }
        // Copy default media structure
        const defaultMediaDir = path.join(defaultsDir, 'media');
        if (fs.existsSync(defaultMediaDir)) {
            copyDirRecursive(defaultMediaDir, MEDIA_DIR);
        }
    }
}

function copyDirRecursive(src, dest) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach(item => {
        const srcPath = path.join(src, item);
        const destPath = path.join(dest, item);
        if (fs.statSync(srcPath).isDirectory()) {
            copyDirRecursive(srcPath, destPath);
        } else if (!fs.existsSync(destPath)) {
            fs.copyFileSync(srcPath, destPath);
            console.log(`  Copied default: ${item}`);
        }
    });
}

bootstrapCampaign();

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
// Serve media from campaign/media/ at /media URL
app.use('/media', express.static(MEDIA_DIR));

// Redirects per comodità
app.get('/mood', (req, res) => res.sendFile(path.join(__dirname, 'public/mood.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));
app.get('/player', (req, res) => res.sendFile(path.join(__dirname, 'public/player.html')));

// Carica i dati JSON
let objects = [];
let characters = [];
let items = [];
let scenes = [];
let ruleset = null; // Starfinder ruleset (races, classes, themes, feats)
let spells = [];   // Starfinder spell database
let tableState = {
    activeObjects: [] // { instanceId, ...objData, x, y }
};
let hackingState = {
    active: false,
    password: '',
    dc: 15,
    revealedIndices: [], // Array of indices [0, 2, 5]
    attempts: 0
};
let moodState = {
    imageUrl: ''
};
let chatHistory = [];
let timeState = {
    year: 320,
    day: 1,
    hour: 12,
    minute: 0,
    scrambled: false,
    textScrambled: false
};
let roleplayState = {
    active: false,
    background: '',
    characters: [] // Array of { id, name, image, x, y, scale }
};
let gmIdentities = ['GM']; // Default identity
let currentSceneId = null; // Track currently loaded scene for autosave
let conversations = []; // { id, name, type: 'group'|'dm', participants: [] }
let quests = []; // { id, name, description, active }
let shops = []; // { id, name, location, description, categories[], stock: [{itemId, qty, priceOverride?}], isOpen }
let campaignSettings = {
    allowedSources: [] // Empty = all sources allowed. Array of codes like ['CRB','AR','COM']
};
let levelupPending = new Set(); // Character IDs that are allowed to level up
let shopSessions = {}; // { charId: shopId } - maps which shop a player has open

// ─── BATTLEMAP STATE ──────────────────────────────────────────────────────────
let battlemapState = {
    active: false,          // Is battlemap projected to the display?
    mapUrl: '',             // /media/... URL of current map image
    gridType: 'square',     // 'square' | 'hex-pointy'
    gridCols: 20,
    gridRows: 12,
    gridColor: '#ffffff',
    gridOpacity: 0.3,
    physicalCols: 20,       // Physical table viewport size (in map grid cells)
    physicalRows: 12,
    tableOffsetX: 0,        // Where the physical table viewport starts on the map (col)
    tableOffsetY: 0,        // Where the physical table viewport starts on the map (row)
    tokens: [],             // Array of token objects (see admin for schema)
    initiativeOrder: [],    // [tokenId, ...] sorted by initiative
    initiativeCurrent: -1, // Index of current actor (-1 = not started)
    fowEnabled: false,
    fowCells: {},           // 'col,row' -> 'visible'|'explored' (missing = hidden)
    geo: { walls: [], doors: [], lights: [] }, // Geometry: walls, doors, lights
};

// --- STARFINDER PROGRESSION TABLES ---
const SF_BAB = {
    full:     [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20],
    moderate: [0,0,1,2,3,3,4,5,6,6,7,8,9,9,10,11,12,12,13,14,15]
};
const SF_SAVES = {
    fast: [0,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12],
    slow: [0,0,0,1,1,1,2,2,2,3,3,3,4,4,4,5,5,5,6,6,6]
};
const SF_ABILITY_INCREASE_LEVELS = [5, 10, 15, 20];
const SF_FEAT_LEVELS = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
const SF_THEME_BENEFIT_LEVELS = [6, 12, 18];
// Spells known: index = class level, value = [cantrips, 1st, 2nd, 3rd, 4th, 5th, 6th]
const SF_SPELLS_KNOWN = [
    [0,0,0,0,0,0,0],[4,2,0,0,0,0,0],[5,3,0,0,0,0,0],[6,4,0,0,0,0,0],
    [6,4,2,0,0,0,0],[6,4,3,0,0,0,0],[6,4,4,0,0,0,0],[6,5,4,2,0,0,0],
    [6,5,4,3,0,0,0],[6,5,4,4,0,0,0],[6,5,5,4,2,0,0],[6,6,5,4,3,0,0],
    [6,6,5,4,4,0,0],[6,6,5,5,4,2,0],[6,6,6,5,4,3,0],[6,6,6,5,4,4,0],
    [6,6,6,5,5,4,2],[6,6,6,6,5,4,3],[6,6,6,6,5,4,4],[6,6,6,6,5,5,4],
    [6,6,6,6,6,5,5]
];
// Spells per day: index = class level, value = [1st, 2nd, 3rd, 4th, 5th, 6th]
const SF_SPELLS_PER_DAY = [
    [0,0,0,0,0,0],[2,0,0,0,0,0],[2,0,0,0,0,0],[3,0,0,0,0,0],
    [3,2,0,0,0,0],[4,2,0,0,0,0],[4,3,0,0,0,0],[4,3,2,0,0,0],
    [4,4,2,0,0,0],[5,4,3,0,0,0],[5,4,3,2,0,0],[5,4,4,2,0,0],
    [5,5,4,3,0,0],[5,5,4,3,2,0],[5,5,4,4,2,0],[5,5,5,4,3,0],
    [5,5,5,4,3,2],[5,5,5,4,4,2],[5,5,5,5,4,3],[5,5,5,5,5,3],
    [5,5,5,5,5,4]
];

// --- PERSISTENCE ---
const STATUS_FILE = path.join(DATA_DIR, 'status.json');
const CHAT_LOG_FILE = path.join(DATA_DIR, 'chat_logs.txt');

function saveStatus() {
    const status = {
        time: timeState,
        mood: moodState,
        roleplay: roleplayState,
        identities: gmIdentities,
        conversations: conversations,
        campaignSettings: campaignSettings,
        battlemap: battlemapState
    };
    fs.writeFileSync(STATUS_FILE, JSON.stringify(status, null, 2));
}

function loadStatus() {
    if (fs.existsSync(STATUS_FILE)) {
        try {
            const status = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'));
            if (status.time) timeState = status.time;
            if (status.mood) moodState = status.mood;
            if (status.roleplay) roleplayState = status.roleplay;
            if (status.identities) gmIdentities = status.identities;
            if (status.conversations) conversations = status.conversations;
            if (status.campaignSettings) campaignSettings = status.campaignSettings;
            if (status.battlemap) battlemapState = status.battlemap;
            console.log('Status loaded:', status);
        } catch (e) {
            console.error('Error loading status:', e);
        }
    }
}

function saveChatLog(msg) {
    const logLine = JSON.stringify(msg) + '\n';
    fs.appendFileSync(CHAT_LOG_FILE, logLine);
}

function loadChatLogs() {
    if (fs.existsSync(CHAT_LOG_FILE)) {
        try {
            const data = fs.readFileSync(CHAT_LOG_FILE, 'utf8');
            const lines = data.split('\n').filter(line => line.trim() !== '');
            chatHistory = lines.map(line => {
                try {
                    return JSON.parse(line);
                } catch (e) {
                    return null;
                }
            }).filter(msg => msg !== null);
            // Keep only last 100 in memory for quick access, but file has all
            if (chatHistory.length > 100) {
                chatHistory = chatHistory.slice(-100);
            }
            console.log(`Loaded ${chatHistory.length} chat messages.`);
        } catch (e) {
            console.error('Error loading chat logs:', e);
        }
    }
}

// Load on startup
loadStatus();
loadChatLogs();

// Time Ticker (Every 60s real time = 1 min game time)
setInterval(() => {
    if (!timeState.scrambled) {
        timeState.minute++;
        if (timeState.minute >= 60) {
            timeState.minute = 0;
            timeState.hour++;
            if (timeState.hour >= 24) {
                timeState.hour = 0;
                timeState.day++;
            }
        }
        io.emit('time_update', timeState);
        saveStatus(); // Save every minute
    }
}, 60000);

// Helper per leggere i file media (ricorsivo)
function getMediaFiles(dir = '', fileList = []) {
    const mediaDir = MEDIA_DIR;
    const currentDir = path.join(mediaDir, dir);
    
    if (!fs.existsSync(currentDir)) return [];
    
    const files = fs.readdirSync(currentDir);
    
    files.forEach(file => {
        const filePath = path.join(currentDir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
            getMediaFiles(path.join(dir, file), fileList);
        } else {
            if (['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4'].includes(path.extname(file).toLowerCase())) {
                // Usa path relativo normalizzato per URL (slash in avanti)
                const relativePath = path.join(dir, file).replace(/\\/g, '/');
                // Encode parts to ensure URL safety (especially for brackets)
                const urlPath = relativePath.split('/').map(encodeURIComponent).join('/');
                
                const fileName = path.basename(file);
                
                // Determine type based on naming scheme
                let type = 'item';
                if (fileName.startsWith('[BG]')) type = 'background';
                else if (fileName.startsWith('[MOOD]')) type = 'mood';
                else {
                    // Check any parent folder for [BATTLE] tag
                    const folderParts = dir.replace(/\\/g, '/').split('/');
                    if (folderParts.some(p => p.startsWith('[BATTLE]'))) type = 'battlemap';
                }
                
                fileList.push({
                    path: urlPath, // Use encoded path for URL
                    name: fileName,
                    folder: dir.replace(/\\/g, '/'),
                    type: type
                });
            }
        }
    });
    
    return fileList;
}

function loadScenes() {
    const mediaDir = MEDIA_DIR;
    if (!fs.existsSync(mediaDir)) return [];
    
    const loadedScenes = [];
    const dirs = fs.readdirSync(mediaDir);
    
    dirs.forEach(dir => {
        const dirPath = path.join(mediaDir, dir);
        if (fs.statSync(dirPath).isDirectory() && dir.startsWith('[')) {
            const sceneFile = path.join(dirPath, 'scene.json');
            if (fs.existsSync(sceneFile)) {
                try {
                    const sceneData = JSON.parse(fs.readFileSync(sceneFile));
                    // Ensure ID matches folder name logic if needed, or trust file
                    sceneData.id = dir; // Use folder name as ID for simplicity
                    sceneData.name = dir.replace(/^\[.*?\]\s*/, ''); // Clean name
                    loadedScenes.push(sceneData);
                } catch (e) {
                    console.error(`Error loading scene from ${dir}:`, e);
                }
            } else {
                // Create empty scene entry for folder if no json exists
                loadedScenes.push({
                    id: dir,
                    name: dir.replace(/^\[.*?\]\s*/, ''),
                    objects: [],
                    mood: ''
                });
            }
        }
    });
    return loadedScenes;
}

function loadData() {
    try {
        // Ensure [00]Global exists
        const globalDir = path.join(MEDIA_DIR, '[00]Global');
        if (!fs.existsSync(globalDir)) {
            fs.mkdirSync(globalDir, { recursive: true });
        }

        objects = fs.existsSync(path.join(DATA_DIR, 'objects.json'))
            ? JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'objects.json')))
            : [];
        characters = fs.existsSync(path.join(DATA_DIR, 'characters.json'))
            ? JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'characters.json')))
            : [];
        if (fs.existsSync(path.join(DATA_DIR, 'items.json'))) {
            items = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'items.json')));
        } else {
            items = [];
        }

        if (fs.existsSync(path.join(DATA_DIR, 'quests.json'))) {
            quests = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'quests.json')));
        } else {
            quests = [];
        }

        // Load Starfinder Ruleset
        if (fs.existsSync(path.join(DATA_DIR, 'ruleset.json'))) {
            ruleset = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ruleset.json'), 'utf8'));
            console.log(`Ruleset loaded: ${ruleset.races?.length || 0} races, ${ruleset.classes?.length || 0} classes, ${ruleset.themes?.length || 0} themes, ${ruleset.feats?.length || 0} feats, ${ruleset.sources?.length || 0} sources`);
        } else {
            console.warn('WARNING: ruleset.json not found!');
            ruleset = { sources: [], races: [], classes: [], themes: [], feats: [] };
        }
        
        // Load spell database
        if (fs.existsSync(path.join(DATA_DIR, 'spells.json'))) {
            spells = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'spells.json'), 'utf8'));
            console.log(`Spells loaded: ${spells.length} spells`);
        } else {
            console.warn('WARNING: spells.json not found! Run: node import_spells.js');
            spells = [];
        }

        // Load ignored list
        let ignored = [];
        if (fs.existsSync(path.join(DATA_DIR, 'ignored.json'))) {
            ignored = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ignored.json')));
        }

        // Load shops
        if (fs.existsSync(path.join(DATA_DIR, 'shops.json'))) {
            shops = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'shops.json'), 'utf8'));
            console.log(`Shops loaded: ${shops.length} shops`);
        } else {
            shops = [];
        }

        // Load scenes from media folders
        scenes = loadScenes();
        
        // Sync objects with media files
        const allMedia = getMediaFiles();
        let objectsChanged = false;
        
        allMedia.forEach(media => {
            // Generate a stable ID based on the file path
            const id = media.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
            
            // Check if ignored
            if (ignored.includes(id)) return;

            // Check if object exists
            const existing = objects.find(o => o.id === id);
            
            if (!existing) {
                // Create new object
                const newObj = {
                    id: id,
                    name: media.name.replace(/\[.*?\]\s*/g, '').replace(/\.[^/.]+$/, ""), // Remove tags and extension
                    category: media.folder.includes('[00]Global') ? 'Global' : media.folder.replace(/^\[.*?\]\s*/, ''),
                    sceneId: media.folder, // Link to folder
                    type: media.type,
                    image: '/media/' + media.path,
                    width: (media.type === 'background' || media.type === 'mood') ? 1920 : 100,
                    height: (media.type === 'background' || media.type === 'mood') ? 1080 : 100,
                    draggable: (media.type !== 'background' && media.type !== 'mood'),
                    description: ''
                };
                objects.push(newObj);
                objectsChanged = true;
                console.log(`Auto-added object: ${newObj.name} (${newObj.type})`);
            } else {
                // Update existing object path/category if changed (e.g. folder rename)
                const newPath = '/media/' + media.path;
                const newSceneId = media.folder;
                const newCategory = media.folder.includes('[00]Global') ? 'Global' : media.folder.replace(/^\[.*?\]\s*/, '');
                
                if (existing.image !== newPath || existing.sceneId !== newSceneId) {
                    existing.image = newPath;
                    existing.sceneId = newSceneId;
                    existing.category = newCategory;
                    objectsChanged = true;
                    console.log(`Updated object path: ${existing.name} -> ${newSceneId}`);
                }
            }
        });
        
        if (objectsChanged) {
            saveData();
        }

        // Set default mood if available
        const idleMood = allMedia.find(m => m.folder.includes('[00]Global') && m.name.startsWith('[MOOD]Idle'));
        if (idleMood) {
            moodState.imageUrl = '/media/' + idleMood.path;
        }

        console.log('Dati caricati correttamente. Scene trovate:', scenes.length);
    } catch (e) {
        console.error('Errore caricamento dati:', e);
    }
}
loadData();

function saveData() {
    try {
        fs.writeFileSync(path.join(DATA_DIR, 'objects.json'), JSON.stringify(objects, null, 2));
        fs.writeFileSync(path.join(DATA_DIR, 'characters.json'), JSON.stringify(characters, null, 2));
        fs.writeFileSync(path.join(DATA_DIR, 'items.json'), JSON.stringify(items, null, 2));
        fs.writeFileSync(path.join(DATA_DIR, 'quests.json'), JSON.stringify(quests, null, 2));
        fs.writeFileSync(path.join(DATA_DIR, 'shops.json'), JSON.stringify(shops, null, 2));
        // Scenes are saved individually now
        console.log('Dati salvati.');
    } catch (e) {
        console.error('Errore salvataggio dati:', e);
    }
}

function saveSceneData(sceneId, data) {
    try {
        const mediaDir = MEDIA_DIR;
        const sceneDir = path.resolve(mediaDir, sceneId);
        
        // Prevent path traversal
        if (!sceneDir.startsWith(mediaDir + path.sep) && sceneDir !== mediaDir) {
            console.error(`Path traversal attempt blocked: ${sceneId}`);
            return;
        }
        
        if (!fs.existsSync(sceneDir)) {
            fs.mkdirSync(sceneDir, { recursive: true });
        }
        
        fs.writeFileSync(path.join(sceneDir, 'scene.json'), JSON.stringify(data, null, 2));
        console.log(`Scene ${sceneId} saved.`);
        
        // Update in-memory scenes
        const idx = scenes.findIndex(s => s.id === sceneId);
        if (idx >= 0) scenes[idx] = data;
        else scenes.push(data);
        
    } catch (e) {
        console.error(`Error saving scene ${sceneId}:`, e);
    }
}

function autosaveCurrentScene() {
    if (!currentSceneId) return;
    
    // Find current scene name to preserve it
    const currentScene = scenes.find(s => s.id === currentSceneId);
    const name = currentScene ? currentScene.name : currentSceneId;

    const sceneData = {
        id: currentSceneId,
        name: name,
        objects: tableState.activeObjects,
        mood: moodState.imageUrl
    };
    
    saveSceneData(currentSceneId, sceneData);
    // We don't emit admin_data_update here to avoid spamming the GM client with full reloads
    // But we might want to notify that save happened?
}

// Gestione connessioni Socket.io
io.on('connection', (socket) => {
    console.log('Un client si è connesso: ' + socket.id);

    // Send initial state to everyone
    socket.emit('roleplay_state_update', roleplayState);
    socket.emit('time_update', timeState);
    socket.emit('chat_history', chatHistory);

    // 1. Identificazione Ruolo (GM, Table, Player)
    socket.on('join', (role) => {
        console.log(`Socket ${socket.id} registrato come: ${role}`);
        socket.join(role);
        
        // Se è il GM, inviagli subito i dati aggiornati
        if (role === 'gm') {
            socket.emit('admin_data_update', { objects, characters, scenes, items, quests, spells });
            socket.emit('media_list_update', getMediaFiles());
            socket.emit('admin_identities_update', gmIdentities);
            socket.emit('conversations_update', conversations);
            // Send ruleset data (sources list is lightweight, full data on demand)
            socket.emit('ruleset_update', {
                sources: ruleset.sources || [],
                races: (ruleset.races || []).map(r => ({ id: r.id, name: r.name, type: r.type, subtype: r.subtype, size: r.size, hp: r.hp, abilityMods: r.abilityMods, description: r.description, source: r.source })),
                classes: (ruleset.classes || []).map(c => ({ id: c.id, name: c.name, kas: c.kas, hp: c.hp, sp: c.sp, skillRanks: c.skillRanks, bab: c.bab, fort: c.fort, ref: c.ref, will: c.will, isCaster: c.isCaster, spellAbility: c.spellAbility, classSkills: c.classSkills, proficiencies: c.proficiencies, description: c.description, source: c.source })),
                themes: (ruleset.themes || []).map(t => ({ id: t.id, name: t.name, abilityMod: t.abilityMod, skill: t.skill, description: t.description, source: t.source })),
                feats: (ruleset.feats || []).map(f => ({ id: f.id, name: f.name, category: f.category, isCombat: f.isCombat, requirements: f.requirements, description: f.description, modifiers: f.modifiers, source: f.source }))
            });
            // Send spell database
            socket.emit('spells_update', spells);
            // Send level-up pending status and shops to GM
            socket.emit('admin_levelup_status', Array.from(levelupPending));
            socket.emit('admin_shops_update', shops);
            socket.emit('campaign_settings_update', campaignSettings);
            socket.emit('battlemap_state', battlemapState);
        }
        // Se è il Tavolo, invia lo stato attuale
        if (role === 'table') {
            socket.emit('table_state_update', tableState);
        }
    });

    // --- ROLEPLAY MODE ---
    socket.on('admin_roleplay_action', (action) => {
        if (action.type === 'update') {
            roleplayState = action.state;
            saveStatus();
            io.emit('roleplay_state_update', roleplayState);
        }
    });

    // --- GM IDENTITIES ---
    socket.on('admin_identity_action', (action) => {
        if (action.type === 'add') {
            if (!gmIdentities.includes(action.name)) {
                gmIdentities.push(action.name);
                saveStatus();
                socket.emit('admin_identities_update', gmIdentities);
            }
        } else if (action.type === 'remove') {
            gmIdentities = gmIdentities.filter(id => id !== action.name);
            saveStatus();
            socket.emit('admin_identities_update', gmIdentities);
        }
    });

    // --- CONVERSATIONS ---
    socket.on('create_conversation', (data) => {
        // data: { name, participants: [] }
        const newConv = {
            id: 'group_' + Date.now(),
            name: data.name,
            type: 'group',
            participants: data.participants
        };
        conversations.push(newConv);
        saveStatus();
        
        // Notify GM
        socket.emit('conversations_update', conversations);
        
        // Notify Players involved
        io.to('player').emit('conversations_update', conversations);
    });

    socket.on('update_conversation', (data) => {
        // data: { id, name, participants: [] }
        const convIndex = conversations.findIndex(c => c.id === data.id);
        if (convIndex !== -1) {
            conversations[convIndex].name = data.name;
            conversations[convIndex].participants = data.participants;
            saveStatus();
            
            // Notify GM
            socket.emit('conversations_update', conversations);
            
            // Notify Players involved
            io.to('player').emit('conversations_update', conversations);
        }
    });

    socket.on('delete_conversation', (data) => {
        // data: { id }
        const convIndex = conversations.findIndex(c => c.id === data.id);
        if (convIndex !== -1) {
            conversations.splice(convIndex, 1);
            saveStatus();
            
            // Notify GM
            socket.emit('conversations_update', conversations);
            
            // Notify Players
            io.to('player').emit('conversations_update', conversations);
        }
    });

    // --- LOGIN PLAYER ---
    socket.on('player_login', (credentials) => {
        const user = characters.find(c => c.username === credentials.username && c.password === credentials.password);
        if (user) {
            console.log(`Login successo per: ${user.name}`);
            socket.join('player'); // Unisciti al canale generico player
            socket.join('player_' + user.id); // Canale privato per questo player
            socket.emit('login_success', user);
            
            // Send items DB + spells DB so player can resolve inventory and spells
            socket.emit('player_items_db', items.map(i => ({ id: i.id, name: i.name, category: i.category, level: i.level, price: i.price, details: i.details, source: i.source })));
            socket.emit('campaign_settings_update', campaignSettings);
            socket.emit('player_spells_db', spells);

            // Send safe character list for Roleplay Mode
            const safeChars = characters.map(c => ({
                id: c.id,
                name: c.name,
                username: c.username,
                class: c.class,
                roles: c.roles
            }));
            socket.emit('player_data_update', safeChars);
            
            socket.emit('conversations_update', conversations);

            // Send level-up availability if pending
            if (levelupPending.has(user.id)) {
                socket.emit('levelup_available', true);
            }
        } else {
            socket.emit('login_error', 'Credenziali non valide');
        }
    });

    // --- GESTIONE DATI (GM) ---
    socket.on('admin_add_object', (newObj) => {
        // Validazione base
        if (!newObj.name || !newObj.image) return;

        // Genera ID se manca
        if (!newObj.id) {
            newObj.id = newObj.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        }

        // Assicurati che l'ID sia unico
        let originalId = newObj.id;
        let counter = 1;
        while (objects.find(o => o.id === newObj.id)) {
            newObj.id = originalId + '_' + counter;
            counter++;
        }

        objects.push(newObj);
        saveData();
        
        socket.emit('admin_data_update', { objects, characters, scenes, items });
        // Log per il GM
        socket.emit('gm_hacking_log', 'Object Created: ' + newObj.name);
    });

    socket.on('admin_delete_object', (id) => {
        const index = objects.findIndex(o => o.id === id);
        if (index !== -1) {
            objects.splice(index, 1);
            
            // Add to ignored list
            let ignored = [];
            if (fs.existsSync(path.join(DATA_DIR, 'ignored.json'))) {
                ignored = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ignored.json')));
            }
            if (!ignored.includes(id)) {
                ignored.push(id);
                fs.writeFileSync(path.join(DATA_DIR, 'ignored.json'), JSON.stringify(ignored, null, 2));
            }
            
            saveData();
            socket.emit('admin_data_update', { objects, characters, scenes });
            socket.emit('gm_hacking_log', 'Object Deleted & Ignored: ' + id);
        }
    });

    socket.on('admin_project_character', (char) => {
        // Use token image if available, otherwise fallback to main image
        const imgToUse = char.tokenImage || char.image;
        if (!imgToUse) return;
        
        const instance = {
            instanceId: 'char_' + Date.now(),
            type: 'character',
            image: imgToUse,
            x: 500,
            y: 200,
            width: 200, // Smaller default for tokens?
            height: 200,
            draggable: true,
            name: char.name,
            description: char.class || 'Character'
        };
        tableState.activeObjects.push(instance);
        io.to('table').emit('table_state_update', tableState);
        socket.emit('gm_hacking_log', 'Projected Character: ' + char.name);
    });

    socket.on('admin_project_rp_character', (char) => {
        if (!char.image) return;
        
        // Add to roleplay state
        const rpChar = {
            id: char.id,
            name: char.name,
            image: char.image, // Use MOOD image (big)
            x: 50, // Center percentage?
            y: 50,
            scale: 1.0
        };
        
        // Ensure roleplay is active
        roleplayState.active = true;
        
        // Check if we should clear others or append? 
        // "The images of the NPC are to be put OVER the mood image"
        // Let's assume we can have multiple, but maybe we want to clear previous ones if they are just "projected"?
        // For now, let's just push. The GM can clear them via another control if needed (which we might need to add).
        // Actually, let's check if it's already there to avoid duplicates.
        if (!roleplayState.characters) roleplayState.characters = [];
        
        // If character is already projected, maybe move it to front?
        const existingIdx = roleplayState.characters.findIndex(c => c.id === char.id);
        if (existingIdx >= 0) {
            roleplayState.characters.splice(existingIdx, 1);
        }
        roleplayState.characters.push(rpChar);
        
        io.emit('roleplay_state_update', roleplayState);
        socket.emit('gm_hacking_log', 'Projected RP Character: ' + char.name);
        saveStatus();
    });

    socket.on('admin_scan_chars', () => {
        const charDir = path.join(MEDIA_DIR, '[CHAR] Character pictures');
        if (!fs.existsSync(charDir)) {
            socket.emit('gm_hacking_log', 'Error: Character folder not found');
            return;
        }
    
        const files = [];
        // Custom recursive scan to capture folder structure
        function scan(directory, root) {
            const items = fs.readdirSync(directory);
            items.forEach(item => {
                const fullPath = path.join(directory, item);
                if (fs.statSync(fullPath).isDirectory()) {
                    scan(fullPath, root);
                } else {
                    // Check extension
                    if (/\.(png|jpg|jpeg)$/i.test(item)) {
                        // Ignore variants starting with [
                        if (!item.startsWith('[')) {
                            files.push({
                                fullPath: fullPath,
                                fileName: item,
                                // Get relative folder path, replace backslashes with forward slashes
                                group: path.relative(root, directory).replace(/\\/g, '/') || 'General'
                            });
                        }
                    }
                }
            });
        }
    
        scan(charDir, charDir);
    
        let addedCount = 0;
        let updatedCount = 0;

        files.forEach(file => {
            const name = path.parse(file.fileName).name;
            const existing = characters.find(c => c.name === name);
            
            // Construct web-accessible path
            // media/[CHAR].../Group/File.png
            let webPath = '/media/[CHAR] Character pictures/';
            if (file.group !== 'General') {
                webPath += file.group + '/';
            }
            webPath += file.fileName;
    
            if (!existing) {
                const newChar = {
                    id: Date.now().toString() + Math.random().toString(36).substr(2, 5),
                    name: name,
                    isNPC: true,
                    npcType: 'rp', // Default to RP for auto-scanned
                    group: file.group,
                    image: webPath,
                    class: 'Unknown',
                    description: 'Auto-generated from file'
                };
                characters.push(newChar);
                addedCount++;
            } else {
                // Update group if it's missing or 'General' and we found a specific one
                let changed = false;
                if ((!existing.group || existing.group === 'General') && file.group !== 'General') {
                    existing.group = file.group;
                    changed = true;
                }
                // Update image path to ensure it's correct
                if (existing.image !== webPath) {
                    existing.image = webPath;
                    changed = true;
                }
                if (changed) updatedCount++;
            }
        });
    
        if (addedCount > 0 || updatedCount > 0) {
            saveData();
            socket.emit('admin_data_update', { objects, characters, scenes, items });
            socket.emit('gm_hacking_log', `Scanned ${files.length} files. Added ${addedCount}, Updated ${updatedCount}.`);
        } else {
            socket.emit('gm_hacking_log', `Scan complete. No changes.`);
        }
    });

    socket.on('admin_add_item', (newItem) => {
        if (!newItem.name) return;

        if (!newItem.id) {
            newItem.id = newItem.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
        }

        let originalId = newItem.id;
        let counter = 1;
        while (items.find(i => i.id === newItem.id)) {
            newItem.id = originalId + '_' + counter;
            counter++;
        }

        // --- STATS GENERATION BASED ON REFERENCE DATA ---
        // Default: General Item (HP 6, Hardness 0, AC 5)
        let stats = {
            hp: 6,
            max_hp: 6,
            hardness: 0,
            ac: 5
        };

        const cat = (newItem.category || '').toLowerCase();
        const name = (newItem.name || '').toLowerCase();

        // Combat Gear (Weapons, Armor) -> HP 18, Hardness 7, AC 5
        const combatKeywords = ['weapon', 'gun', 'rifle', 'pistol', 'sword', 'blade', 'armor', 'suit', 'vest', 'shield', 'helm'];
        
        if (combatKeywords.some(k => cat.includes(k) || name.includes(k))) {
            stats.hp = 18;
            stats.max_hp = 18;
            stats.hardness = 7;
            stats.ac = 5;
        }

        newItem.stats = stats;
        // ------------------------------------------------

        items.push(newItem);
        saveData();
        
        socket.emit('admin_data_update', { objects, characters, scenes, items });
        socket.emit('gm_hacking_log', 'Item Created: ' + newItem.name);
    });

    socket.on('admin_update_data', (data) => {
        if (!data || !data.type || !Array.isArray(data.content)) return;
        if (data.type === 'objects') objects = data.content;
        if (data.type === 'characters') characters = data.content;
        if (data.type === 'items') items = data.content;
        if (data.type === 'quests') quests = data.content;
        saveData();
        // Notifica il GM che il salvataggio è avvenuto
        socket.emit('admin_data_update', { objects, characters, scenes, items, quests });
        // Opzionale: Notifica i player se i loro dati sono cambiati
        if (data.type === 'characters') {
            const safeChars = characters.map(c => ({
                id: c.id,
                name: c.name,
                username: c.username,
                class: c.class,
                roles: c.roles,
                // Exclude password, inventory, stats if not needed
            }));
            io.to('player').emit('player_data_update', safeChars);
            
            // Send updated character data to each logged-in player
            characters.forEach(c => {
                if (c.username) {
                    io.to('player_' + c.id).emit('player_char_update', c);
                }
            });
        }
    });

    socket.on('admin_refresh_db', () => {
        console.log('Admin requested DB refresh...');
        loadData();
        socket.emit('admin_data_update', { objects, characters, scenes, items, quests });
        socket.emit('media_list_update', getMediaFiles());
        socket.emit('gm_hacking_log', 'Database Refreshed (Rescanned Media)');
    });

    // --- GESTIONE QUEST (GM) ---
    socket.on('admin_quest_action', (action) => {
        if (action.type === 'create') {
            quests.push(action.quest);
        } else if (action.type === 'update') {
            const idx = quests.findIndex(q => q.id === action.quest.id);
            if (idx >= 0) quests[idx] = { ...quests[idx], ...action.quest };
        } else if (action.type === 'delete') {
            quests = quests.filter(q => q.id !== action.id);
        }
        
        saveData();
        socket.emit('admin_data_update', { objects, characters, scenes, items, quests });
    });

    // --- LEVEL-UP SYSTEM ---
    socket.on('gm_allow_levelup', (charId) => {
        if (!charId) return;
        const char = characters.find(c => c.id === charId);
        if (!char || !char.vitals) return;
        levelupPending.add(charId);
        console.log(`Level-up allowed for: ${char.name} (currently level ${char.vitals.level})`);
        // Notify GM
        io.to('gm').emit('admin_levelup_status', Array.from(levelupPending));
        // Notify player
        io.to('player_' + charId).emit('levelup_available', true);
    });

    socket.on('gm_revoke_levelup', (charId) => {
        levelupPending.delete(charId);
        io.to('gm').emit('admin_levelup_status', Array.from(levelupPending));
        io.to('player_' + charId).emit('levelup_available', false);
    });

    socket.on('player_request_levelup_data', (charId) => {
        if (!levelupPending.has(charId)) return;
        const char = characters.find(c => c.id === charId);
        if (!char || !char.vitals) return;

        const newLevel = (char.vitals.level || 1) + 1;
        if (newLevel > 20) return;

        // Look up class, race, theme from ruleset
        const cls = (ruleset.classes || []).find(c => c.name === char.class);
        const race = (ruleset.races || []).find(r => r.id === char.raceId || r.name === char.race);
        const theme = (ruleset.themes || []).find(t => t.id === char.themeId || t.name === char.theme);

        const hasAbilityIncrease = SF_ABILITY_INCREASE_LEVELS.includes(newLevel);
        const hasFeat = SF_FEAT_LEVELS.includes(newLevel);
        const hasThemeBenefit = SF_THEME_BENEFIT_LEVELS.includes(newLevel);
        const isCaster = cls ? cls.isCaster : false;

        // Compute what auto-values will be at new level
        const raceHp = race ? race.hp : 0;
        const classHp = cls ? cls.hp : 0;
        const classSp = cls ? cls.sp : 0;
        const bab = cls ? (SF_BAB[cls.bab] || SF_BAB.moderate)[newLevel] || 0 : 0;
        const fortBase = cls ? (SF_SAVES[cls.fort] || SF_SAVES.slow)[newLevel] || 0 : 0;
        const refBase = cls ? (SF_SAVES[cls.ref] || SF_SAVES.slow)[newLevel] || 0 : 0;
        const willBase = cls ? (SF_SAVES[cls.will] || SF_SAVES.slow)[newLevel] || 0 : 0;
        const skillRanksPerLevel = (cls ? cls.skillRanks : 0) + Math.floor(((char.stats?.INT || 10) - 10) / 2);

        // Spell data for casters
        let spellData = null;
        if (isCaster) {
            const known = SF_SPELLS_KNOWN[newLevel] || [0,0,0,0,0,0,0];
            const perDay = SF_SPELLS_PER_DAY[newLevel] || [0,0,0,0,0,0];
            const prevKnown = SF_SPELLS_KNOWN[newLevel - 1] || [0,0,0,0,0,0,0];
            // Calculate how many new spells player can pick per level
            const newSpellSlots = known.map((k, i) => Math.max(0, k - prevKnown[i]));
            spellData = { known, perDay, newSpellSlots };
        }

        // Extract theme benefit text for this level
        let themeBenefitText = '';
        if (hasThemeBenefit && theme && theme.description) {
            const levelLabel = newLevel === 6 ? '6th' : newLevel === 12 ? '12th' : '18th';
            const regex = new RegExp(`${levelLabel}\\s*Level[\\s\\S]*?(?=<h|$)`, 'i');
            const match = theme.description.match(regex);
            if (match) themeBenefitText = match[0];
        }

        // Gather IDs of spells the character already knows
        const knownSpellIds = (char.spells || []).map(s => s.id);

        // Send all level-up info to the player
        socket.emit('levelup_data', {
            charId,
            newLevel,
            currentStats: char.stats,
            hasAbilityIncrease,
            hasFeat,
            hasThemeBenefit,
            themeBenefitText,
            themeName: theme ? theme.name : char.theme || '',
            isCaster,
            spellData,
            className: cls ? cls.name : char.class,
            classDescription: cls ? cls.description : '',
            raceHp,
            classHp,
            classSp,
            bab,
            fortBase,
            refBase,
            willBase,
            skillRanksPerLevel: Math.max(1, skillRanksPerLevel),
            classSkills: cls ? cls.classSkills : [],
            kas: cls ? cls.kas : '',
            currentSkillRanks: char.skills || {},
            feats: (ruleset.feats || []).map(f => ({ id: f.id, name: f.name, category: f.category, isCombat: f.isCombat, requirements: f.requirements, description: f.description, source: f.source })),
            availableSpells: isCaster ? spells : [],
            knownSpellIds
        });
    });

    socket.on('player_submit_levelup', (data) => {
        if (!data || !data.charId) return;
        if (!levelupPending.has(data.charId)) {
            socket.emit('levelup_error', 'Level-up not authorized');
            return;
        }
        const char = characters.find(c => c.id === data.charId);
        if (!char || !char.vitals) return;

        const newLevel = (char.vitals.level || 1) + 1;
        if (newLevel > 20) { socket.emit('levelup_error', 'Max level reached'); return; }

        const cls = (ruleset.classes || []).find(c => c.name === char.class);
        const race = (ruleset.races || []).find(r => r.id === char.raceId || r.name === char.race);

        // Step 1: Apply ability score increases (if applicable)
        if (SF_ABILITY_INCREASE_LEVELS.includes(newLevel) && Array.isArray(data.abilityIncreases)) {
            data.abilityIncreases.slice(0, 4).forEach(ab => {
                const key = ab.toUpperCase();
                if (char.stats && char.stats[key] !== undefined) {
                    char.stats[key] += (char.stats[key] >= 17 ? 1 : 2);
                }
            });
        }

        // Step 2: Compute HP/SP/RP
        const conMod = Math.floor(((char.stats?.CON || 10) - 10) / 2);
        const raceHp = race ? race.hp : 0;
        const classHp = cls ? cls.hp : 0;
        const classSp = cls ? cls.sp : 0;
        const kasKey = cls ? cls.kas : '';
        const kasMod = kasKey ? Math.floor(((char.stats?.[kasKey.toUpperCase()] || 10) - 10) / 2) : 0;

        char.vitals.level = newLevel;
        char.vitals.max_hp = raceHp + (classHp * newLevel);
        char.vitals.hp = char.vitals.max_hp; // Full heal on level up
        char.vitals.max_sp = Math.max(0, (classSp + conMod) * newLevel);
        char.vitals.sp = char.vitals.max_sp;
        char.vitals.max_rp = Math.max(1, Math.floor(newLevel / 2) + kasMod);
        char.vitals.rp = char.vitals.max_rp;

        // Step 3: BAB & Saves
        char.combat.bab = cls ? (SF_BAB[cls.bab] || SF_BAB.moderate)[newLevel] || 0 : 0;
        char.saves.fort_base = cls ? (SF_SAVES[cls.fort] || SF_SAVES.slow)[newLevel] || 0 : 0;
        char.saves.ref_base = cls ? (SF_SAVES[cls.ref] || SF_SAVES.slow)[newLevel] || 0 : 0;
        char.saves.will_base = cls ? (SF_SAVES[cls.will] || SF_SAVES.slow)[newLevel] || 0 : 0;

        // Step 4: Theme benefits (informational, no mechanical changes needed on server)

        // Step 5: Class features (informational)

        // Step 6: Spells (if caster)
        if (cls && cls.isCaster && data.newSpells && Array.isArray(data.newSpells)) {
            // Add new spells to character's spell list
            data.newSpells.forEach(spell => {
                if (spell && spell.id && !char.spells?.find(s => s.id === spell.id)) {
                    if (!char.spells) char.spells = [];
                    char.spells.push(spell);
                }
            });
            // Update spell slots
            const known = SF_SPELLS_KNOWN[newLevel] || [0,0,0,0,0,0,0];
            const perDay = SF_SPELLS_PER_DAY[newLevel] || [0,0,0,0,0,0];
            if (!char.spellSlots) char.spellSlots = { known: [0,0,0,0,0,0,0], perDay: [0,0,0,0,0,0,0], used: [0,0,0,0,0,0,0] };
            char.spellSlots.known = known;
            char.spellSlots.perDay = [-1, ...perDay]; // -1 = unlimited cantrips
            char.spellSlots.used = [0,0,0,0,0,0,0]; // Reset on level up
        }

        // Step 7: Feats
        if (SF_FEAT_LEVELS.includes(newLevel) && data.newFeat) {
            if (!char.feats) char.feats = [];
            if (data.newFeat.option) {
                char.feats.push({ name: data.newFeat.name, option: data.newFeat.option });
            } else {
                char.feats.push(data.newFeat.name);
            }
        }

        // Step 8: Skill ranks
        if (data.skillRanks && typeof data.skillRanks === 'object') {
            Object.entries(data.skillRanks).forEach(([skillId, addedRanks]) => {
                const ranks = parseInt(addedRanks);
                if (ranks > 0 && char.skills && char.skills[skillId]) {
                    char.skills[skillId].ranks = (char.skills[skillId].ranks || 0) + ranks;
                    // Cap at character level
                    if (char.skills[skillId].ranks > newLevel) {
                        char.skills[skillId].ranks = newLevel;
                    }
                }
            });
        }

        // Remove from pending
        levelupPending.delete(data.charId);

        // Save & notify
        saveData();
        socket.emit('levelup_complete', char);
        socket.emit('levelup_available', false);
        io.to('gm').emit('admin_levelup_status', Array.from(levelupPending));
        io.to('gm').emit('admin_data_update', { objects, characters, scenes, items, quests, spells });
        // Send updated char to player
        io.to('player_' + data.charId).emit('player_char_update', char);
        console.log(`Level-up completed: ${char.name} is now level ${newLevel}`);
    });

    // --- SHOP SYSTEM ---
    socket.on('admin_shop_action', (action) => {
        if (!action || !action.type) return;

        if (action.type === 'create') {
            const shop = {
                id: Date.now().toString(36) + Math.random().toString(36).substring(2, 6),
                name: action.name || 'New Shop',
                location: action.location || '',
                description: action.description || '',
                categories: action.categories || [],
                stock: action.stock || [],
                isOpen: false,
                resalePercent: action.resalePercent || 10
            };
            shops.push(shop);
        } else if (action.type === 'update') {
            const idx = shops.findIndex(s => s.id === action.shop.id);
            if (idx >= 0) shops[idx] = { ...shops[idx], ...action.shop };
        } else if (action.type === 'delete') {
            shops = shops.filter(s => s.id !== action.id);
        } else if (action.type === 'open') {
            // Open shop for specific player(s)
            const shop = shops.find(s => s.id === action.shopId);
            if (!shop) return;
            const targetIds = Array.isArray(action.charIds) ? action.charIds : [action.charIds];
            targetIds.forEach(cid => {
                shopSessions[cid] = action.shopId;
                io.to('player_' + cid).emit('shop_open', {
                    shop: { ...shop, stock: shop.stock.map(s => ({ ...s, item: items.find(i => i.id === s.itemId) })) },
                    resalePercent: shop.resalePercent || 10
                });
            });
            console.log(`Shop "${shop.name}" opened for ${targetIds.length} player(s)`);
        } else if (action.type === 'close') {
            const targetIds = Array.isArray(action.charIds) ? action.charIds : Object.keys(shopSessions);
            targetIds.forEach(cid => {
                delete shopSessions[cid];
                io.to('player_' + cid).emit('shop_close');
            });
        }

        saveData();
        io.to('gm').emit('admin_shops_update', shops);
    });

    socket.on('player_buy_item', (data) => {
        if (!data || !data.charId || !data.itemId) return;
        const char = characters.find(c => c.id === data.charId);
        if (!char) return;
        const shopId = shopSessions[data.charId];
        if (!shopId) { socket.emit('shop_error', 'No shop is open'); return; }
        const shop = shops.find(s => s.id === shopId);
        if (!shop) return;

        const stockEntry = shop.stock.find(s => s.itemId === data.itemId);
        if (!stockEntry) { socket.emit('shop_error', 'Item not available in this shop'); return; }
        if (stockEntry.qty !== -1 && stockEntry.qty <= 0) { socket.emit('shop_error', 'Item out of stock'); return; }

        const item = items.find(i => i.id === data.itemId);
        if (!item) return;
        const price = stockEntry.priceOverride || item.price || 0;

        if ((char.money || 0) < price) { socket.emit('shop_error', 'Not enough credits'); return; }

        // Execute purchase
        char.money = (char.money || 0) - price;
        if (!char.inventory) char.inventory = [];
        const existing = char.inventory.find(i => (i.itemId || i.id) === data.itemId);
        if (existing) {
            existing.quantity = (existing.quantity || existing.qty || 1) + 1;
            // Normalize legacy fields
            if (existing.id && !existing.itemId) { existing.itemId = existing.id; delete existing.id; }
            if (existing.qty !== undefined) { delete existing.qty; }
        } else {
            char.inventory.push({ itemId: data.itemId, quantity: 1 });
        }

        // Reduce stock
        if (stockEntry.qty !== -1) stockEntry.qty--;

        saveData();
        io.to('player_' + data.charId).emit('player_char_update', char);
        socket.emit('shop_transaction', { type: 'buy', item: item.name, itemId: data.itemId, price, newBalance: char.money });
        io.to('gm').emit('admin_data_update', { objects, characters, scenes, items, quests, spells });
        io.to('gm').emit('admin_shops_update', shops);
        console.log(`${char.name} bought ${item.name} for ${price} credits`);
    });

    socket.on('player_sell_item', (data) => {
        if (!data || !data.charId || !data.itemId) return;
        const char = characters.find(c => c.id === data.charId);
        if (!char) return;
        const shopId = shopSessions[data.charId];
        if (!shopId) { socket.emit('shop_error', 'No shop is open'); return; }
        const shop = shops.find(s => s.id === shopId);
        if (!shop) return;

        const invEntry = (char.inventory || []).find(i => (i.itemId || i.id) === data.itemId);
        if (!invEntry) { socket.emit('shop_error', 'You don\'t have this item'); return; }
        const invQty = typeof invEntry.quantity === 'number' ? invEntry.quantity : (typeof invEntry.qty === 'number' ? invEntry.qty : 1);
        if (invQty <= 0) { socket.emit('shop_error', 'You don\'t have this item'); return; }

        const item = items.find(i => i.id === data.itemId);
        if (!item) return;
        const fullPrice = item.price || 0;
        const sellPrice = Math.floor(fullPrice * (shop.resalePercent || 10) / 100);

        // Execute sale
        char.money = (char.money || 0) + sellPrice;
        const currentQty = typeof invEntry.quantity === 'number' ? invEntry.quantity : (typeof invEntry.qty === 'number' ? invEntry.qty : 1);
        if (currentQty > 1) {
            invEntry.quantity = currentQty - 1;
            // Normalize legacy fields
            if (invEntry.id && !invEntry.itemId) { invEntry.itemId = invEntry.id; delete invEntry.id; }
            if (invEntry.qty !== undefined) { delete invEntry.qty; }
        } else {
            char.inventory = char.inventory.filter(i => (i.itemId || i.id) !== data.itemId);
        }

        saveData();
        io.to('player_' + data.charId).emit('player_char_update', char);
        socket.emit('shop_transaction', { type: 'sell', item: item.name, price: sellPrice, newBalance: char.money });
        io.to('gm').emit('admin_data_update', { objects, characters, scenes, items, quests, spells });
        console.log(`${char.name} sold ${item.name} for ${sellPrice} credits (${shop.resalePercent}% of ${fullPrice})`);
    });

    // --- GESTIONE SCENE (GM) ---
    socket.on('admin_scene_action', (action) => {
        if (action.type === 'save') {
            // Use folder name as ID. If it's a new scene name, we might need to create a folder?
            // For now, assume we are saving to the CURRENT loaded scene or a new one if specified
            
            let sceneId = action.id;
            if (!sceneId && action.name) {
                // Try to find scene by name
                const existing = scenes.find(s => s.name === action.name);
                if (existing) sceneId = existing.id;
                else {
                    // Create new folder logic could go here, but let's stick to existing folders for safety first
                    // Or create a generic one
                    sceneId = `[99] ${action.name}`;
                }
            }

            if (sceneId) {
                currentSceneId = sceneId; // Set as current
                const newScene = {
                    id: sceneId,
                    name: action.name || sceneId,
                    objects: tableState.activeObjects,
                    mood: moodState.imageUrl
                };
                
                saveSceneData(sceneId, newScene);
                socket.emit('admin_data_update', { objects, characters, scenes });
            }
        } else if (action.type === 'load') {
            const scene = scenes.find(s => s.id === action.id);
            if (scene) {
                currentSceneId = scene.id; // Set as current
                tableState.activeObjects = JSON.parse(JSON.stringify(scene.objects)); // Deep copy
                io.to('table').emit('table_state_update', tableState);
                
                // Load mood if present, else default
                if (scene.mood) {
                    moodState.imageUrl = scene.mood;
                } else {
                    // Default Mood Logic
                    const allMedia = getMediaFiles();
                    const idleMood = allMedia.find(m => m.folder.includes('[00]Global') && m.name.startsWith('[MOOD]Idle'));
                    moodState.imageUrl = idleMood ? '/media/' + idleMood.path : '';
                }
                io.emit('mood_state_update', moodState.imageUrl);
                
                // Sync GM preview too
                socket.emit('table_state_update', tableState); 
            }
        } else if (action.type === 'delete') {
            // We probably shouldn't delete the folder, just the json? Or do nothing for now to be safe.
            // scenes = scenes.filter(s => s.id !== action.id);
            // saveData();
            // socket.emit('admin_data_update', { objects, characters, scenes });
        }
    });

    // --- GESTIONE HACKING (GM) ---
    socket.on('gm_hacking_action', (action) => {
        if (action.type === 'start') {
            // Resolve target if it's a role
            let target = action.target || 'all';
            
            // If target starts with "role:", find all players with that role
            if (typeof target === 'string' && target.startsWith('role:')) {
                const roleName = target.split(':')[1];
                const targetPlayers = characters.filter(c => c.roles && c.roles.includes(roleName)).map(c => c.username);
                target = targetPlayers; // Array of usernames
            }

            hackingState = {
                active: true,
                password: (action.password || '').toUpperCase(),
                dc: parseInt(action.dc) || 15,
                complexity: parseInt(action.complexity) || 3,
                revealedIndices: [],
                attempts: 0,
                target: target // 'all', username, or array of usernames
            };
            
            const publicState = getPublicHackingState();
            
            // Broadcast to all players, they will filter based on 'target'
            io.to('player').emit('player_hacking_update', { ...publicState, target: hackingState.target });
            
            // Conferma al GM
            socket.emit('gm_hacking_update', hackingState);
        
        } else if (action.type === 'check') {
            if (!hackingState.active) return;
            
            hackingState.attempts++;
            const roll = parseInt(action.roll);
            const diff = roll - hackingState.dc;
            
            if (diff < 0) {
                // Fallimento
                const failMsg = { success: false, message: 'ACCESS DENIED', target: hackingState.target };
                io.to('player').emit('player_hacking_result', failMsg);
                socket.emit('gm_hacking_log', 'Check Failed: ' + roll + ' vs DC ' + hackingState.dc);
            } else {
                // Successo -> Avvia Minigame
                const difficulty = Math.max(0, 10 - diff); 
                const ringsRemoved = Math.floor(diff / 5);
                const numRings = Math.max(1, (hackingState.complexity || 3) - ringsRemoved);

                const minigameConfig = { 
                    type: 'CIRCLE', 
                    difficulty: difficulty,
                    rings: numRings,
                    margin: diff,
                    target: hackingState.target
                };

                io.to('player').emit('start_minigame', minigameConfig);
                socket.emit('gm_hacking_log', 'Check Passed! Starting Minigame (Margin: ' + diff + ', Rings: ' + numRings + ')');
            }
        } else if (action.type === 'stop') {
            hackingState.active = false;
            io.to('player').emit('player_instruction', { type: 'reset' });
        }
    });

    // Risultato del Minigame dal Player
    socket.on('player_minigame_result', (result) => {
        if (result.success) {
            // Sblocca tutto
            hackingState.revealedIndices = Array.from({length: hackingState.password.length}, (_, i) => i);
            io.to('player').emit('player_hacking_update', getPublicHackingState());
            socket.emit('gm_hacking_update', hackingState);
            socket.emit('gm_hacking_log', 'Minigame WON! System Unlocked.');
        } else {
            socket.emit('gm_hacking_log', 'Minigame LOST.');
            io.to('player').emit('player_hacking_result', { success: false, message: 'BREACH FAILED' });
        }
    });

    // Helper per mandare solo ciò che serve ai player
    function getPublicHackingState() {
        // Costruisci la stringa mascherata
        let masked = '';
        for (let i = 0; i < hackingState.password.length; i++) {
            if (hackingState.revealedIndices.includes(i) || hackingState.password[i] === ' ') {
                masked += hackingState.password[i];
            } else {
                masked += '*';
            }
        }
        return {
            active: hackingState.active,
            maskedPassword: masked,
            length: hackingState.password.length,
            attempts: hackingState.attempts
        };
    }

    // --- GESTIONE MAPPA (GM) ---
    socket.on('admin_map_action', (action) => {
        console.log('Map Action:', action);
        if (action.type === 'spawn') {
            const objDef = objects.find(o => o.id === action.objectId);
            if (objDef) {
                // Se è uno sfondo, rimuovi i precedenti e forza coordinate 0,0
                if (objDef.type === 'background') {
                    tableState.activeObjects = tableState.activeObjects.filter(o => o.type !== 'background');
                }

                const instance = { 
                    instanceId: Date.now().toString() + Math.random().toString(36).substr(2, 5), 
                    ...objDef, 
                    x: objDef.type === 'background' ? 0 : (action.x || 100), 
                    y: objDef.type === 'background' ? 0 : (action.y || 100) 
                };
                tableState.activeObjects.push(instance);
            }
        } else if (action.type === 'clear') {
            tableState.activeObjects = [];
        } else if (action.type === 'set_background') {
            // Rimuovi vecchi sfondi
            tableState.activeObjects = tableState.activeObjects.filter(o => o.type !== 'background');
            
            if (action.url) {
                tableState.activeObjects.push({
                    instanceId: 'bg_' + Date.now(),
                    type: 'background',
                    image: action.url,
                    x: 0,
                    y: 0,
                    width: 1920,
                    height: 1080,
                    draggable: false,
                    name: 'Background'
                });
            }
        }
        
        // Aggiorna il tavolo
        io.to('table').emit('table_state_update', tableState);
        autosaveCurrentScene();
    });

    // 2. Comandi dal GM
    socket.on('gm_change_scene', (data) => {
        console.log('GM -> Table: Cambio scena', data);
        // Invia comando SOLO al tavolo (proiettore)
        io.to('table').emit('load_scene', data);
    });

    socket.on('gm_player_command', (data) => {
        console.log('GM -> Players:', data);
        // Invia comando a TUTTI i player (telefoni)
        io.to('player').emit('player_instruction', data);
    });

    // 3. Input dai Player (Telefoni)
    socket.on('player_action', (data) => {
        console.log('Player Action:', data);
        // Inoltra l'azione al Tavolo (per visualizzarla) e al GM (per log/controllo)
        io.to('table').emit('player_feedback', data);
        io.to('gm').emit('player_feedback', data);
    });

    // 4. Interazione diretta sul Tavolo (Mouse/Touch su RPi)
    socket.on('table_object_update', (data) => {
        // data: { id: instanceId, x, y, scaleX, scaleY, rotation }
        const obj = tableState.activeObjects.find(o => o.instanceId === data.id);
        if (obj) {
            if (data.x !== undefined) obj.x = data.x;
            if (data.y !== undefined) obj.y = data.y;
            if (data.scaleX !== undefined) obj.scaleX = data.scaleX;
            if (data.scaleY !== undefined) obj.scaleY = data.scaleY;
            if (data.rotation !== undefined) obj.rotation = data.rotation;
            
            // Aggiorna il GM e gli altri tavoli
            io.to('gm').emit('sync_object', data);
            socket.broadcast.to('table').emit('sync_object', data);
            
            autosaveCurrentScene();
        }
    });

    // Legacy support for move only
    socket.on('table_object_move', (data) => {
        const obj = tableState.activeObjects.find(o => o.instanceId === data.id);
        if (obj) {
            obj.x = data.x;
            obj.y = data.y;
        }
    });

    // --- MOOD DISPLAY ---
    socket.on('admin_mood_action', (action) => {
        if (action.type === 'set') {
            moodState.imageUrl = action.url;
            io.emit('mood_state_update', moodState.imageUrl);
            saveStatus();
            autosaveCurrentScene();
        }
    });

    // --- CAMPAIGN SETTINGS ---
    socket.on('admin_campaign_settings', (settings) => {
        if (settings.allowedSources !== undefined) {
            campaignSettings.allowedSources = settings.allowedSources;
        }
        saveStatus();
        io.emit('campaign_settings_update', campaignSettings);
        console.log('Campaign settings updated:', campaignSettings);
    });
    
    // ─────────────────────────────────────────────────────────────────────────
    // BATTLEMAP
    // ─────────────────────────────────────────────────────────────────────────
    socket.on('admin_battlemap_config', (cfg) => {
        const allowed = ['active','mapUrl','gridType','gridCols','gridRows','gridColor','gridOpacity','physicalCols','physicalRows','tableOffsetX','tableOffsetY','fowEnabled'];
        allowed.forEach(k => { if (cfg[k] !== undefined) battlemapState[k] = cfg[k]; });
        saveStatus();
        io.emit('battlemap_state', battlemapState);
    });

    socket.on('admin_battlemap_token_add', (tok) => {
        const newTok = {
            id: 'tok_' + Date.now() + '_' + Math.random().toString(36).slice(2,5),
            type: tok.type || 'enemy',
            charId: tok.charId || null,
            name: tok.name || 'Token',
            image: tok.image || '',
            col: typeof tok.col === 'number' ? tok.col : 0,
            row: typeof tok.row === 'number' ? tok.row : 0,
            size: tok.size || 1,
            hp: tok.hp || 0,
            maxHp: tok.maxHp || 0,
            sp: tok.sp || 0,
            maxSp: tok.maxSp || 0,
            hpMode: tok.hpMode || 'hidden', // 'hp_bar'|'damage_dealt'|'hidden'
            damageTaken: 0,
            conditions: tok.conditions || [],
            hidden: tok.hidden || false,
            color: tok.color || null,
            initiative: tok.initiative || 0,
            elevation: 0,
        };
        battlemapState.tokens.push(newTok);
        saveStatus();
        io.emit('battlemap_state', battlemapState);
    });

    socket.on('admin_battlemap_token_update', (data) => {
        const tok = battlemapState.tokens.find(t => t.id === data.id);
        if (!tok) return;
        const safe = ['type','name','image','size','hp','maxHp','sp','maxSp','hpMode','damageTaken','conditions','hidden','color','initiative','elevation','col','row','charId'];
        safe.forEach(k => { if (data[k] !== undefined) tok[k] = data[k]; });
        saveStatus();
        io.emit('battlemap_state', battlemapState);
    });

    socket.on('admin_battlemap_token_remove', (data) => {
        battlemapState.tokens = battlemapState.tokens.filter(t => t.id !== data.id);
        battlemapState.initiativeOrder = battlemapState.initiativeOrder.filter(id => id !== data.id);
        saveStatus();
        io.emit('battlemap_state', battlemapState);
    });

    socket.on('admin_battlemap_token_move', (data) => {
        const tok = battlemapState.tokens.find(t => t.id === data.id);
        if (tok) { tok.col = data.col; tok.row = data.row; }
        saveStatus();
        io.emit('battlemap_state', battlemapState);
    });

    socket.on('admin_battlemap_fow_paint', (data) => {
        // data.cells: { 'col,row': 'visible'|'explored'|null } (null = hide)
        Object.entries(data.cells).forEach(([key, val]) => {
            if (val === null || val === 'hidden') delete battlemapState.fowCells[key];
            else battlemapState.fowCells[key] = val;
        });
        saveStatus();
        io.emit('battlemap_state', battlemapState);
    });

    socket.on('admin_battlemap_fow_clear', () => {
        battlemapState.fowCells = {};
        saveStatus();
        io.emit('battlemap_state', battlemapState);
    });

    socket.on('admin_battlemap_fow_reveal_all', () => {
        const cells = {};
        for (let c = 0; c < battlemapState.gridCols; c++)
            for (let r = 0; r < battlemapState.gridRows; r++)
                cells[c + ',' + r] = 'visible';
        battlemapState.fowCells = cells;
        saveStatus();
        io.emit('battlemap_state', battlemapState);
    });

    socket.on('admin_battlemap_initiative', (data) => {
        battlemapState.initiativeOrder = data.order || [];
        battlemapState.initiativeCurrent = typeof data.current === 'number' ? data.current : -1;
        saveStatus();
        io.emit('battlemap_state', battlemapState);
    });

    // ─── BATTLEMAP GEOMETRY JSON ─────────────────────────────────────────────────
    socket.on('admin_get_battlemap_json', (data) => {
        if (!data || !data.mapUrl) return;
        try {
            const relPath = decodeURIComponent(data.mapUrl.replace(/^\/media\//, ''));
            const imgPath = path.resolve(MEDIA_DIR, relPath);
            if (!imgPath.startsWith(MEDIA_DIR + path.sep) && imgPath !== MEDIA_DIR) { console.error('Path traversal blocked'); return; }
            const jsonPath = imgPath.replace(/\.[^\.]+$/, '.json');
            let geoData = { walls: [], doors: [], lights: [] };
            if (fs.existsSync(jsonPath)) {
                geoData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            }
            socket.emit('battlemap_json_loaded', geoData);
        } catch (e) {
            console.error('Error loading battlemap JSON:', e);
            socket.emit('battlemap_json_loaded', { walls: [], doors: [], lights: [] });
        }
    });

    socket.on('admin_save_battlemap_json', (data) => {
        if (!data || !data.mapUrl || !data.geo) return;
        try {
            const relPath = decodeURIComponent(data.mapUrl.replace(/^\/media\//, ''));
            const imgPath = path.resolve(MEDIA_DIR, relPath);
            if (!imgPath.startsWith(MEDIA_DIR + path.sep) && imgPath !== MEDIA_DIR) { console.error('Path traversal blocked'); return; }
            const jsonPath = imgPath.replace(/\.[^\.]+$/, '.json');
            fs.writeFileSync(jsonPath, JSON.stringify(data.geo, null, 2));
            battlemapState.geo = data.geo;
            saveStatus();
            io.emit('battlemap_state', battlemapState);
            socket.emit('gm_hacking_log', 'Battlemap geometry saved.');
        } catch (e) {
            console.error('Error saving battlemap JSON:', e);
        }
    });

    socket.on('admin_battlemap_door_toggle', (data) => {
        // data: { doorIndex, state } — updates door state in live geo
        if (!battlemapState.geo || !Array.isArray(battlemapState.geo.doors)) return;
        const door = battlemapState.geo.doors[data.doorIndex];
        if (!door) return;
        door.state = data.state || 'closed';
        if (battlemapState.mapUrl) {
            try {
                const relPath = decodeURIComponent(battlemapState.mapUrl.replace(/^\/media\//, ''));
                const jsonPath = path.resolve(MEDIA_DIR, relPath).replace(/\.[^\.]+$/, '.json');
                fs.writeFileSync(jsonPath, JSON.stringify(battlemapState.geo, null, 2));
            } catch (e) { console.error('door toggle save error:', e); }
        }
        saveStatus();
        io.emit('battlemap_state', battlemapState);
    });

    // From COM port: physical coords [fromCol;fromRow]-[toCol;toRow]
    // Physical coords are 0-indexed within the table viewport.
    // Map coords = tableOffset + physical coords.
    // [0;0] destination = miniature removed from table (hidden)
    socket.on('admin_battlemap_serial_move', (data) => {
        const ox = battlemapState.tableOffsetX || 0;
        const oy = battlemapState.tableOffsetY || 0;
        const fromC = ox + data.fromC;
        const fromR = oy + data.fromR;
        const tok = battlemapState.tokens.find(t => t.col === fromC && t.row === fromR);
        if (tok) {
            if (data.toC === 0 && data.toR === 0) {
                tok.hidden = true; tok.col = -1; tok.row = -1; // Removed from play
            } else {
                tok.col = ox + data.toC;
                tok.row = oy + data.toR;
            }
            saveStatus();
            io.emit('battlemap_state', battlemapState);
        }
    });

    // --- CHAT & TIME ---
    socket.on('chat_message', (msg) => {
        // msg: { sender: 'GM' | 'PlayerName', text: '...', channel: 'global' }
        const isAdmin = socket.rooms.has('gm');
        const channel = msg.channel || 'global';
        
        // Format game time string
        const gameTimeStr = `${timeState.year}-${String(timeState.day).padStart(3, '0')} ${String(timeState.hour).padStart(2, '0')}:${String(timeState.minute).padStart(2, '0')}`;

        const fullMsg = { 
            ...msg, 
            channel: channel,
            timestamp: Date.now(), 
            gameTime: gameTimeStr,
            isAdmin: isAdmin 
        };
        
        chatHistory.push(fullMsg);
        if (chatHistory.length > 100) chatHistory.shift(); // Keep last 100 in memory
        saveChatLog(fullMsg);
        io.emit('chat_update', fullMsg);
    });

    socket.on('admin_time_action', (action) => {
        if (action.type === 'set') {
            timeState.year = parseInt(action.year) || timeState.year;
            timeState.day = parseInt(action.day) || timeState.day;
            timeState.hour = parseInt(action.hour) || timeState.hour;
            timeState.minute = parseInt(action.minute) || timeState.minute;
            saveStatus();
        } else if (action.type === 'scramble') {
            timeState.scrambled = action.value;
        } else if (action.type === 'text_scramble') {
            timeState.textScrambled = action.value;
        }
        io.emit('time_update', timeState);
    });

    // Send initial states
    socket.emit('mood_state_update', moodState.imageUrl);
    socket.emit('time_update', timeState);
    socket.emit('chat_history', chatHistory);
    socket.emit('battlemap_state', battlemapState);
});

// Start server
const PORT = config.PORT;
const HOST = config.HOST;
http.listen(PORT, HOST, () => {
    const os = require('os');
    const nets = os.networkInterfaces();
    let lanIP = 'localhost';
    for (const name of Object.keys(nets)) {
        for (const net of nets[name]) {
            if (net.family === 'IPv4' && !net.internal) { lanIP = net.address; break; }
        }
        if (lanIP !== 'localhost') break;
    }
    const pad = (s, n) => s + ' '.repeat(Math.max(0, n - s.length));
    console.log(`\n  ┌─────────────────────────────────────────────┐`);
    console.log(`  │  SIT Server running                         │`);
    console.log(`  │                                             │`);
    console.log(`  │  ${pad('Local:   http://localhost:' + PORT, 42)}│`);
    console.log(`  │  ${pad('Network: http://' + lanIP + ':' + PORT, 42)}│`);
    console.log(`  │                                             │`);
    console.log(`  │  Admin:   /admin.html                       │`);
    console.log(`  │  Player:  /player.html                      │`);
    console.log(`  │  Mood:    /mood.html                        │`);
    console.log(`  │                                             │`);
    console.log(`  │  ${pad('Campaign: ' + path.relative(process.cwd(), CAMPAIGN_DIR) + '/', 42)}│`);
    console.log(`  └─────────────────────────────────────────────┘\n`);
});
