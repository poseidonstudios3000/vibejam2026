import { settings } from './settings.js';
import { applyTheme } from './world.js';

let fpsEl, debugEl, controlsEl, settingsPanel;
let showFps = true;
let showDebug = false;
let frames = 0;
let lastTime = performance.now();

export function initUI() {
  fpsEl = document.getElementById('fps-counter');
  debugEl = document.getElementById('debug-info');
  controlsEl = document.getElementById('controls-hint');
  settingsPanel = document.getElementById('settings-panel');

  // Speed slider
  const speedSlider = document.getElementById('speed-slider');
  const speedVal = document.getElementById('speed-val');
  if (speedSlider && speedVal) {
    speedSlider.addEventListener('input', () => {
      settings.walkSpeed = parseFloat(speedSlider.value);
      speedVal.textContent = speedSlider.value;
    });
  }

  // Gravity slider
  const gravSlider = document.getElementById('grav-slider');
  const gravVal = document.getElementById('grav-val');
  if (gravSlider && gravVal) {
    gravSlider.addEventListener('input', () => {
      settings.gravityZoneStrength = parseFloat(gravSlider.value);
      gravVal.textContent = gravSlider.value;
    });
  }

  // Invert Mouse Y dropdown
  const invertYSelect = document.getElementById('invert-y-select');
  if (invertYSelect) {
    invertYSelect.value = settings.invertMouseY ? 'inverted' : 'normal';
    invertYSelect.addEventListener('change', () => {
      settings.invertMouseY = invertYSelect.value === 'inverted';
    });
  }

  // Theme dropdown
  const themeSelect = document.getElementById('theme-select');
  if (themeSelect) {
    themeSelect.value = settings.colorTheme;
    applyTheme(settings.colorTheme);
    applyHudTheme(settings.colorTheme);
    themeSelect.addEventListener('change', () => {
      settings.colorTheme = themeSelect.value;
      applyTheme(themeSelect.value);
      applyHudTheme(themeSelect.value);
    });
  }

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

function applyHudTheme(themeName) {
  const themes = {
    dark:  { text: '#0ff', bg: 'rgba(5, 5, 20, 0.9)', border: 'rgba(0, 255, 255, 0.2)', label: '#8af', accent: '#0ff' },
    light: { text: '#226', bg: 'rgba(240, 245, 250, 0.9)', border: 'rgba(50, 50, 100, 0.2)', label: '#446', accent: '#226' },
    soft:  { text: '#9bd', bg: 'rgba(20, 20, 35, 0.9)', border: 'rgba(150, 180, 220, 0.2)', label: '#8ab', accent: '#9bd' },
  };
  const t = themes[themeName] || themes.dark;
  const hud = document.getElementById('hud');
  if (hud) hud.style.color = t.text;
  if (settingsPanel) {
    settingsPanel.style.background = t.bg;
    settingsPanel.style.borderColor = t.border;
  }
  if (controlsEl) controlsEl.style.color = t.label;
  const accents = controlsEl ? controlsEl.querySelectorAll('span') : [];
  accents.forEach(s => s.style.color = t.accent);
}

export function updateUI(playerPos, bodyCount, playerState, npcCount, weapon) {
  const npcEl = document.getElementById('npc-counter');
  if (npcEl) npcEl.textContent = `Enemies: ${npcCount ?? 0}`;
  const wpnEl = document.getElementById('weapon-indicator');
  if (wpnEl && weapon) wpnEl.textContent = `[${weapon.key === 'pistol' ? 1 : weapon.key === 'shotgun' ? 2 : 3}] ${weapon.name}`;

  frames++;
  const now = performance.now();
  if (now - lastTime >= 500) {
    const fps = Math.round((frames * 1000) / (now - lastTime));
    if (fpsEl) fpsEl.textContent = `${fps} FPS`;
    frames = 0;
    lastTime = now;
  }

  if (showDebug && debugEl) {
    debugEl.innerHTML =
      `pos: ${playerPos.x.toFixed(1)}, ${playerPos.y.toFixed(1)}, ${playerPos.z.toFixed(1)}<br>` +
      `speed: ${playerState.speed} u/s<br>` +
      `bodies: ${bodyCount}<br>` +
      `jumps: ${playerState.jumpsLeft}<br>` +
      `dash cd: ${playerState.dashCooldown}s` +
      (playerState.dashing ? ' <span style="color:#0f0">DASH</span>' : '') +
      (playerState.sliding ? ' <span style="color:#0af">SLIDE</span>' : '') +
      (playerState.slamming ? ' <span style="color:#f44">SLAM</span>' : '') +
      (playerState.onIce ? ' <span style="color:#aef">ICE</span>' : '');
  }
}
