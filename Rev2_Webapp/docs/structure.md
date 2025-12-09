# Progetto: Starfinder Interactive Table (SIT)

**Versione:** 1.0 (Architecture A: PC Host / RPi Client)

## 1\. Panoramica Architettura

Il sistema serve a gestire enigmi interattivi e scenografie tattiche proiettate su un tavolo fisico, controllate via mouse dai giocatori tramite una Raspberry Pi, ma gestite da un server centrale sul PC del GM.

  * **Server (Host):** Il tuo PC principale. Esegue Node.js. Gestisce la logica, serve i file e sincronizza gli eventi.
  * **Client (Player View):** Raspberry Pi 4/5. Esegue Chromium in modalità Kiosk. Visualizza l'interfaccia e gestisce l'input del mouse dei giocatori.
  * **Controller (GM View):** Il tuo PC (browser separato). Un pannello di controllo per cambiare scena, resettare enigmi, ecc.

-----

## 2\. Tech Stack

  * **Runtime:** [Node.js](https://nodejs.org/) (Javascript server-side).
  * **Framework Web:** [Express](https://expressjs.com/) (Per servire le pagine HTML).
  * **Real-time Comm:** [Socket.io](https://socket.io/) (Per comunicazione istantanea Server \<-\> RPi).
  * **Graphics Engine:** [Konva.js](https://konvajs.org/) (Canvas 2D library per alte prestazioni e drag-and-drop facile).

-----

## 3\. Setup del Progetto (Sul PC)

### Struttura Cartelle

```text
/starfinder-table
  ├── package.json      (Dipendenze)
  ├── server.js         (Il cervello del sistema)
  └── public            (Cartella accessibile ai client)
      ├── index.html    (La vista del Tavolo/RPi)
      ├── admin.html    (La vista del GM)
      ├── style.css     (Stile Sci-Fi)
      └── assets        (Immagini: mappe, oggetti, fusibili)
```

### Installazione Dipendenze

Apri il terminale nella cartella e lancia:

```bash
npm init -y
npm install express socket.io
```

-----

## 4\. Implementazione Codice

### A. Il Backend (`server.js`)

Questo script avvia il server web e gestisce i messaggi tra GM e Tavolo.

```javascript
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

    // Evento: Il GM cambia la scena
    socket.on('gm_change_scene', (data) => {
        console.log('Cambio scena:', data);
        // Invia comando a TUTTI i client (inclusa la RPi)
        io.emit('load_scene', data);
    });

    // Evento: I giocatori muovono un oggetto (opzionale, per salvare lo stato)
    socket.on('player_object_move', (data) => {
        // Puoi usare questo per vedere sul tuo PC cosa fanno i giocatori
        socket.broadcast.emit('sync_object', data);
    });
});

// Avvia il server sulla porta 3000
// '0.0.0.0' permette connessioni dalla rete locale
http.listen(3000, '0.0.0.0', () => {
    console.log('Server attivo su porta 3000');
});
```

### B. Il Frontend Tavolo (`public/index.html`)

Questa è la pagina che verrà caricata dalla Raspberry Pi. Usa Konva.js per la grafica.

```html
<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <title>Starfinder Table Interface</title>
    <style>
        body { margin: 0; padding: 0; overflow: hidden; background-color: #000; }
        #container { width: 100vw; height: 100vh; }
    </style>
    <script src="https://unpkg.com/konva@9/konva.min.js"></script>
    <script src="/socket.io/socket.io.js"></script>
</head>
<body>
    <div id="container"></div>

    <script>
        // 1. Connessione al Server
        const socket = io();

        // 2. Setup Canvas (Konva)
        var width = window.innerWidth;
        var height = window.innerHeight;

        var stage = new Konva.Stage({
            container: 'container',
            width: width,
            height: height
        });

        var layer = new Konva.Layer();
        stage.add(layer);

        // Funzione per creare un oggetto trascinabile (es. un fusibile)
        function spawnObject(x, y, color) {
            var box = new Konva.Rect({
                x: x,
                y: y,
                width: 100,
                height: 100,
                fill: color,
                draggable: true, // Magia: permette il drag-and-drop
                stroke: '#00D2FF', // Bordo neon sci-fi
                strokeWidth: 4
            });

            // Effetti visivi durante il trascinamento
            box.on('dragstart', function() {
                this.shadowBlur(20);
                this.shadowColor('#00D2FF');
            });
            
            box.on('dragend', function() {
                this.shadowBlur(0);
                // Invia la nuova posizione al server (opzionale)
                socket.emit('player_object_move', { x: this.x(), y: this.y() });
            });

            layer.add(box);
        }

        // 3. Ascolto comandi dal Server (GM)
        socket.on('load_scene', (sceneData) => {
            layer.destroyChildren(); // Pulisce il tavolo
            
            if (sceneData.type === 'hacking') {
                // Esempio: crea 3 oggetti da hackerare
                spawnObject(100, 100, 'red');
                spawnObject(300, 100, 'blue');
                spawnObject(500, 100, 'green');
            }
            layer.draw();
        });

        // Messaggio di benvenuto / Standby
        var text = new Konva.Text({
            x: 50, y: 50,
            text: 'TERMINALE IN ATTESA DI INPUT...',
            fontSize: 40,
            fontFamily: 'Courier New',
            fill: '#00D2FF'
        });
        layer.add(text);
        layer.draw();

    </script>
</body>
</html>
```

### C. Il Pannello GM (`public/admin.html`)

Un semplice telecomando per te.

```html
<!DOCTYPE html>
<html>
<body>
    <h1>GM Control Panel</h1>
    <button onclick="triggerScene('hacking')">Lancia Scenario: Hacking</button>
    <button onclick="triggerScene('reset')">Reset Tavolo</button>

    <script src="/socket.io/socket.io.js"></script>
    <script>
        const socket = io();
        function triggerScene(type) {
            socket.emit('gm_change_scene', { type: type });
        }
    </script>
</body>
</html>
```

-----

## 5\. Configurazione Raspberry Pi (Client)

### Step 1: Networking

Assicurati che la RPi sia connessa allo stesso Wi-Fi/Ethernet del PC.

### Step 2: Auto-Start in Kiosk Mode

Sul desktop della Raspberry Pi (o via SSH), modifica il file di autostart.
*Percorso tipico su Raspberry Pi OS:* `~/.config/wayfire.ini` (per versioni nuove con Wayland) o `~/.config/lxsession/LXDE-pi/autostart` (per X11).

Comando da aggiungere (sostituisci `192.168.1.X` con l'IP del tuo PC):

```bash
# Disabilita screensaver
@xset s off
@xset -dpms
@xset s noblank

# Avvia Chromium in full screen senza barre
chromium-browser --noerrdialogs --disable-infobars --kiosk http://192.168.1.X:3000
```

-----

## 6\. Troubleshooting Comune

1.  **Windows Firewall:** È la causa \#1 di fallimento. Devi creare una regola in entrata per la porta TCP 3000 o permettere a Node.js di comunicare su reti private.
2.  **Risoluzione Schermo:** Se il proiettore ha una risoluzione diversa dal monitor PC, Konva.js potrebbe aver bisogno di adattarsi. Usa `window.innerWidth` come nello script sopra per adattarsi automaticamente alla RPi.
3.  **Mouse Lag:** Se il mouse sulla RPi sembra lento, assicurati che la RPi non stia facendo aggiornamenti in background. Una RPi 4 regge benissimo questo carico.