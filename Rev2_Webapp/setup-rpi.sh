#!/bin/bash
# =============================================================
# SIT (Starfinder Interactive Table) — Server RPi Setup Script
# =============================================================
# Sets up a HEADLESS server RPi. No display, no kiosk.
# For the display RPi, use setup-rpi-display.sh instead.
#
# Run on a fresh Raspbian/Raspberry Pi OS (Bookworm or later).
# Usage:  chmod +x setup-rpi.sh && sudo ./setup-rpi.sh
# =============================================================

set -e

APP_DIR="/opt/sit"
APP_USER="sit"
REPO_URL=""  # Set this to your git repo URL if you want auto-clone

echo "============================================"
echo " SIT — Server RPi Setup (headless)"
echo "============================================"
echo ""

# --- 1. System update ---
echo "[1/5] Updating system packages..."
apt-get update -qq && apt-get upgrade -y -qq

# --- 2. Install Node.js (LTS) ---
echo "[2/5] Installing Node.js LTS..."
if ! command -v node &> /dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_lts.x | bash -
    apt-get install -y nodejs
fi
echo "       Node.js $(node -v) installed"
echo "       npm $(npm -v) installed"

# --- 3. Install minimal packages (no GUI, no Chromium) ---
echo "[3/5] Installing utilities..."
apt-get install -y --no-install-recommends git

# --- 4. Create app user and directory ---
echo "[4/5] Setting up application directory..."
if ! id "$APP_USER" &>/dev/null; then
    useradd -r -s /bin/bash -d "$APP_DIR" "$APP_USER"
fi

mkdir -p "$APP_DIR"

# If project files aren't there yet, guide the user
if [ ! -f "$APP_DIR/server.js" ]; then
    echo ""
    echo "  ┌─────────────────────────────────────────────┐"
    echo "  │  Copy your SIT project files to: $APP_DIR   │"
    echo "  │                                             │"
    echo "  │  From your PC, run:                         │"
    echo "  │  scp -r Rev2_Webapp/* pi@<IP>:$APP_DIR/     │"
    echo "  │                                             │"
    echo "  │  Then re-run this script.                   │"
    echo "  └─────────────────────────────────────────────┘"
    echo ""
    if [ -z "$REPO_URL" ]; then
        echo "  (Or set REPO_URL in this script for auto-clone)"
        chown -R "$APP_USER:$APP_USER" "$APP_DIR"
        exit 0
    else
        echo "  Cloning from $REPO_URL..."
        git clone "$REPO_URL" "$APP_DIR"
    fi
fi

chown -R "$APP_USER:$APP_USER" "$APP_DIR"

# --- 5. Install npm dependencies + create service ---
echo "[5/5] Installing npm dependencies & creating service..."
cd "$APP_DIR"
sudo -u "$APP_USER" npm install --production

cat > /etc/systemd/system/sit.service << 'EOF'
[Unit]
Description=Starfinder Interactive Table (SIT)
After=network.target

[Service]
Type=simple
User=sit
WorkingDirectory=/opt/sit
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=SIT_PORT=3000
Environment=SIT_HOST=0.0.0.0

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=sit

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable sit.service
systemctl start sit.service

LAN_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "============================================"
echo " SIT Server Setup Complete!"
echo "============================================"
echo ""
echo " Server:  http://${LAN_IP}:3000"
echo " Admin:   http://${LAN_IP}:3000/admin.html"
echo " Player:  http://${LAN_IP}:3000/player.html"
echo ""
echo " Commands:"
echo "   sudo systemctl status sit     — Check status"
echo "   sudo systemctl restart sit    — Restart server"
echo "   sudo systemctl stop sit       — Stop server"
echo "   sudo journalctl -u sit -f     — View live logs"
echo ""
echo " Next: set up your display RPi with setup-rpi-display.sh"
echo "   pointing at http://${LAN_IP}:3000"
echo "============================================"
