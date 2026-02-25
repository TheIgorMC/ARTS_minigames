#!/bin/bash
# =============================================================
# SIT — Display RPi Setup Script (Kiosk Mode)
# =============================================================
# Sets up a Raspberry Pi as a DISPLAY-ONLY client.
# Opens Chromium in full-screen kiosk mode pointing at the
# SIT server running on a DIFFERENT machine (PC or server RPi).
#
# Run on a fresh Raspbian/Raspberry Pi OS (Bookworm or later).
# Usage:  chmod +x setup-rpi-display.sh
#         sudo ./setup-rpi-display.sh <SERVER_IP>
#
# Example: sudo ./setup-rpi-display.sh 192.168.1.50
# =============================================================

set -e

if [ -z "$1" ]; then
    echo ""
    echo "  Usage: sudo ./setup-rpi-display.sh <SERVER_IP> [PORT] [PAGE]"
    echo ""
    echo "  Examples:"
    echo "    sudo ./setup-rpi-display.sh 192.168.1.50"
    echo "    sudo ./setup-rpi-display.sh 192.168.1.50 3000 player.html"
    echo "    sudo ./setup-rpi-display.sh 192.168.1.50 3000 mood.html"
    echo ""
    exit 1
fi

SERVER_IP="$1"
SERVER_PORT="${2:-3000}"
PAGE="${3:-player.html}"
SERVER_URL="http://${SERVER_IP}:${SERVER_PORT}/${PAGE}"

echo "============================================"
echo " SIT — Display RPi Setup (kiosk)"
echo "============================================"
echo ""
echo " Server URL: $SERVER_URL"
echo ""

# --- 1. System update ---
echo "[1/4] Updating system packages..."
apt-get update -qq && apt-get upgrade -y -qq

# --- 2. Install display packages ---
echo "[2/4] Installing Chromium & display utilities..."
apt-get install -y --no-install-recommends \
    chromium-browser \
    unclutter \
    xdotool

# --- 3. Create autostart entry ---
echo "[3/4] Setting up kiosk auto-start..."

# Support both 'pi' user and current user
KIOSK_USER="${SUDO_USER:-pi}"
KIOSK_HOME=$(eval echo "~$KIOSK_USER")
KIOSK_DIR="$KIOSK_HOME/.config/autostart"
mkdir -p "$KIOSK_DIR"

cat > "$KIOSK_DIR/sit-kiosk.desktop" << EOF
[Desktop Entry]
Type=Application
Name=SIT Display
Comment=Starfinder Interactive Table — Player/Mood Display
Exec=bash -c 'sleep 8 && unclutter -idle 3 & chromium-browser --noerrdialogs --disable-infobars --kiosk --disable-session-crashed-bubble --disable-component-update --disable-translate --no-first-run --start-fullscreen $SERVER_URL'
X-GNOME-Autostart-enabled=true
EOF

chown "$KIOSK_USER:$KIOSK_USER" "$KIOSK_DIR/sit-kiosk.desktop"

# --- 4. Create manual launch script ---
echo "[4/4] Creating manual launch script..."

cat > "/home/$KIOSK_USER/start-kiosk.sh" << 'SCRIPT'
#!/bin/bash
# Launch SIT display in kiosk mode
# Usage: ./start-kiosk.sh [URL]
# Default URL is read from the autostart .desktop file

DEFAULT_URL="PLACEHOLDER_URL"
URL="${1:-$DEFAULT_URL}"

echo ""
echo "  ┌─────────────────────────────────────────────┐"
echo "  │  SIT — Starting Kiosk Display               │"
echo "  │  URL: $URL"
echo "  │  Press Ctrl+F4 to exit                      │"
echo "  └─────────────────────────────────────────────┘"
echo ""

# Hide cursor after 3 seconds of inactivity
unclutter -idle 3 &
UNCLUTTER_PID=$!

chromium-browser \
    --noerrdialogs \
    --disable-infobars \
    --kiosk \
    --disable-session-crashed-bubble \
    --disable-component-update \
    --disable-translate \
    --no-first-run \
    --start-fullscreen \
    "$URL"

kill $UNCLUTTER_PID 2>/dev/null
SCRIPT

# Replace placeholder with actual URL
sed -i "s|PLACEHOLDER_URL|$SERVER_URL|g" "/home/$KIOSK_USER/start-kiosk.sh"
chmod +x "/home/$KIOSK_USER/start-kiosk.sh"
chown "$KIOSK_USER:$KIOSK_USER" "/home/$KIOSK_USER/start-kiosk.sh"

# --- Disable screen blanking / screensaver ---
# For Wayland (Bookworm default)
if [ -f "$KIOSK_HOME/.config/wayfire.ini" ]; then
    if ! grep -q "dpms_timeout" "$KIOSK_HOME/.config/wayfire.ini" 2>/dev/null; then
        cat >> "$KIOSK_HOME/.config/wayfire.ini" << 'EOF'

[idle]
dpms_timeout=0
screensaver_timeout=0
EOF
    fi
fi

# For X11 (older Pi OS)
XPROFILE="$KIOSK_HOME/.xprofile"
if [ ! -f "$XPROFILE" ] || ! grep -q "xset s off" "$XPROFILE" 2>/dev/null; then
    cat >> "$XPROFILE" << 'EOF'
# Disable screen blanking for SIT kiosk
xset s off
xset -dpms
xset s noblank
EOF
    chown "$KIOSK_USER:$KIOSK_USER" "$XPROFILE"
fi

echo ""
echo "============================================"
echo " SIT Display Setup Complete!"
echo "============================================"
echo ""
echo " Pointing at: $SERVER_URL"
echo ""
echo " The display will auto-start on next reboot."
echo ""
echo " Manual control:"
echo "   ~/start-kiosk.sh                     — Start kiosk"
echo "   ~/start-kiosk.sh http://..../mood.html  — Different page"
echo "   Ctrl+F4                              — Exit kiosk"
echo ""
echo " To change the server URL later, re-run:"
echo "   sudo ./setup-rpi-display.sh <NEW_IP>"
echo "============================================"
