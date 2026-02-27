#!/bin/bash
# =============================================================
# SIT — Docker deploy/update script (OrangePi / Dockge)
# =============================================================
# First-time setup:
#   1. Add a GitHub deploy key:
#        ssh-keygen -t ed25519 -C "orangepi-sit-deploy" -f ~/.ssh/sit_deploy
#        # Add the PUBLIC key to the repo → Settings → Deploy keys (read-only)
#        # Add to ~/.ssh/config:
#        #   Host github-sit
#        #     HostName github.com
#        #     User git
#        #     IdentityFile ~/.ssh/sit_deploy
#
#   2. Clone (once):
#        git clone git@github-sit:YOUR_USER/ARTS_minigames.git /opt/arts-minigames
#
#   3. Create env file:
#        cp /opt/arts-minigames/Rev2_Webapp/.env.example \
#           /opt/arts-minigames/Rev2_Webapp/.env
#        nano /opt/arts-minigames/Rev2_Webapp/.env   # fill in CAMPAIGN_PATH etc.
#
#   4. Create campaign dir on SSD and seed defaults (first run only):
#        mkdir -p /mnt/ssd/sit-campaign
#        cp -rn /opt/arts-minigames/Rev2_Webapp/defaults/. /mnt/ssd/sit-campaign/
#
#   5. Run this script:
#        chmod +x /opt/arts-minigames/Rev2_Webapp/deploy-docker.sh
#        /opt/arts-minigames/Rev2_Webapp/deploy-docker.sh
#
# Subsequent updates: just run this script again.
# =============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

echo ""
echo "  ┌─────────────────────────────────────────────┐"
echo "  │  SIT — Docker Deploy / Update               │"
echo "  └─────────────────────────────────────────────┘"
echo ""

# ── Sanity checks ─────────────────────────────────────────────────────────────
if [ ! -f "server.js" ]; then
    echo "ERROR: Run this from the Rev2_Webapp directory."
    exit 1
fi

if [ ! -f ".env" ]; then
    echo "ERROR: .env file not found."
    echo "  cp .env.example .env  then fill in CAMPAIGN_PATH."
    exit 1
fi

source .env

if [ -z "$CAMPAIGN_PATH" ]; then
    echo "ERROR: CAMPAIGN_PATH is not set in .env"
    exit 1
fi

# ── Pull latest code from private repo ────────────────────────────────────────
echo "  → Pulling latest code (requires deploy key / SSH agent)..."
# Pull from the repo root to get all subfolders
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
git -C "$REPO_ROOT" pull --ff-only
echo "  ✓ Code up to date"

# ── Ensure campaign dir exists on SSD ─────────────────────────────────────────
echo "  → Checking campaign directory at $CAMPAIGN_PATH ..."
if [ ! -d "$CAMPAIGN_PATH" ]; then
    echo "  ℹ Campaign dir not found, creating and seeding defaults..."
    mkdir -p "$CAMPAIGN_PATH"
    cp -rn "$SCRIPT_DIR/defaults/." "$CAMPAIGN_PATH/"
    echo "  ✓ Seeded from defaults/"
else
    echo "  ✓ Campaign directory exists (data preserved)"
fi

# ── Build & restart container ─────────────────────────────────────────────────
echo "  → Building Docker image..."
docker compose build --no-cache

echo "  → Restarting container..."
docker compose up -d --remove-orphans

echo ""
echo "  ✓ SIT is running on port ${SIT_PORT:-3000}"
echo "  → Logs: docker compose logs -f sit"
echo ""
