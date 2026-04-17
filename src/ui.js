import { CLASS_DEFS } from './classes.js';
import { applyTheme } from './world.js';
import { themes } from './settings.js';

let fpsEl, debugEl, controlsEl;
let showFps = true;
let showDebug = false;
let frames = 0;
let lastTime = performance.now();
let currentClassDef = null;

export function initUI(mapName = 'range', classId = 'knight') {
  fpsEl = document.getElementById('fps-counter');
  debugEl = document.getElementById('debug-info');
  controlsEl = document.getElementById('controls-hint');

  currentClassDef = CLASS_DEFS[classId];

  // Set class indicator
  const classEl = document.getElementById('class-indicator');
  if (classEl && currentClassDef) {
    classEl.textContent = `${currentClassDef.icon} ${currentClassDef.name} — ${currentClassDef.role}`;
  }

  // Set cooldown slot names
  if (currentClassDef) {
    const meleeN = document.getElementById('cd-melee-name');
    const rangedN = document.getElementById('cd-ranged-name');
    const passiveN = document.getElementById('cd-passive-name');
    const qN = document.getElementById('cd-q-name');
    const eN = document.getElementById('cd-e-name');
    if (meleeN) meleeN.textContent = currentClassDef.melee.name;
    if (rangedN) rangedN.textContent = currentClassDef.ranged.name;
    if (passiveN) passiveN.textContent = currentClassDef.passive.name;
    if (qN) qN.textContent = currentClassDef.spell1.name;
    if (eN) eN.textContent = currentClassDef.spell2.name;
  }

  // Theme picker
  const themeBtns = document.querySelectorAll('#theme-picker .theme-btn');
  themeBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const themeId = btn.dataset.theme;
      if (!themes[themeId]) return;
      themeBtns.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      applyTheme(themeId);
      applyHudAccent(themeId);
    });
  });

  // Apply initial HUD accent
  applyHudAccent('frost');

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey) {
      showFps = !showFps;
      if (fpsEl) fpsEl.style.display = showFps ? 'block' : 'none';
    }
    if (e.code === 'Backquote') {
      showDebug = !showDebug;
      if (debugEl) debugEl.style.display = showDebug ? 'block' : 'none';
    }
    if (e.code === 'KeyH') {
      if (controlsEl) controlsEl.style.display = controlsEl.style.display === 'none' ? 'block' : 'none';
    }
  });
}

function applyHudAccent(themeId) {
  const t = themes[themeId];
  if (!t) return;
  const accent = t.hudAccent;
  // Light themes need dark text + light shadow, dark themes need light text + dark shadow
  const isLight = themeId === 'frost' || themeId === 'sandstone';
  const shadow = isLight ? '0 0 4px rgba(255,255,255,0.8), 0 1px 2px rgba(255,255,255,0.5)' : '0 0 4px rgba(0,0,0,0.8), 0 1px 2px rgba(0,0,0,0.5)';
  const baseTextColor = isLight ? '#333' : '#999';

  // HUD text color
  const hud = document.getElementById('hud');
  if (hud) {
    hud.style.color = accent;
    hud.style.textShadow = shadow;
  }

  // Kill counter
  const killEl = document.getElementById('kill-counter');
  if (killEl) killEl.style.color = accent;

  // Class indicator
  const classEl = document.getElementById('class-indicator');
  if (classEl) classEl.style.color = accent;

  // Cooldown keys
  document.querySelectorAll('.cd-slot .cd-key').forEach((el) => { el.style.color = accent; });

  // Cooldown slot backgrounds
  const slotBg = isLight ? 'rgba(255,255,255,0.7)' : 'rgba(0,0,0,0.7)';
  const slotBorder = isLight ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.15)';
  document.querySelectorAll('.cd-slot').forEach((el) => {
    el.style.background = slotBg;
    el.style.borderColor = slotBorder;
  });

  // Controls hint
  if (controlsEl) {
    controlsEl.style.color = baseTextColor;
    controlsEl.querySelectorAll('span').forEach((s) => { s.style.color = accent; });
  }

  // Resource bars — adapt border
  const barBorder = isLight ? '#444' : '#fff';
  document.querySelectorAll('.resource-bar').forEach((el) => { el.style.borderColor = barBorder; });

  // FPS counter
  if (fpsEl) fpsEl.style.color = baseTextColor;
}

