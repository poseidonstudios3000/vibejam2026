let fpsEl;
let debugEl;
let showFps = true;
let showDebug = false;
let frames = 0;
let lastTime = performance.now();

export function initUI() {
  fpsEl = document.getElementById('fps-counter');
  debugEl = document.getElementById('debug-info');

  window.addEventListener('keydown', (e) => {
    if (e.code === 'KeyF' && !e.ctrlKey && !e.metaKey) {
      showFps = !showFps;
      fpsEl.style.display = showFps ? 'block' : 'none';
    }
    if (e.code === 'Backquote') {
      showDebug = !showDebug;
      debugEl.style.display = showDebug ? 'block' : 'none';
    }
  });
}

export function updateUI(playerPos, bodyCount) {
  frames++;
  const now = performance.now();
  if (now - lastTime >= 500) {
    const fps = Math.round((frames * 1000) / (now - lastTime));
    fpsEl.textContent = `${fps} FPS`;
    frames = 0;
    lastTime = now;
  }

  if (showDebug && debugEl) {
    debugEl.textContent =
      `pos: ${playerPos.x.toFixed(1)}, ${playerPos.y.toFixed(1)}, ${playerPos.z.toFixed(1)}\n` +
      `bodies: ${bodyCount}`;
  }
}
