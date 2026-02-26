// =============================================================================
//  GEMINI ARCHITECT — Local Server
//  Serves the editor UI and handles all file I/O for campaign_root/
// =============================================================================

const express = require('express');
const path    = require('path');
const fs      = require('fs');
const multer  = require('multer');

const app         = express();
const PORT        = process.env.PORT || 3001;
const CAMPAIGN    = path.join(__dirname, 'campaign_root');
const TMP_DIR     = path.join(__dirname, 'tmp');

// ── Bootstrap folders ────────────────────────────────────────────────────────
const REQUIRED_DIRS = [
    'data/sectors',
    'data/systems',
    'data/bodies',
    'data/locations',
    'assets/textures',
    'assets/tiles',
    'assets/icons',
    'assets/models',
];

function ensureDir(dir) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

ensureDir(TMP_DIR);
REQUIRED_DIRS.forEach(sub => ensureDir(path.join(CAMPAIGN, sub)));

// Bootstrap assets/models/manifest.json if absent
const manifestPath = path.join(CAMPAIGN, 'assets', 'models', 'manifest.json');
if (!fs.existsSync(manifestPath)) {
    const seedManifest = { models_library: [] };
    fs.writeFileSync(manifestPath, JSON.stringify(seedManifest, null, 2));
    console.log('  [init] Created campaign_root/assets/models/manifest.json');
}

// Bootstrap universe.json if absent
const universePath = path.join(CAMPAIGN, 'data', 'universe.json');
if (!fs.existsSync(universePath)) {
    const seed = {
        campaign_name: 'New Campaign',
        global_settings: {
            jump_range_calculation: 'euclidean',
            map_units: 'light_years',
        },
        sectors_index: [],
    };
    fs.writeFileSync(universePath, JSON.stringify(seed, null, 2));
    console.log('  [init] Created campaign_root/data/universe.json');
}

// ── Middleware ────────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '20mb' }));

// Serve campaign assets (textures, tiles, etc.) under /campaign-assets/
app.use('/campaign-assets', express.static(CAMPAIGN));

// ── Path guard helper ─────────────────────────────────────────────────────────
function safePath(rel) {
    if (!rel) return null;
    // Normalise separators, strip leading slashes
    const clean = rel.replace(/\\/g, '/').replace(/^\/+/, '');
    const abs   = path.resolve(CAMPAIGN, clean);
    if (!abs.startsWith(path.resolve(CAMPAIGN))) return null; // path-traversal guard
    return abs;
}

// ── API: Universe ─────────────────────────────────────────────────────────────

