# SIT — Starfinder Interactive Table

**Version 2.0.0** · Node.js + Express + Socket.io

SIT is a self-hosted web app for running **Starfinder RPG sessions** on a physical table. A GM controls the session from a browser (admin panel), while players interact via another browser (player panel) — typically displayed on a TV or projector connected to a Raspberry Pi.

---

## Table of Contents

- [Features](#features)
- [Requirements](#requirements)
- [Quick Start (Windows / macOS / Linux)](#quick-start)
- [Raspberry Pi Deployment](#raspberry-pi-deployment)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [Campaign Data](#campaign-data)
- [Media & Scenes](#media--scenes)
- [Updating the App](#updating-the-app)
- [Backup & Restore](#backup--restore)
- [Importing Game Data](#importing-game-data)
- [Troubleshooting](#troubleshooting)

---

## Features

| Area | Capabilities |
|------|-------------|
| **Characters** | Full PC creation (race, class, theme, stats, feats, spells), NPC management, companion/pet system, level-up wizard, Hephaistos JSON importer |
| **Combat** | Initiative tracker, HP/SP/RP bars, conditions, NPC stat blocks |
| **Items & Shops** | 5 000+ item database (weapons, armor, tech, magic, augments, fusions, goods) with source-book filtering, shop system with buy/sell |
| **Spells** | Full spell database with class/level filtering, spell slot tracking |
| **Scenes** | Background images, mood overlays, draggable objects on a Konva.js canvas, per-scene data |
| **Roleplay** | Character art display, talking indicators, mood lighting |
| **Comms** | In-character group chat, direct messages, GM broadcast |
| **Quests** | Quest tracker with sub-quests, linked quests, status/priority |
| **Map / Encounters / Play** | Extensible tabs for future features |
| **Settings** | Session logs, database editor, campaign source filtering |

---

## Requirements

| Component | Minimum |
|-----------|---------|
| **Node.js** | v18.0.0 or later |
| **npm** | v9+ (ships with Node 18) |
| **Browser** | Any modern Chromium-based browser (Chrome, Edge, Brave) or Firefox |
| **OS** | Windows 10+, macOS 12+, Linux (incl. Raspberry Pi OS) |

---

## Quick Start

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd ARTS_minigames/Rev2_Webapp
```

### 2. Install dependencies

```bash
npm install
```

### 3. Start the server

```bash
# Production
npm start

# Development (auto-restart on file changes)
npm run dev
```

### 4. Open in browser

| Page | URL | Purpose |
|------|-----|---------|
| **Admin** | `http://localhost:3000/admin.html` | GM control panel |
| **Player** | `http://localhost:3000/player.html` | Player-facing view |
| **Mood** | `http://localhost:3000/mood.html` | Roleplay/mood display |
| **Table** | `http://localhost:3000/` | Konva.js canvas (legacy) |

> **First run:** The server automatically creates a `campaign/` folder from the bundled `defaults/` templates. No manual setup needed.

---

## Raspberry Pi Deployment

SIT uses a **two-RPi architecture** — the server and display run on separate devices:

| RPi | Role | Script | Needs GUI? |
|-----|------|--------|------------|
| **Server RPi** | Runs Node.js, hosts the app, stores campaign data | `setup-rpi.sh` | No (headless) |
| **Display RPi** | Shows player/mood view on a TV/projector via kiosk Chromium | `setup-rpi-display.sh` | Yes (desktop) |

### Server RPi Setup

Run on a fresh Raspberry Pi OS (Bookworm or later). Can be Lite (no desktop):

```bash
chmod +x setup-rpi.sh
sudo ./setup-rpi.sh
```

This script:
1. Updates the system and installs Node.js LTS
2. Installs git (no GUI packages)
3. Creates a `sit` system user and `/opt/sit` directory
4. Installs npm dependencies
5. Creates a **systemd service** (`sit.service`) for auto-start on boot

#### Server Service Commands

```bash
sudo systemctl status sit        # Check server status
sudo systemctl restart sit       # Restart the server
sudo systemctl stop sit          # Stop the server
sudo journalctl -u sit -f        # Live log output
```

### Display RPi Setup

Run on a **separate** RPi connected to your TV/projector via HDMI. Requires desktop (not Lite):

```bash
chmod +x setup-rpi-display.sh
sudo ./setup-rpi-display.sh <SERVER_IP> [PORT] [PAGE]
```

**Examples:**

```bash
# Player view (default)
sudo ./setup-rpi-display.sh 192.168.1.50

# Mood/roleplay display
sudo ./setup-rpi-display.sh 192.168.1.50 3000 mood.html

# Custom port
sudo ./setup-rpi-display.sh 192.168.1.50 8080
```

This script:
1. Installs Chromium + display utilities (unclutter, xdotool)
2. Creates an autostart entry for full-screen kiosk mode
3. Disables screen blanking / screensaver
4. Creates `~/start-kiosk.sh` for manual launch

#### Display Commands

```bash
~/start-kiosk.sh                                        # Start kiosk (default page)
~/start-kiosk.sh http://192.168.1.50:3000/mood.html     # Different page
# Ctrl+F4                                               # Exit kiosk
```

#### Changing the Server URL

If the server IP changes, re-run the display setup:

```bash
sudo ./setup-rpi-display.sh <NEW_IP>
```

---

## Project Structure

```
Rev2_Webapp/
├── server.js               # Main application server (~1600 lines)
├── config.js               # All configuration (paths, ports, etc.)
├── package.json            # Dependencies and scripts
├── .gitignore              # Excludes campaign/ from version control
│
├── public/                 # Static files served to browsers
│   ├── admin.html          # GM control panel (single-page app)
│   ├── player.html         # Player-facing interface
│   ├── mood.html           # Roleplay/mood display
│   ├── admin_login.html    # Admin login page
│   ├── index.html          # Konva.js canvas (legacy table view)
│   ├── style.css           # Shared base styles
│   └── assets/             # Static images for the UI
│
├── campaign/               # ⬅ ALL USER DATA (gitignored)
│   ├── data/               # JSON data files
│   │   ├── characters.json # Player characters + NPCs
│   │   ├── items.json      # Item database
│   │   ├── spells.json     # Spell database
│   │   ├── objects.json    # Draggable scene objects
│   │   ├── quests.json     # Quest tracker
│   │   ├── shops.json      # Shop inventories
│   │   ├── scenes.json     # Scene configuration
│   │   ├── status.json     # Session state (time, mood, identities, etc.)
│   │   ├── ruleset.json    # Custom rules/config
│   │   ├── ignored.json    # Filtered source books
│   │   └── chat_logs.txt   # Chat history
│   └── media/              # Images and scene assets
│       ├── [00]Global/     # Shared assets (available in all scenes)
│       ├── [01]Scene Name/ # Per-scene folders
│       ├── [CHAR] Character pictures/  # Character art
│       └── Gemini_Map.png  # Example map file
│
├── defaults/               # Template files for first-run bootstrap
│   ├── data/               # Empty/starter JSON files
│   └── media/              # README with folder naming conventions
│
├── import_items.js         # Item database importer (Foundry VTT)
├── import_spells.js        # Spell database importer (Foundry VTT)
│
├── setup-rpi.sh            # Server RPi setup (headless, systemd)
├── setup-rpi-display.sh    # Display RPi setup (kiosk Chromium)
├── update.sh               # Linux/macOS update script
├── update.ps1              # Windows update script
│
└── docs/                   # Documentation
    ├── README.md           # This file
    ├── STYLE_GUIDE.md      # Visual style reference
    └── structure.md        # Original architecture notes (Italian)
```

---

## Configuration

All settings live in **`config.js`**. You can override any value with environment variables.

| Setting | Default | Env Variable | Description |
|---------|---------|-------------|-------------|
| `PORT` | `3000` | `SIT_PORT` | HTTP server port |
| `HOST` | `0.0.0.0` | `SIT_HOST` | Bind address (`0.0.0.0` = all interfaces) |
| `CAMPAIGN_DIR` | `./campaign` | `SIT_CAMPAIGN_DIR` | Path to campaign data folder |
| `DATA_SUBDIR` | `data` | — | Subfolder inside campaign for JSON files |
| `MEDIA_SUBDIR` | `media` | — | Subfolder inside campaign for images |
| `DEFAULTS_DIR` | `./defaults` | — | Template files for first-run |
| `LOG_LEVEL` | `normal` | `SIT_LOG_LEVEL` | `verbose` / `normal` / `quiet` |

### Example: Custom campaign path

```bash
# Linux / macOS
SIT_CAMPAIGN_DIR=/mnt/usb/my-campaign node server.js

# Windows PowerShell
$env:SIT_CAMPAIGN_DIR = "D:\RPG\my-campaign"; node server.js
```

---

## Campaign Data

### The Golden Rule

> **All user data lives inside `campaign/`.** This is the ONE folder you need to care about.

The `campaign/` folder is **gitignored**, which means:
- `git pull` will **never** overwrite your characters, items, quests, or media
- You can safely update the app code without affecting your campaign
- To move your campaign to another machine, just copy the `campaign/` folder

### Data Files Reference

| File | Contents | Format |
|------|----------|--------|
| `characters.json` | All PCs and NPCs | Array of character objects |
| `items.json` | Item database (weapons, armor, etc.) | Array of item objects |
| `spells.json` | Spell database | Array of spell objects |
| `objects.json` | Draggable scene objects | Array of object definitions |
| `quests.json` | Quest tracker entries | Array of quest objects |
| `shops.json` | Shop inventories | Array of shop objects |
| `scenes.json` | Scene names and state | Array of scene objects |
| `status.json` | Live session state | Object with time, mood, roleplay, identities, conversations, campaignSettings |
| `ruleset.json` | Custom campaign rules | Object |
| `ignored.json` | Filtered source books | Array of book codes |
| `chat_logs.txt` | Chat message history | Newline-delimited text |

### First Run Behavior

On first start, if `campaign/` doesn't exist, the server:
1. Creates `campaign/data/` and `campaign/media/`
2. Copies template files from `defaults/data/` (empty arrays, base status template)
3. Copies the media README from `defaults/media/`
4. Logs each copied file to the console

---

## Media & Scenes

### Folder Naming Convention

Scene folders inside `campaign/media/` follow a numbered prefix pattern:

```
[00]Global/               ← Shared assets (always available)
[01]Verros Office/         ← Scene 1
[02]Reactor/               ← Scene 2
[03]Botanical Garden/      ← Scene 3
[CHAR] Character pictures/ ← Character portrait art
```

### File Prefixes Inside Scene Folders

| Prefix | Purpose | Example |
|--------|---------|---------|
| `[BG]` | Background image (full-screen) | `[BG]office_bg.png` |
| `[MOOD]` | Mood overlay image | `[MOOD]dark_lighting.png` |
| *(none)* | Draggable table object | `datapad.png` |

### Adding a New Scene

1. Create a folder in `campaign/media/` with the naming convention: `[##]Scene Name/`
2. Add a `[BG]background.png` file for the scene background
3. Add optional `[MOOD]` overlay images
4. Add any object images (without prefix) for draggable items
5. Optionally create a `scene.json` inside the folder for scene-specific data
6. Restart the server or use the admin panel to refresh scenes

### Character Pictures

Place character art in `campaign/media/[CHAR] Character pictures/`. File names should match the character name for auto-detection by the admin panel's scan feature.

---

## Updating the App

### Method 1: Update Scripts (Recommended)

```bash
# Linux / macOS / RPi
chmod +x update.sh
./update.sh

# Windows PowerShell
.\update.ps1
```

These scripts:
1. Pull latest code with `git pull --ff-only` (safe — no force)
2. Install/update npm dependencies
3. Restart the systemd service (Linux) or prompt manual restart (Windows)
4. **Never touch `campaign/`**

### Method 2: Manual

```bash
git pull --ff-only
npm install --production
# Restart the server
```

### What Gets Updated vs. What Doesn't

| Updated by `git pull` | NOT touched |
|----------------------|-------------|
| `server.js` | `campaign/data/*` |
| `public/*.html` | `campaign/media/*` |
| `config.js` structure | Your config values (env vars) |
| `defaults/*` | `node_modules/` |
| `import_*.js` | |
| `setup-rpi.sh`, `update.*` | |

### Handling Conflicts

If `git pull --ff-only` fails, you have local changes to tracked files:

```bash
# Option A: Stash and re-apply
git stash
git pull --ff-only
git stash pop

# Option B: Discard local changes (careful!)
git checkout -- .
git pull --ff-only
```

---

## Backup & Restore

### Backup

Copy the entire `campaign/` folder:

```bash
# Linux / macOS
cp -r campaign/ ~/backups/sit-campaign-$(date +%Y%m%d)/

# Windows PowerShell
Copy-Item -Recurse campaign\ "$env:USERPROFILE\Backups\sit-campaign-$(Get-Date -Format yyyyMMdd)\"
```

### Restore

Replace the `campaign/` folder with the backup:

```bash
# Linux / macOS
rm -rf campaign/
cp -r ~/backups/sit-campaign-20260225/ campaign/

# Windows PowerShell
Remove-Item -Recurse -Force campaign\
Copy-Item -Recurse "$env:USERPROFILE\Backups\sit-campaign-20260225\" campaign\
```

### Transfer to Another Machine

1. On the source machine: zip `campaign/`
2. On the target machine: clone the repo, `npm install`, paste `campaign/` into the project root
3. Start the server — done

---

## Importing Game Data

SIT ships with importers that convert **Foundry VTT Starfinder** compendium data into SIT format.

### Import Items

```bash
node import_items.js
```

Reads from the Foundry VTT reference data and writes to `campaign/data/items.json`. Supports: weapons, armor, technological items, magic items, consumables, goods, fusions, upgrades, augmentations.

### Import Spells

```bash
node import_spells.js
```

Reads Foundry VTT spell data and writes to `campaign/data/spells.json`.

### Source Book Filtering

The admin panel (Settings tab) lets you filter which source books are active. Filtered books are stored in `campaign/data/ignored.json`. Common book codes:

| Code | Book |
|------|------|
| CRB | Core Rulebook |
| AR | Armory |
| COM | Character Operations Manual |
| AA1–AA4 | Alien Archive 1–4 |
| PW | Pact Worlds |
| NS | Near Space |
| AP | Adventure Paths |

---

## Troubleshooting

### Server won't start

| Symptom | Fix |
|---------|-----|
| `EADDRINUSE` | Another process is using port 3000. Kill it: `Stop-Process -Name node -Force` (Windows) or `killall node` (Linux) |
| `Cannot find module` | Run `npm install` |
| `ENOENT: campaign/data/...` | Delete `campaign/` and restart — it will be recreated from defaults |

### Players can't connect

| Symptom | Fix |
|---------|-----|
| Connection refused | Check Windows Firewall — allow Node.js on TCP 3000 |
| Wrong IP | The startup banner shows the Network URL — use that IP |
| RPi can't reach server | Ensure both devices are on the same network/subnet |

### Media files not loading

| Symptom | Fix |
|---------|-----|
| Images show broken icon | Check file is in `campaign/media/` and refresh the admin scene list |
| Scene not appearing | Ensure folder naming follows `[##]Name/` convention |
| Background not showing | Ensure the file has the `[BG]` prefix |

### Data issues

| Symptom | Fix |
|---------|-----|
| Characters/items missing | Check `campaign/data/` files exist and contain valid JSON |
| Corrupt JSON | Open the file in a text editor, fix syntax (or restore from backup) |
| Changes not saving | Check file permissions on `campaign/` (Linux: `chown -R sit:sit /opt/sit/campaign/`) |

---

## Network Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                         LAN / Wi-Fi                          │
│                                                              │
│   ┌──────────────┐                                           │
│   │  Server RPi   │  (or GM's PC)                            │
│   │  (headless)   │                                          │
│   │               │                                          │
│   │  server.js    │◄──── All clients connect here            │
│   │  :3000        │                                          │
│   │  campaign/    │                                          │
│   └──────┬───────┘                                           │
│          │ HTTP + WebSocket                                  │
│          │                                                   │
│     ┌────┼──────────────┬──────────────┐                     │
│     │    │              │              │                      │
│     ▼    ▼              ▼              ▼                      │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐                │
│   │  GM PC   │   │Display RPi│   │ Phones / │                │
│   │          │   │  (kiosk)  │   │ Tablets   │                │
│   │ admin.   │   │           │   │          │                │
│   │ html     │   │ player.   │   │ player.  │                │
│   │          │   │ html      │   │ html     │                │
│   └──────────┘   └─────┬────┘   └──────────┘                │
│                        │ HDMI                                │
│                  ┌─────┴────┐                                │
│                  │ TV /     │                                │
│                  │ Projector│                                │
│                  └──────────┘                                │
└──────────────────────────────────────────────────────────────┘
```

All communication happens via **Socket.io** (WebSocket with HTTP fallback). The server and display are **separate devices** — the server RPi runs headless (no monitor needed), while the display RPi connects to a TV/projector and runs Chromium in kiosk mode.

---

## License

ISC
