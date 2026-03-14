#!/bin/sh
# =============================================================
# SIT — Docker entrypoint
# =============================================================
# Ensures the mounted /data/campaign volume is writable by the
# 'sit' user (UID 1000), then drops privileges and starts the
# Node.js server.
# =============================================================

set -e

DATA_DIR="/data/campaign"
SIT_UID=1000
SIT_GID=1000

# ── Ensure data directory exists and is writable ──────────────
if [ ! -d "$DATA_DIR" ]; then
    echo "[entrypoint] Creating $DATA_DIR ..."
    mkdir -p "$DATA_DIR"
fi

# Fix ownership on the mount — fast no-op when already correct
echo "[entrypoint] Ensuring $DATA_DIR is owned by sit ($SIT_UID:$SIT_GID) ..."
chown -R "$SIT_UID:$SIT_GID" "$DATA_DIR"
chmod -R u+rwX "$DATA_DIR"

# ── Drop privileges and exec the main process ────────────────
echo "[entrypoint] Starting SIT as user sit ..."
exec su-exec sit "$@"