// GET /api/universe
app.get('/api/universe', (_req, res) => {
    try {
        res.json(JSON.parse(fs.readFileSync(universePath, 'utf8')));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/universe  body: { ...universe object }
app.post('/api/universe', (req, res) => {
    try {
        fs.writeFileSync(universePath, JSON.stringify(req.body, null, 2));
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── API: Assets Manifest ─────────────────────────────────────────────────────

// GET /api/manifest
app.get('/api/manifest', (_req, res) => {
    try {
        res.json(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// POST /api/manifest  body: { ...manifest object }
app.post('/api/manifest', (req, res) => {
    try {
        fs.writeFileSync(manifestPath, JSON.stringify(req.body, null, 2));
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── API: Generic File ─────────────────────────────────────────────────────────

// GET /api/file?rel=data/sectors/sector_01.json
app.get('/api/file', (req, res) => {
    const abs = safePath(req.query.rel);
    if (!abs) return res.status(400).json({ error: 'Invalid path' });
    try {
        res.json(JSON.parse(fs.readFileSync(abs, 'utf8')));
    } catch (e) {
        res.status(404).json({ error: 'File not found or invalid JSON' });
    }
});

// POST /api/file  body: { rel: '...', data: {...} }
app.post('/api/file', (req, res) => {
    const { rel, data } = req.body;
    const abs = safePath(rel);
    if (!abs) return res.status(400).json({ error: 'Invalid path' });
    try {
        ensureDir(path.dirname(abs));
        fs.writeFileSync(abs, JSON.stringify(data, null, 2));
        res.json({ ok: true });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// DELETE /api/file?rel=data/sectors/sector_01.json
app.delete('/api/file', (req, res) => {
    const abs = safePath(req.query.rel);
    if (!abs) return res.status(400).json({ error: 'Invalid path' });
    try {
        fs.unlinkSync(abs);
        res.json({ ok: true });
    } catch (e) {
        res.status(404).json({ error: 'File not found' });
    }
});

// ── API: Directory listing ────────────────────────────────────────────────────

// GET /api/list?dir=data/sectors
app.get('/api/list', (req, res) => {
    const abs = safePath(req.query.dir || '');
    if (!abs) return res.status(400).json({ error: 'Invalid path' });
    try {
        const entries = fs.existsSync(abs)
            ? fs.readdirSync(abs).map(name => {
                const stat = fs.statSync(path.join(abs, name));
                return { name, isDir: stat.isDirectory() };
              })
            : [];
        res.json(entries);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── API: Image upload (for Cartographer) ─────────────────────────────────────

const upload = multer({
    dest: TMP_DIR,
    limits: { fileSize: 100 * 1024 * 1024 }, // 100 MB max
});

// POST /api/upload-map  (multipart, field: "image")
app.post('/api/upload-map', upload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const destName = `map_${Date.now()}${path.extname(req.file.originalname)}`;
    const destPath = path.join(CAMPAIGN, 'assets', 'tiles', '_uploads', destName);
    ensureDir(path.dirname(destPath));
    fs.renameSync(req.file.path, destPath);

    res.json({
        ok:           true,
        originalName: req.file.originalname,
        savedAs:      `assets/tiles/_uploads/${destName}`,
        size:         req.file.size,
    });
});

// ── API: Validate (check for broken links) ───────────────────────────────────

// GET /api/validate
app.get('/api/validate', (_req, res) => {
    const errors = [];
    try {
        const universe = JSON.parse(fs.readFileSync(universePath, 'utf8'));
        for (const entry of (universe.sectors_index || [])) {
            const secPath = safePath(entry.file);
            if (!secPath || !fs.existsSync(secPath)) {
                errors.push({ type: 'missing_file', ref: entry.file, from: 'universe.json' });
                continue;
            }
            const sector = JSON.parse(fs.readFileSync(secPath, 'utf8'));
            for (const sys of (sector.systems || [])) {
                const sysPath = safePath(sys.file);
                if (!sysPath || !fs.existsSync(sysPath)) {
                    errors.push({ type: 'missing_file', ref: sys.file, from: entry.file });
                    continue;
                }
                const system = JSON.parse(fs.readFileSync(sysPath, 'utf8'));
                for (const orbital of (system.orbitals || [])) {
                    const bodyPath = safePath(orbital.file);
                    if (!bodyPath || !fs.existsSync(bodyPath)) {
                        errors.push({ type: 'missing_file', ref: orbital.file, from: sys.file });
                        continue;
                    }
                    const body = JSON.parse(fs.readFileSync(bodyPath, 'utf8'));
                    for (const poi of (body.pois || [])) {
                        if (poi.link_to_map) {
                            const locPath = safePath(poi.link_to_map);
                            if (!locPath || !fs.existsSync(locPath)) {
                                errors.push({ type: 'missing_file', ref: poi.link_to_map, from: orbital.file });
                            }
                        }
                    }
                }
            }
        }
        res.json({ ok: errors.length === 0, errors });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
    console.log('');
    console.log('  ╔═══════════════════════════════════════╗');
    console.log('  ║      GEMINI ARCHITECT  v1.0.0         ║');
    console.log('  ║   Starfinder Campaign Map Editor      ║');
    console.log('  ╚═══════════════════════════════════════╝');
    console.log('');
    console.log(`  Local:   http://localhost:${PORT}`);
    console.log('');
    console.log('  Campaign data → campaign_root/');
    console.log('  Press Ctrl+C to stop.');
    console.log('');
});