export function updateUI(playerPos, bodyCount, playerState, npcCount, playerHP, playerMana, kills, playerStamina) {
  // Kills
  const killEl = document.getElementById('kill-counter');
  if (killEl) killEl.textContent = `Kills: ${kills ?? 0}  |  Enemies: ${npcCount ?? 0}`;

  // HP bar
  if (playerHP) {
    const fill = document.getElementById('player-hp-fill');
    const txt = document.getElementById('player-hp-text');
    const ratio = Math.max(0, playerHP.hp / playerHP.max);
    if (fill) {
      fill.style.width = `${ratio * 100}%`;
      fill.style.background = ratio > 0.5 ? '#33ff55' : ratio > 0.25 ? '#ffcc33' : '#ff3344';
    }
    if (txt) txt.textContent = `${playerHP.hp} / ${playerHP.max} HP`;
  }

  // Mana bar
  if (playerMana) {
    const fill = document.getElementById('player-mana-fill');
    const txt = document.getElementById('player-mana-text');
    const ratio = Math.max(0, playerMana.mana / playerMana.max);
    if (fill) fill.style.width = `${ratio * 100}%`;
    if (txt) txt.textContent = `${playerMana.mana} / ${playerMana.max} MP`;
  }

  // Stamina bar
  if (playerStamina) {
    const fill = document.getElementById('player-stamina-fill');
    const txt = document.getElementById('player-stamina-text');
    const ratio = Math.max(0, playerStamina.stamina / playerStamina.max);
    if (fill) fill.style.width = `${ratio * 100}%`;
    if (txt) txt.textContent = `${playerStamina.stamina} / ${playerStamina.max} STA`;
  }

  // Cooldowns
  updateCooldownSlot('cd-melee', playerState.meleeCd, currentClassDef?.melee.cooldown ?? 1);
  updateCooldownSlot('cd-ranged', playerState.rangedCd, currentClassDef?.ranged.cooldown ?? 1);
  updateCooldownSlot('cd-q', playerState.spell1Cd, currentClassDef?.spell1.cooldown ?? 8);
  updateCooldownSlot('cd-e', playerState.spell2Cd, currentClassDef?.spell2.cooldown ?? 12);

  // FPS
  frames++;
  const now = performance.now();
  if (now - lastTime >= 500) {
    const fps = Math.round((frames * 1000) / (now - lastTime));
    if (fpsEl) fpsEl.textContent = `${fps} FPS`;
    frames = 0;
    lastTime = now;
  }

  // Debug
  if (showDebug && debugEl) {
    debugEl.innerHTML =
      `pos: ${playerPos.x.toFixed(1)}, ${playerPos.y.toFixed(1)}, ${playerPos.z.toFixed(1)}<br>` +
      `speed: ${playerState.speed} u/s<br>` +
      `class: ${playerState.classId}<br>` +
      `bodies: ${bodyCount}` +
      (playerState.sliding ? ' <span style="color:#0af">SLIDE</span>' : '');
  }
}

function updateCooldownSlot(slotId, remaining, max) {
  const slot = document.getElementById(slotId);
  if (!slot) return;

  let overlay = slot.querySelector('.cd-overlay');
  if (remaining > 0.05) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'cd-overlay';
      slot.appendChild(overlay);
    }
    overlay.textContent = remaining.toFixed(1);
    slot.style.borderColor = 'rgba(255,255,255,0.05)';
  } else {
    if (overlay) { overlay.remove(); }
    slot.style.borderColor = 'rgba(232, 132, 60, 0.4)';
  }
}
