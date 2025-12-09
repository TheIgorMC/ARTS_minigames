const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// Servi i file statici dalla cartella 'public'
app.use(express.static(path.join(__dirname, 'public')));

// Gestione connessioni Socket.io
io.on('connection', (socket) => {
    console.log('Un client si è connesso: ' + socket.id);

    // 1. Identificazione Ruolo (GM, Table, Player)
    socket.on('join', (role) => {
        console.log(`Socket ${socket.id} registrato come: ${role}`);
        socket.join(role);
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
        // Aggiorna il GM (opzionale)
        io.to('gm').emit('sync_object', data);
    });
});

// Avvia il server sulla porta 3000
// '0.0.0.0' permette connessioni dalla rete locale
http.listen(3000, '0.0.0.0', () => {
    console.log('Server attivo su porta 3000');
});
