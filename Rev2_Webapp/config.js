/**
 * SIT (Starfinder Interactive Table) — Configuration
 * 
 * Edit these values to customize your deployment.
 * For RPi deployments, the defaults should work out of the box.
 */

const path = require('path');

module.exports = {
    // Server port (default: 3000)
    PORT: process.env.SIT_PORT || 3000,

    // Bind address: '0.0.0.0' = all interfaces (needed for RPi/LAN access)
    //               '127.0.0.1' = localhost only
    HOST: process.env.SIT_HOST || '0.0.0.0',

    // ─── Campaign Data Paths ──────────────────────────────
    // All user/campaign data lives under CAMPAIGN_DIR.
    // This is the ONE folder you need to backup, sync, or transfer.
    // It is .gitignored so app updates (git pull) never overwrite your data.
    CAMPAIGN_DIR: process.env.SIT_CAMPAIGN_DIR || path.join(__dirname, 'campaign'),

    // Subdirectories inside CAMPAIGN_DIR (usually no need to change)
    DATA_SUBDIR: 'data',    // JSON files (characters, items, quests, etc.)
    MEDIA_SUBDIR: 'media',  // Images, scene folders, backgrounds, moods

    // ─── Defaults Directory ───────────────────────────────
    // Template/starter files that ship with the app.
    // On first run, these are copied into CAMPAIGN_DIR if it doesn't exist.
    DEFAULTS_DIR: path.join(__dirname, 'defaults'),

    // Enable auto-save interval (ms). 0 = disabled (saves on change only)
    AUTO_SAVE_INTERVAL: 0,

    // Log level: 'verbose' | 'normal' | 'quiet'
    LOG_LEVEL: process.env.SIT_LOG_LEVEL || 'normal'
};
