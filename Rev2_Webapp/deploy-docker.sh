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
#   2. Clone (once) directly into Dockge's stacks directory:
#        git clone --filter=blob:none --no-checkout --depth=1 \
#            git@github-sit:TheIgorMC/ARTS_minigames.git /opt/stacks/sit
#        cd /opt/stacks/sit
#        git sparse-checkout set Rev2_Webapp compose.yaml .env.example
#        git checkout
#        # compose.yaml is now at /opt/stacks/sit/compose.yaml — Dockge will find it.
#
#   3. Create env file:
#        cp /opt/stacks/sit/.env.example /opt/stacks/sit/.env
#        nano /opt/stacks/sit/.env   # fill in CAMPAIGN_PATH etc.
#
#   4. Create campaign dir on SSD and seed defaults (first run only):
#        mkdir -p /mnt/ssd/sit-campaign
#        cp -rn /opt/stacks/sit/Rev2_Webapp/defaults/. /mnt/ssd/sit-campaign/
#
#   5. Run this script:
#        chmod +x /opt/stacks/sit/Rev2_Webapp/deploy-docker.sh
#        /opt/stacks/sit/Rev2_Webapp/deploy-docker.sh
#
# Subsequent updates: just run this script again.
# =============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
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

if [ ! -f "$REPO_ROOT/.env" ]; then
    echo "ERROR: .env file not found at $REPO_ROOT/.env"
    echo "  cp $REPO_ROOT/.env.example $REPO_ROOT/.env  then fill in CAMPAIGN_PATH."
    exit 1
fi

source "$REPO_ROOT/.env"

if [ -z "$CAMPAIGN_PATH" ]; then
    echo "ERROR: CAMPAIGN_PATH is not set in .env"
    exit 1
fi

# ── Pull latest code from private repo ────────────────────────────────────────
echo "  → Pulling latest code (requires deploy key / SSH agent)..."
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

# ── Fix ownership so the container's 'sit' user (UID 1000) can read/write ────
echo "  → Setting permissions on $CAMPAIGN_PATH (UID 1000:1000) ..."
sudo chown -R 1000:1000 "$CAMPAIGN_PATH"
sudo chmod -R u+rwX "$CAMPAIGN_PATH"
echo "  ✓ Permissions set"

# ── Build & restart container ─────────────────────────────────────────────────
echo "  → Building Docker image..."
docker compose -f "$REPO_ROOT/compose.yaml" --env-file "$REPO_ROOT/.env" build --no-cache

echo "  → Restarting container..."
docker compose -f "$REPO_ROOT/compose.yaml" --env-file "$REPO_ROOT/.env" up -d --remove-orphans

echo ""
echo "  ✓ SIT is running on port ${SIT_PORT:-7600}"
echo "  → Logs: docker compose -f $REPO_ROOT/compose.yaml logs -f sit"
echo ""
