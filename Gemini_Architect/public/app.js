// =============================================================================
//  GEMINI ARCHITECT — app.js
//  API client, main controller, tab routing, notifications, modals
// =============================================================================

// ── API Layer ──────────────────────────────────────────────────────────────────
const API = {
    async getUniverse() {
        const r = await fetch('/api/universe');
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    },
    async saveUniverse(data) {
        const r = await fetch('/api/universe', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    },
    async getFile(rel) {
        const r = await fetch(`/api/file?rel=${encodeURIComponent(rel)}`);
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    },
    async saveFile(rel, data) {
        const r = await fetch('/api/file', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rel, data }),
        });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    },
    async deleteFile(rel) {
        const r = await fetch(`/api/file?rel=${encodeURIComponent(rel)}`, { method: 'DELETE' });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    },
    async listDir(dir) {
        const r = await fetch(`/api/list?dir=${encodeURIComponent(dir)}`);
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    },
    async validate() {
        const r = await fetch('/api/validate');
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    },
    async getManifest() {
        const r = await fetch('/api/manifest');
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    },
    async saveManifest(data) {
        const r = await fetch('/api/manifest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        if (!r.ok) throw new Error(await r.text());
        return r.json();
    },
};

// ── Notifications ──────────────────────────────────────────────────────────────
function notify(message, type = 'info', duration = 3000) {
    const area = document.getElementById('notification-area');
    const el   = document.createElement('div');
    el.className = `notification ${type}`;
    el.textContent = message;
    area.appendChild(el);
    setTimeout(() => {
        el.style.animation = 'fadeOut 0.3s ease-in forwards';
        setTimeout(() => el.remove(), 300);
    }, duration);
}

// ── Status bar ─────────────────────────────────────────────────────────────────
function setStatus(text, path = '') {
    document.getElementById('status-text').textContent = text;
    document.getElementById('status-path').textContent = path;
}

// ── Modal ──────────────────────────────────────────────────────────────────────
function showModal(title, bodyHTML) {
    return new Promise(resolve => {
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-body').innerHTML = bodyHTML;
        const overlay = document.getElementById('modal-overlay');
        overlay.style.display = 'flex';

        function cleanup(result) {
            overlay.style.display = 'none';
            document.getElementById('modal-confirm').onclick = null;
            document.getElementById('modal-cancel').onclick  = null;
            resolve(result);
        }

        document.getElementById('modal-confirm').onclick = () => cleanup(true);
        document.getElementById('modal-cancel').onclick  = () => cleanup(false);
    });
}

function promptModal(title, label, defaultValue = '') {
    return new Promise(resolve => {
        const bodyHTML = `
            <label class="form-label">${label}</label>
            <input class="form-input" id="modal-input" value="${defaultValue}" style="margin-top:6px">
        `;
        document.getElementById('modal-title').textContent = title;
        document.getElementById('modal-body').innerHTML = bodyHTML;
        const overlay = document.getElementById('modal-overlay');
        overlay.style.display = 'flex';

        const input = document.getElementById('modal-input');
        input.focus();
        input.select();

        function cleanup(result) {
            overlay.style.display = 'none';
            document.getElementById('modal-confirm').onclick = null;
            document.getElementById('modal-cancel').onclick  = null;
            resolve(result);
        }

        document.getElementById('modal-confirm').onclick = () => cleanup(input.value.trim() || null);
        document.getElementById('modal-cancel').onclick  = () => cleanup(null);
        input.addEventListener('keydown', e => {
            if (e.key === 'Enter')  cleanup(input.value.trim() || null);
            if (e.key === 'Escape') cleanup(null);
        });
    });
}

// ── Tab routing ────────────────────────────────────────────────────────────────
document.querySelectorAll('.module-tab').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('.module-tab').forEach(b => b.classList.remove('active'));
        document.querySelectorAll('.module').forEach(m => m.classList.remove('active'));
        btn.classList.add('active');
        const id = `module-${btn.dataset.module}`;
        document.getElementById(id).classList.add('active');
        setStatus(`${btn.textContent.trim()} active`);
        // repaint orrery canvas after tab becomes visible
        if (btn.dataset.module === 'orrery') {
            requestAnimationFrame(() => {
                if (typeof OrreryBuilder !== 'undefined') OrreryBuilder.refreshCanvas();
            });
        }
    });
});

// ── Campaign rename ────────────────────────────────────────────────────────────
document.getElementById('btn-rename-campaign').addEventListener('click', async () => {
    const current = document.getElementById('campaign-name-display').textContent;
    const name = await promptModal('Rename Campaign', 'CAMPAIGN NAME', current);
    if (!name) return;
    try {
        const universe = await API.getUniverse();
        universe.campaign_name = name;
        await API.saveUniverse(universe);
        document.getElementById('campaign-name-display').textContent = name;
        notify('Campaign renamed.', 'success');
    } catch (e) {
        notify(`Error: ${e.message}`, 'error');
    }
});

