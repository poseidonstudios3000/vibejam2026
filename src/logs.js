// Game Logs — dev tracker for MANA FIGHT.
// Admin mode: click "Unlock Admin" and enter the password. Unlocking sets a
// localStorage flag on this browser; other browsers stay read-only.
// Data persists to localStorage. Use Export to copy JSON back into DEFAULT_LOGS
// so teammates see the updated baseline.
//
// NOTE: the password hash below ships in client JS — viewing source + running a
// brute-force against short passwords would bypass it. This is gate, not a vault.
// For true access control we'd need a backend.

const LS_DATA = 'mana-fight-logs';
const LS_ADMIN = 'mana-fight-logs-admin';
// SHA-256('ManaBanana$$69') — compare hash, never store raw password.
const ADMIN_HASH = '231266c7e10319006d4bbc5b89a8c9f4a8c53eef88f994b8ff513455eccc25bd';

async function sha256Hex(text) {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

const STATUS_OPTIONS = ['done', 'ongoing', 'in-dev', 'not-started', 'idea'];
const STATUS_LABEL = {
  'done': 'Done',
  'ongoing': 'Ongoing',
  'in-dev': 'In Dev',
  'not-started': 'Not Started',
  'idea': 'Idea',
};

// Shipped baseline — what new visitors see before any local edits.
const DEFAULT_LOGS = [
  {
    category: 'Core',
    items: [
      { item: 'Game name', status: 'done',    progress: 100, note: 'MANA FIGHT' },
      { item: 'Game concept', status: 'done', progress: 100, note: 'Class-based arena combat with melee + spellcast; 4 classes, movement-tech heavy (slide, jump, zoom).' },
      { item: 'Core gameplay loop', status: 'ongoing', progress: 60, note: 'Move, aim, cast/melee, kill NPCs. Missing: objective, match flow.' },
    ],
  },
  {
    category: 'Classes (4/4) — each has 1 spell, 1 melee, 1 passive',
    items: [
      { item: 'Tank — Fireball (spell, AOE) / Sword (melee) / Heavy Plate (passive)',             status: 'done', progress: 100, note: 'Frontline bruiser: highest HP, slowest, -20% damage taken. Fireball does 28 dmg with 2.5m splash.' },
      { item: 'Ranger — Bow Shot (spell, magic green arrow) / Dagger (melee) / Hawk\'s Eye (passive)', status: 'done', progress: 100, note: 'Mid-range DPS: fast projectile, +25% range.' },
      { item: 'Eso — Shadow Bolt (spell, dark magic) / Staff Whack (melee) / Arcane Focus (passive)', status: 'done', progress: 100, note: 'Glass-cannon caster: black + purple bolt with swirling aura, homing, +50% mana regen.' },
      { item: 'Phantom — Spirit Daggers (spell, double-throw) / Twin Daggers (melee) / Backstab (passive)', status: 'done', progress: 100, note: 'Fast assassin: fires two small blue daggers 120 ms apart, 15 dmg each. Silent-but-deadly SFX, +50% melee from behind.' },
      { item: 'Class balance pass', status: 'not-started', progress: 0, note: 'Needs playtesting once maps and objectives exist.' },
    ],
  },
  {
    category: 'Maps (Range only)',
    items: [
      { item: 'Range — combat range',  status: 'in-dev', progress: 65, note: 'Live NPCs (random class per spawn), ~50% static sentries + ~50% wanderers, distance markers, cover walls, perimeter bounds.' },
      { item: 'Range objectives',      status: 'not-started', progress: 0, note: 'Wave system, scoring, or capture zones — TBD.' },
      { item: 'Map art polish',        status: 'not-started', progress: 0, note: 'Textures, props, decals.' },
      { item: 'Arena map',             status: 'not-started', progress: 0, note: 'Removed for now — focus is on Range.' },
    ],
  },
  {
    category: 'Combat',
    items: [
      { item: 'Weapons (class spellcasts)', status: 'ongoing', progress: 70, note: 'All 4 ranged wired; per-class fire SFX in aim tab.' },
      { item: 'Weapon custom VFX',          status: 'not-started', progress: 0, note: 'Muzzle flash, trail, impact shader per class.' },
      { item: 'Melee attacks (per class)',  status: 'ongoing', progress: 65, note: 'Works, but no swing animations or impact VFX.' },
      { item: 'Aim / shoot calibration',    status: 'done',    progress: 100, note: 'Converge-mode aim, hit zones (head/body/legs).' },
      { item: 'HP + respawn system',        status: 'ongoing', progress: 60, note: 'Dummies in aim range done; NPC HP works; player death loop rough.' },
    ],
  },
  {
    category: 'Audio',
    items: [
      { item: 'SFX — fire sounds per class', status: 'done', progress: 100, note: 'pistol/rifle/cannon/rocket synth-generated.' },
      { item: 'SFX — melee/impact',          status: 'ongoing', progress: 50, note: 'slamImpact placeholder, needs per-class variants.' },
      { item: 'Soundtrack / MANA FIGHT Radio', status: 'idea', progress: 0, note: 'In-game radio: rotating tracks, per-map vibe, optional announcer stingers.' },
    ],
  },
  {
    category: 'UI / UX',
    items: [
      { item: 'Class select screen', status: 'done', progress: 100, note: '4 preview cards with 3D model rotate.' },
      { item: 'HUD (HP/MP/Stamina)', status: 'done', progress: 100, note: 'Readable at speed; consider mini-map later.' },
      { item: 'Scoreboard / match summary', status: 'not-started', progress: 0, note: '' },
    ],
  },
  {
    category: 'Tech / Tooling',
    items: [
      { item: 'Movement dev tab', status: 'done', progress: 100, note: 'Tuning sliders + gaming HUD.' },
      { item: 'Aim calibration tab', status: 'done', progress: 100, note: 'Convergence, zones, weapon switching, themes.' },
      { item: 'Model Lab', status: 'ongoing', progress: 50, note: 'Preview + inspect GLBs.' },
      { item: 'Game Logs tab', status: 'done', progress: 100, note: 'This page.' },
    ],
  },
];

// --- Admin mode state ---
const isAdmin = localStorage.getItem(LS_ADMIN) === '1';

document.body.classList.toggle('readonly', !isAdmin);
const modeChip = document.getElementById('mode-chip');
modeChip.textContent = isAdmin ? 'admin mode' : 'view mode';
modeChip.classList.toggle('admin', isAdmin);

// Unlock / lock buttons
const unlockBtn = document.getElementById('unlock-btn');
const lockBtn = document.getElementById('lock-btn');
unlockBtn.style.display = isAdmin ? 'none' : '';
lockBtn.style.display = isAdmin ? '' : 'none';

const unlockDlg = document.getElementById('unlock-dlg');
const unlockInput = document.getElementById('unlock-input');
const unlockErr = document.getElementById('unlock-err');
const unlockSubmit = document.getElementById('unlock-submit');
const unlockCancel = document.getElementById('unlock-cancel');

function openUnlock() {
  unlockErr.textContent = '';
  unlockInput.value = '';
  unlockDlg.showModal();
  setTimeout(() => unlockInput.focus(), 0);
}

async function tryUnlock() {
  const pw = unlockInput.value;
  if (!pw) return;
  const hash = await sha256Hex(pw);
  if (hash === ADMIN_HASH) {
    localStorage.setItem(LS_ADMIN, '1');
    location.reload();
  } else {
    unlockErr.textContent = 'Wrong password';
    unlockDlg.classList.remove('shake');
    // force reflow to restart animation
    void unlockDlg.offsetWidth;
    unlockDlg.classList.add('shake');
  }
}

unlockBtn.addEventListener('click', openUnlock);
unlockCancel.addEventListener('click', () => unlockDlg.close());
unlockSubmit.addEventListener('click', tryUnlock);
unlockInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') tryUnlock(); });

lockBtn.addEventListener('click', () => {
  if (!confirm('Lock admin mode? You will need the password to unlock again.')) return;
  localStorage.removeItem(LS_ADMIN);
  location.reload();
});

// --- State ---
function loadData() {
  const raw = localStorage.getItem(LS_DATA);
  if (raw) {
    try { return JSON.parse(raw); } catch { /* fall through */ }
  }
  return structuredClone(DEFAULT_LOGS);
}

function saveData() {
  if (!isAdmin) return; // read-only users never persist
  localStorage.setItem(LS_DATA, JSON.stringify(state));
}

let state = loadData();

// --- Rendering ---
const root = document.getElementById('logs-root');

function render() {
  root.innerHTML = '';
  state.forEach((cat, ci) => root.appendChild(renderCategory(cat, ci)));
}

function renderCategory(cat, ci) {
  const section = document.createElement('section');
  section.className = 'category';

  // Header
  const h2 = document.createElement('h2');
  const title = document.createElement('span');
  if (isAdmin) {
    const input = document.createElement('input');
    input.className = 'inline-edit';
    input.value = cat.category;
    input.style.width = '260px';
    input.addEventListener('change', () => { cat.category = input.value; saveData(); });
    title.appendChild(input);
  } else {
    title.textContent = cat.category;
  }
  h2.appendChild(title);

  const actions = document.createElement('span');
  actions.className = 'cat-actions admin-only';
  const addBtn = document.createElement('button');
  addBtn.className = 'btn';
  addBtn.textContent = '+ Row';
  addBtn.addEventListener('click', () => {
    cat.items.push({ item: 'New item', status: 'idea', progress: 0, note: '' });
    saveData(); render();
  });
  const delCat = document.createElement('button');
  delCat.className = 'btn danger';
  delCat.textContent = 'Delete';
  delCat.addEventListener('click', () => {
    if (!confirm(`Delete category "${cat.category}"?`)) return;
    state.splice(ci, 1); saveData(); render();
  });
  actions.appendChild(addBtn);
  actions.appendChild(delCat);
  h2.appendChild(actions);
  section.appendChild(h2);

  // Table
  const table = document.createElement('table');
  table.innerHTML = `
    <thead>
      <tr>
        <th>Item</th>
        <th>Status</th>
        <th>Progress</th>
        <th>Notes</th>
        <th class="admin-only"></th>
      </tr>
    </thead>
  `;
  const tbody = document.createElement('tbody');
  cat.items.forEach((row, ri) => tbody.appendChild(renderRow(cat, ci, row, ri)));
  table.appendChild(tbody);
  section.appendChild(table);

  return section;
}

function renderRow(cat, ci, row, ri) {
  const tr = document.createElement('tr');

  // Item cell
  const itemTd = document.createElement('td'); itemTd.className = 'col-item';
  if (isAdmin) {
    const ip = document.createElement('input');
    ip.className = 'inline-edit';
    ip.value = row.item;
    ip.addEventListener('change', () => { row.item = ip.value; saveData(); });
    itemTd.appendChild(ip);
  } else {
    itemTd.textContent = row.item;
  }
  tr.appendChild(itemTd);

  // Status cell
  const statusTd = document.createElement('td'); statusTd.className = 'col-status';
  const chip = document.createElement('span');
  chip.className = `status ${row.status}`;
  chip.textContent = STATUS_LABEL[row.status] || row.status;
  if (isAdmin) {
    const sel = document.createElement('select');
    sel.className = 'inline-edit';
    for (const opt of STATUS_OPTIONS) {
      const o = document.createElement('option');
      o.value = opt; o.textContent = STATUS_LABEL[opt];
      if (opt === row.status) o.selected = true;
      sel.appendChild(o);
    }
    sel.addEventListener('change', () => {
      row.status = sel.value;
      // Auto-nudge progress: Done → 100, Not Started → 0.
      if (row.status === 'done') row.progress = 100;
      if (row.status === 'not-started') row.progress = 0;
      saveData(); render();
    });
    statusTd.appendChild(sel);
  }
  statusTd.appendChild(chip);
  tr.appendChild(statusTd);

  // Progress cell
  const progTd = document.createElement('td'); progTd.className = 'col-progress';
  const bar = document.createElement('div'); bar.className = 'bar-wrap';
  const fill = document.createElement('div'); fill.className = 'bar-fill';
  fill.style.width = `${Math.max(0, Math.min(100, row.progress))}%`;
  const label = document.createElement('div'); label.className = 'bar-label';
  label.textContent = `${row.progress}%`;
  bar.appendChild(fill); bar.appendChild(label);
  progTd.appendChild(bar);
  if (isAdmin) {
    const np = document.createElement('input');
    np.type = 'number'; np.min = 0; np.max = 100; np.value = row.progress;
    np.className = 'inline-edit'; np.style.width = '66px'; np.style.marginTop = '4px';
    np.addEventListener('change', () => {
      row.progress = Math.max(0, Math.min(100, parseInt(np.value, 10) || 0));
      saveData(); render();
    });
    progTd.appendChild(np);
  }
  tr.appendChild(progTd);

  // Notes cell
  const noteTd = document.createElement('td'); noteTd.className = 'col-notes';
  if (isAdmin) {
    const ta = document.createElement('textarea');
    ta.className = 'inline-edit';
    ta.rows = 2;
    ta.value = row.note;
    ta.style.resize = 'vertical';
    ta.addEventListener('change', () => { row.note = ta.value; saveData(); });
    noteTd.appendChild(ta);
  } else {
    noteTd.textContent = row.note || '—';
  }
  tr.appendChild(noteTd);

  // Actions cell (admin only)
  const actTd = document.createElement('td'); actTd.className = 'col-actions admin-only';
  const delBtn = document.createElement('button');
  delBtn.className = 'btn danger'; delBtn.textContent = '×';
  delBtn.title = 'Delete row';
  delBtn.addEventListener('click', () => {
    cat.items.splice(ri, 1); saveData(); render();
  });
  actTd.appendChild(delBtn);
  tr.appendChild(actTd);

  return tr;
}

render();

// --- Admin toolbar ---
if (isAdmin) {
  document.getElementById('btn-add-category').addEventListener('click', () => {
    state.push({ category: 'New category', items: [] });
    saveData(); render();
  });

  document.getElementById('btn-reset').addEventListener('click', () => {
    if (!confirm('Reset logs to shipped defaults? This will wipe your local edits.')) return;
    localStorage.removeItem(LS_DATA);
    state = structuredClone(DEFAULT_LOGS);
    render();
  });

  const dlg = document.getElementById('json-dlg');
  const dlgTa = document.getElementById('dlg-ta');
  const dlgTitle = document.getElementById('dlg-title');
  const dlgApply = document.getElementById('dlg-apply');
  let dlgMode = 'export';

  document.getElementById('btn-export').addEventListener('click', () => {
    dlgMode = 'export';
    dlgTitle.textContent = 'Export — copy JSON to paste into DEFAULT_LOGS in src/logs.js';
    dlgTa.value = JSON.stringify(state, null, 2);
    dlgTa.readOnly = true;
    dlgApply.style.display = 'none';
    dlg.showModal();
  });

  document.getElementById('btn-import').addEventListener('click', () => {
    dlgMode = 'import';
    dlgTitle.textContent = 'Import — paste a logs JSON array to replace current state';
    dlgTa.value = '';
    dlgTa.readOnly = false;
    dlgApply.style.display = 'inline-block';
    dlg.showModal();
  });

  document.getElementById('dlg-close').addEventListener('click', () => dlg.close());
  dlgApply.addEventListener('click', () => {
    if (dlgMode !== 'import') { dlg.close(); return; }
    try {
      const parsed = JSON.parse(dlgTa.value);
      if (!Array.isArray(parsed)) throw new Error('Root must be an array of categories.');
      state = parsed;
      saveData(); render();
      dlg.close();
    } catch (err) {
      alert(`Invalid JSON: ${err.message}`);
    }
  });
}
