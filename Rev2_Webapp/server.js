const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');
const fs = require('fs');

// Carica i dati JSON
const DATA_DIR = path.join(__dirname, 'data');
let objects = [];
let characters = [];
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
    scrambled: false
};

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
    }
}, 60000);

function loadData() {
    try {
        objects = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'objects.json')));
        characters = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'characters.json')));
        if (fs.existsSync(path.join(DATA_DIR, 'scenes.json'))) {
            scenes = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'scenes.json')));
        }
        console.log('Dati caricati correttamente.');
    } catch (e) {
        console.error('Errore caricamento dati:', e);
    }
}
loadData();

function saveData() {
    try {
        fs.writeFileSync(path.join(DATA_DIR, 'objects.json'), JSON.stringify(objects, null, 2));
        fs.writeFileSync(path.join(DATA_DIR, 'characters.json'), JSON.stringify(characters, null, 2));
        fs.writeFileSync(path.join(DATA_DIR, 'scenes.json'), JSON.stringify(scenes, null, 2));
        console.log('Dati salvati.');
    } catch (e) {
        console.error('Errore salvataggio dati:', e);
    }
}

// Servi i file statici dalla cartella 'public'
app.use(express.static(path.join(__dirname, 'public')));
// Servi i file media dalla cartella 'media'
app.use('/media', express.static(path.join(__dirname, 'media')));

// Helper per leggere i file media
function getMediaFiles() {
    const mediaDir = path.join(__dirname, 'media');
    if (!fs.existsSync(mediaDir)) return [];
    return fs.readdirSync(mediaDir).filter(file => {
        return ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4'].includes(path.extname(file).toLowerCase());
    });
}

// Gestione connessioni Socket.io
io.on('connection', (socket) => {
    console.log('Un client si è connesso: ' + socket.id);

    // Send initial state to everyone
    socket.emit('time_update', timeState);
    socket.emit('chat_history', chatHistory);

    // 1. Identificazione Ruolo (GM, Table, Player)
    socket.on('join', (role) => {
        console.log(`Socket ${socket.id} registrato come: ${role}`);
        socket.join(role);
        
        // Se è il GM, inviagli subito i dati aggiornati
        if (role === 'gm') {
            socket.emit('admin_data_update', { objects, characters, scenes });
            socket.emit('media_list_update', getMediaFiles());
        }
        // Se è il Tavolo, invia lo stato attuale
        if (role === 'table') {
            socket.emit('table_state_update', tableState);
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
        } else {
            socket.emit('login_error', 'Credenziali non valide');
        }
    });

    // --- GESTIONE DATI (GM) ---
    socket.on('admin_update_data', (data) => {
        if (data.type === 'objects') objects = data.content;
        if (data.type === 'characters') characters = data.content;
        saveData();
        // Notifica il GM che il salvataggio è avvenuto
        socket.emit('admin_data_update', { objects, characters, scenes });
        // Opzionale: Notifica i player se i loro dati sono cambiati
        if (data.type === 'characters') {
            io.to('player').emit('player_data_update', characters);
        }
    });

    // --- GESTIONE SCENE (GM) ---
    socket.on('admin_scene_action', (action) => {
        if (action.type === 'save') {
            // Usa il nome come ID (slugified) per facilitare il linking
            const id = action.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)+/g, '');
            
            // Rimuovi se esiste già
            scenes = scenes.filter(s => s.id !== id);

            const newScene = {
                id: id,
                name: action.name,
                objects: tableState.activeObjects,
                mood: moodState.imageUrl // Save current mood
            };
            scenes.push(newScene);
            saveData();
            socket.emit('admin_data_update', { objects, characters, scenes });
        } else if (action.type === 'load') {
            const scene = scenes.find(s => s.id === action.id);
            if (scene) {
                tableState.activeObjects = JSON.parse(JSON.stringify(scene.objects)); // Deep copy
                io.to('table').emit('table_state_update', tableState);
                
                // Load mood if present
                if (scene.mood) {
                    moodState.imageUrl = scene.mood;
                    io.emit('mood_state_update', moodState.imageUrl);
                }
                
                // Sync GM preview too
                socket.emit('table_state_update', tableState); 
            }
        } else if (action.type === 'delete') {
            scenes = scenes.filter(s => s.id !== action.id);
            saveData();
            socket.emit('admin_data_update', { objects, characters, scenes });
        }
    });

    // --- GESTIONE HACKING (GM) ---
    socket.on('gm_hacking_action', (action) => {
        if (action.type === 'start') {
            hackingState = {
                active: true,
                password: action.password.toUpperCase(),
                dc: parseInt(action.dc) || 15,
                complexity: parseInt(action.complexity) || 3,
                revealedIndices: [],
                attempts: 0
            };
            // Invia stato iniziale ai player
            io.to('player').emit('player_hacking_update', getPublicHackingState());
            // Conferma al GM
            socket.emit('gm_hacking_update', hackingState);
        
        } else if (action.type === 'check') {
            if (!hackingState.active) return;
            
            hackingState.attempts++;
            const roll = parseInt(action.roll);
            const diff = roll - hackingState.dc;
            
            if (diff < 0) {
                // Fallimento
                io.to('player').emit('player_hacking_result', { success: false, message: 'ACCESS DENIED' });
                socket.emit('gm_hacking_log', 'Check Failed: ' + roll + ' vs DC ' + hackingState.dc);
            } else {
                // Successo -> Avvia Minigame
                // Difficoltà minigame basata sul margine di successo
                // Margine alto = Gioco più facile (es. velocità minore, gap più larghi)
                const difficulty = Math.max(0, 10 - diff); // Più basso è meglio
                
                // Calcolo numero anelli: Rimuovi 1 anello ogni 5 punti di margine
                const ringsRemoved = Math.floor(diff / 5);
                const numRings = Math.max(1, (hackingState.complexity || 3) - ringsRemoved);

                io.to('player').emit('start_minigame', { 
                    type: 'CIRCLE', 
                    difficulty: difficulty,
                    rings: numRings,
                    margin: diff
                });
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
            
            // Aggiorna il GM e gli altri tavoli
            io.to('gm').emit('sync_object', data);
            socket.broadcast.to('table').emit('sync_object', data);
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
        }
    });
    
    // --- CHAT & TIME ---
    socket.on('chat_message', (msg) => {
        // msg: { sender: 'GM' | 'PlayerName', text: '...' }
        const isAdmin = socket.rooms.has('gm');
        const fullMsg = { ...msg, timestamp: Date.now(), isAdmin: isAdmin };
        chatHistory.push(fullMsg);
        if (chatHistory.length > 50) chatHistory.shift(); // Keep last 50
        io.emit('chat_update', fullMsg);
    });

    socket.on('admin_time_action', (action) => {
        if (action.type === 'set') {
            timeState.year = parseInt(action.year);
            timeState.day = parseInt(action.day);
            timeState.hour = parseInt(action.hour);
            timeState.minute = parseInt(action.minute);
        } else if (action.type === 'scramble') {
            timeState.scrambled = action.value;
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
