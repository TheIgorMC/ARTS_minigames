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

app.use(cors());

// Servi i file statici dalla cartella 'public'
app.use(express.static(path.join(__dirname, 'public')));
// Servi i file media dalla cartella 'media'
app.use('/media', express.static(path.join(__dirname, 'media')));

// Redirects per comodità
app.get('/mood', (req, res) => res.sendFile(path.join(__dirname, 'public/mood.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public/admin.html')));
app.get('/player', (req, res) => res.sendFile(path.join(__dirname, 'public/player.html')));

// Carica i dati JSON
const DATA_DIR = path.join(__dirname, 'data');
let objects = [];
let characters = [];
let items = [];
let scenes = [];
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

// --- PERSISTENCE ---
const STATUS_FILE = path.join(DATA_DIR, 'status.json');
const CHAT_LOG_FILE = path.join(DATA_DIR, 'chat_logs.txt');

function saveStatus() {
    const status = {
        time: timeState,
        mood: moodState,
        roleplay: roleplayState,
        identities: gmIdentities,
        conversations: conversations
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
    const mediaDir = path.join(__dirname, 'media');
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
    const mediaDir = path.join(__dirname, 'media');
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
        const globalDir = path.join(DATA_DIR, '../media/[00]Global');
        if (!fs.existsSync(globalDir)) {
            fs.mkdirSync(globalDir, { recursive: true });
        }

        objects = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'objects.json')));
        characters = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'characters.json')));
        if (fs.existsSync(path.join(DATA_DIR, 'items.json'))) {
            items = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'items.json')));
        } else {
            items = [];
        }
        
        // Load ignored list
        let ignored = [];
        if (fs.existsSync(path.join(DATA_DIR, 'ignored.json'))) {
            ignored = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'ignored.json')));
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
        // Scenes are saved individually now
        console.log('Dati salvati.');
    } catch (e) {
        console.error('Errore salvataggio dati:', e);
    }
}

function saveSceneData(sceneId, data) {
    try {
        const mediaDir = path.join(__dirname, 'media');
        const sceneDir = path.join(mediaDir, sceneId);
        
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
            socket.emit('admin_data_update', { objects, characters, scenes, items });
            socket.emit('media_list_update', getMediaFiles());
            socket.emit('admin_identities_update', gmIdentities);
            socket.emit('conversations_update', conversations);
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

    // --- LOGIN PLAYER ---
    socket.on('player_login', (credentials) => {
        const user = characters.find(c => c.username === credentials.username && c.password === credentials.password);
        if (user) {
            console.log(`Login successo per: ${user.name}`);
            socket.join('player'); // Unisciti al canale generico player
            socket.join('player_' + user.id); // Canale privato per questo player
            socket.emit('login_success', user);
            
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
        const charDir = path.join(__dirname, 'media', '[CHAR] Character pictures');
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
        if (data.type === 'objects') objects = data.content;
        if (data.type === 'characters') characters = data.content;
        if (data.type === 'items') items = data.content;
        saveData();
        // Notifica il GM che il salvataggio è avvenuto
        socket.emit('admin_data_update', { objects, characters, scenes, items });
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
        }
    });

    socket.on('admin_refresh_db', () => {
        console.log('Admin requested DB refresh...');
        loadData();
        socket.emit('admin_data_update', { objects, characters, scenes, items });
        socket.emit('media_list_update', getMediaFiles());
        socket.emit('gm_hacking_log', 'Database Refreshed (Rescanned Media)');
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
                password: action.password.toUpperCase(),
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
            timeState.year = parseInt(action.year);
            timeState.day = parseInt(action.day);
            timeState.hour = parseInt(action.hour);
            timeState.minute = parseInt(action.minute);
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
});

// Avvia il server sulla porta 3000
// '0.0.0.0' permette connessioni dalla rete locale
http.listen(3000, '0.0.0.0', () => {
    console.log('Server attivo su porta 3000');
});
