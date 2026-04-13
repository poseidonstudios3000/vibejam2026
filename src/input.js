const keys = {};
const justPressedKeys = {};
let mx = 0;
let my = 0;
let pointerLocked = false;

window.addEventListener('keydown', (e) => {
  if (!keys[e.code]) {
    justPressedKeys[e.code] = true;
  }
  keys[e.code] = true;
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
    e.preventDefault();
  }
});

window.addEventListener('keyup', (e) => {
  keys[e.code] = false;
});

window.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement) {
    mx += e.movementX;
    my += e.movementY;
  }
});

document.addEventListener('pointerlockchange', () => {
  pointerLocked = !!document.pointerLockElement;
  const prompt = document.getElementById('click-prompt');
  if (prompt) prompt.style.display = pointerLocked ? 'none' : 'block';
});

export const input = {
  isDown(code) {
    return !!keys[code];
  },

  justPressed(code) {
    return !!justPressedKeys[code];
  },

  mouseDelta() {
    const dx = mx;
    const dy = my;
    mx = 0;
    my = 0;
    return { x: dx, y: dy };
  },

  flush() {
    for (const key in justPressedKeys) {
      delete justPressedKeys[key];
    }
  },

  get isPointerLocked() {
    return pointerLocked;
  },

  requestPointerLock(element) {
    element.requestPointerLock();
  },
};