// ── Validate ───────────────────────────────────────────────────────────────────
document.getElementById('btn-validate').addEventListener('click', async () => {
    setStatus('Validating...');
    try {
        const result = await API.validate();
        if (result.ok) {
            notify('✓ All links are valid.', 'success', 4000);
            setStatus('Validation passed — no broken links.');
        } else {
            const msgs = result.errors.map(e => `• ${e.type}: ${e.ref} (from ${e.from})`).join('\n');
            await showModal(
                `⚑ Validation — ${result.errors.length} issue(s)`,
                `<pre style="color:#ff3333;font-size:0.75rem;white-space:pre-wrap;max-height:300px;overflow-y:auto">${msgs}</pre>`
            );
            setStatus(`Validation: ${result.errors.length} broken links.`);
        }
    } catch (e) {
        notify(`Validation failed: ${e.message}`, 'error');
    }
});

// ── Orbital Map Renderer (shared by Orrery Builder + System Forge) ────────────
window.renderOrreryMap = function(canvas, systemData) {
    if (!canvas || !systemData) return [];
    const W   = canvas.width  = canvas.offsetWidth  || 600;
    const H   = canvas.height = canvas.offsetHeight || 420;
    const ctx = canvas.getContext('2d');
    const cx  = W / 2, cy = H / 2;
    const margin = 50;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#06060e';
    ctx.fillRect(0, 0, W, H);

    // decorative grid rings
    for (let i = 1; i <= 6; i++) {
        const gr = (Math.min(W, H) / 2 - margin) * (i / 6);
        ctx.beginPath();
        ctx.arc(cx, cy, gr, 0, Math.PI * 2);
        ctx.strokeStyle = i % 2 ? 'rgba(0,210,255,0.04)' : 'rgba(0,210,255,0.02)';
        ctx.lineWidth = 1;
        ctx.setLineDash([]);
        ctx.stroke();
    }

    const orbitals = [...(systemData.orbitals || [])]
        .sort((a, b) => (a.orbit_index || 99) - (b.orbit_index || 99));

    const radii  = orbitals.filter(o => o.orbit_radius > 0).map(o => o.orbit_radius);
    const maxR   = radii.length ? Math.max(...radii) : 1;
    const logMax = Math.log10(maxR + 1);
    const pxMax  = Math.min(W, H) / 2 - margin;
    const toCanvas = r => (Math.log10(r + 1) / logMax) * pxMax;

    const TYPE_COLOR = {
        Terran:'#88aaff', Ocean:'#2255dd', Jungle:'#44bb55', Desert:'#cc8844',
        'Gas Giant':'#ee8855', 'Ice Giant':'#aaccff', Lava:'#ff5500',
        Barren:'#778888', Rock:'#998866', 'Asteroid Belt':'#887755',
        Planet:'#00d2ff', Station:'#ffaa00', Moon:'#889999',
        'Dwarf Planet':'#667788', 'Companion Star':'#ffcc88',
    };

    const hitmap    = [];
    let   planetIdx = 0;

    for (const orb of orbitals) {
        if (!orb.orbit_radius) continue;

        const r     = toCanvas(orb.orbit_radius);
        const isBelt = orb.type === 'Asteroid Belt';
        const isComp = orb.type === 'Companion Star';

        // orbital ring
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        if (isBelt) {
            ctx.strokeStyle = 'rgba(136,100,60,0.45)';
            ctx.lineWidth   = 6;
            ctx.setLineDash([5, 4]);
        } else {
            ctx.strokeStyle = 'rgba(0,210,255,0.12)';
            ctx.lineWidth   = 1;
            ctx.setLineDash([]);
        }
        ctx.stroke();
        ctx.setLineDash([]);
        if (isBelt) { planetIdx++; continue; }

        // planet position — golden-angle spread
        const angle  = planetIdx * 2.3999632297 - Math.PI / 2;
        const px     = cx + Math.cos(angle) * r;
        const py     = cy + Math.sin(angle) * r;
        const pType  = orb.planet_type || orb.type || 'Planet';
        const col    = TYPE_COLOR[pType] || TYPE_COLOR[orb.type] || '#00d2ff';
        const dotR   = (pType === 'Gas Giant') ? 9 : (pType === 'Ice Giant') ? 7 : isComp ? 10 : 5;

        // glow
        const g = ctx.createRadialGradient(px, py, 0, px, py, dotR * 3.5);
        g.addColorStop(0, col + 'cc');
        g.addColorStop(1, 'transparent');
        ctx.beginPath();
        ctx.arc(px, py, dotR * 3.5, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();

        // dot
        ctx.beginPath();
        ctx.arc(px, py, dotR, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.fill();

        // children: moons + stations orbiting dot
        const children = orb.children || [];
        children.forEach((child, ci) => {
            const ca = ci * (Math.PI * 2 / Math.max(children.length, 1));
            const mr = dotR + 8 + ci * 3;
            const mx = px + Math.cos(ca) * mr;
            const my = py + Math.sin(ca) * mr;
            ctx.beginPath();
            ctx.arc(mx, my, 2, 0, Math.PI * 2);
            ctx.fillStyle = child.type === 'Station' ? '#ffaa00' : '#667788';
            ctx.fill();
        });

        // child count badge
        if (children.length) {
            const bx = px + dotR + 3, by = py - dotR;
            ctx.beginPath();
            ctx.arc(bx, by, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#ffaa0099';
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = '5px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(children.length, bx, by + 2);
        }

        // label — flip below if dot is in lower half
        const labelOffset = Math.sin(angle) >= 0 ? dotR + 14 : -dotR - 6;
        ctx.fillStyle = col + 'ee';
        ctx.font = '9px "Share Tech Mono",monospace';
        ctx.textAlign = 'center';
        ctx.fillText(orb.name || orb.id, px, py + labelOffset);

        hitmap.push({ x: px, y: py, r: dotR + 8, idx: systemData.orbitals.indexOf(orb), orb });
        planetIdx++;
    }

    // central star
    const starColor = systemData.star?.color_hex || '#ffcc00';
    const starR     = 14;

    const sg = ctx.createRadialGradient(cx, cy, 0, cx, cy, starR * 5);
    sg.addColorStop(0,   starColor);
    sg.addColorStop(0.4, starColor + '66');
    sg.addColorStop(1,   'transparent');
    ctx.beginPath();
    ctx.arc(cx, cy, starR * 5, 0, Math.PI * 2);
    ctx.fillStyle = sg;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, starR, 0, Math.PI * 2);
    ctx.fillStyle = starColor;
    ctx.shadowColor = starColor;
    ctx.shadowBlur  = 12;
    ctx.fill();
    ctx.shadowBlur  = 0;

    // star name
    ctx.fillStyle = starColor;
    ctx.font  = 'bold 11px "Share Tech Mono",monospace';
    ctx.textAlign = 'center';
    ctx.fillText(systemData.star?.name || '—', cx, cy + starR + 15);
    ctx.fillStyle = '#555';
    ctx.font  = '9px "Share Tech Mono",monospace';
    ctx.fillText(systemData.star?.spectral_class || '', cx, cy + starR + 26);

    return hitmap;
};

// ── Init ───────────────────────────────────────────────────────────────────────
async function init() {
    // Check server connection
    try {
        const universe = await API.getUniverse();
        document.getElementById('campaign-name-display').textContent = universe.campaign_name || '—';
        document.getElementById('connection-dot').classList.remove('error');
        setStatus('Ready.');
    } catch (e) {
        document.getElementById('connection-dot').classList.add('error');
        document.getElementById('connection-dot').style.background = '#ff3333';
        document.getElementById('connection-dot').style.boxShadow  = '0 0 6px #ff3333';
        notify('Cannot reach server. Is it running?', 'error', 8000);
        setStatus('Server unreachable.');
        return;
    }

    // Init all modules
    if (typeof GalaxyPlotter !== 'undefined')  GalaxyPlotter.init();
    if (typeof OrreryBuilder !== 'undefined')  OrreryBuilder.init();
    if (typeof PlanetaryStudio !== 'undefined') PlanetaryStudio.init();
    if (typeof Cartographer !== 'undefined')   Cartographer.init();
    if (typeof SystemForge !== 'undefined')    SystemForge.init();
}

// ── System Forge sub-tab routing ───────────────────────────────────────────────
document.querySelectorAll('[data-sftab]').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('[data-sftab]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const tab = btn.dataset.sftab;
        document.getElementById('sf-panel-genesis').style.display  = tab === 'genesis'  ? '' : 'none';
        document.getElementById('sf-panel-manifest').style.display = tab === 'manifest' ? '' : 'none';
        document.getElementById('sf-panel-drop').style.display     = tab === 'drop'     ? '' : 'none';
    });
});

// Reveal save section when a result exists
const _sfGenBtn = document.getElementById('sf-generate-btn');
if (_sfGenBtn) {
    _sfGenBtn.addEventListener('click', () => {
        setTimeout(() => {
            const box = document.getElementById('sf-save-section');
            if (box) box.style.display = '';
        }, 100);
    });
}

// Expose helpers globally for modules
window.API       = API;
window.notify    = notify;
window.setStatus = setStatus;
window.showModal = showModal;
window.promptModal = promptModal;

document.addEventListener('DOMContentLoaded', init);
