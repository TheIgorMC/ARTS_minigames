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
let tableState = {
    background: null,
    activeObjects: [] // { instanceId, ...objData, x, y }
};

function loadData() {
    try {
        objects = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'objects.json')));
        characters = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'characters.json')));
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
        console.log('Dati salvati.');
    } catch (e) {
        console.error('Errore salvataggio dati:', e);
    }
}

// Servi i file statici dalla cartella 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Gestione connessioni Socket.io
io.on('connection', (socket) => {
    console.log('Un client si è connesso: ' + socket.id);

    // 1. Identificazione Ruolo (GM, Table, Player)
    socket.on('join', (role) => {
        console.log(`Socket ${socket.id} registrato come: ${role}`);
        socket.join(role);
        
        // Se è il GM, inviagli subito i dati aggiornati
        if (role === 'gm') {
            socket.emit('admin_data_update', { objects, characters });
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
        socket.emit('admin_data_update', { objects, characters });
        // Opzionale: Notifica i player se i loro dati sono cambiati
        if (data.type === 'characters') {
            io.to('player').emit('player_data_update', characters);
        }
    });

    // --- GESTIONE MAPPA (GM) ---
    socket.on('admin_map_action', (action) => {
        console.log('Map Action:', action);
        if (action.type === 'spawn') {
            const objDef = objects.find(o => o.id === action.objectId);
            if (objDef) {
                const instance = { 
                    instanceId: Date.now().toString() + Math.random().toString(36).substr(2, 5), 
                    ...objDef, 
                    x: action.x || 100, 
                    y: action.y || 100 
                };
                tableState.activeObjects.push(instance);
            }
        } else if (action.type === 'clear') {
            tableState.activeObjects = [];
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
    socket.on('table_object_move', (data) => {
        // data: { id: instanceId, x, y }
        const obj = tableState.activeObjects.find(o => o.instanceId === data.id);
        if (obj) {
            obj.x = data.x;
            obj.y = data.y;
            // Aggiorna il GM (opzionale)
            io.to('gm').emit('sync_object', data);
        }
    });
});

// Avvia il server sulla porta 3000
// '0.0.0.0' permette connessioni dalla rete locale
http.listen(3000, '0.0.0.0', () => {
    console.log('Server attivo su porta 3000');
});
