#!/bin/bash
# =============================================================
# SIT — Update Script (Linux / macOS / RPi)
# =============================================================
# Pulls latest app code from git without touching campaign data.
# Usage: chmod +x update.sh && ./update.sh
# =============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "  ┌─────────────────────────────────────────────┐"
echo "  │  SIT — Update                               │"
echo "  └─────────────────────────────────────────────┘"
echo ""

# Safety check
if [ ! -f "server.js" ]; then
    echo "ERROR: Run this from the SIT project directory."
    exit 1
fi

# Check campaign/ exists (user data)
if [ -d "campaign" ]; then
    echo "  ✓ Campaign data found (will NOT be touched)"
else
    echo "  ℹ No campaign/ folder yet (will be created on next server start)"
fi

# Pull latest code
echo ""
echo "  Pulling latest code..."
git pull --ff-only
PULL_STATUS=$?

if [ $PULL_STATUS -ne 0 ]; then
    echo ""
    echo "  ⚠ Git pull failed. You may have local changes."
    echo "    Try: git stash && ./update.sh && git stash pop"
    exit 1
fi

# Install/update dependencies
echo "  Installing dependencies..."
npm install --production
echo ""

# Restart service if running as systemd
if systemctl is-active --quiet sit 2>/dev/null; then
    echo "  Restarting SIT service..."
    sudo systemctl restart sit
    echo "  ✓ Service restarted"
else
    echo "  ℹ No systemd service detected. Restart manually:"
    echo "    node server.js"
fi

echo ""
echo "  ✓ Update complete!"
echo ""
