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
}

// Expose helpers globally for modules
window.API       = API;
window.notify    = notify;
window.setStatus = setStatus;
window.showModal = showModal;
window.promptModal = promptModal;

document.addEventListener('DOMContentLoaded', init);
