// Procedural sound effects using Web Audio API — no external files needed

let ctx;
let masterGain;

// Throttle: prevent same sound from firing more than once per interval
const lastPlayed = {};
const MIN_INTERVAL = 80; // ms

function getCtx() {
  if (!ctx) {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    masterGain = ctx.createGain();
    masterGain.gain.value = 0.3;
    masterGain.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

function throttle(name) {
  const now = performance.now();
  if (lastPlayed[name] && now - lastPlayed[name] < MIN_INTERVAL) return true;
  lastPlayed[name] = now;
  return false;
}

function playTone(freq, duration, type = 'sine', vol = 0.3, detune = 0) {
  const c = getCtx();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.detune.value = detune;
  gain.gain.setValueAtTime(vol, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
  osc.connect(gain);
  gain.connect(masterGain);
  osc.start(c.currentTime);
  osc.stop(c.currentTime + duration);
}

function playNoise(duration, vol = 0.2, filter = 'highpass', filterFreq = 1000) {
  const c = getCtx();
  const bufferSize = Math.floor(c.sampleRate * duration);
  const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = Math.random() * 2 - 1;
  }
  const source = c.createBufferSource();
  source.buffer = buffer;

  const filt = c.createBiquadFilter();
  filt.type = filter;
  filt.frequency.value = filterFreq;

  const gain = c.createGain();
  gain.gain.setValueAtTime(vol, c.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);

  source.connect(filt);
  filt.connect(gain);
  gain.connect(masterGain);
  source.start(c.currentTime);
}

export const sfx = {
  jump() {
    if (throttle('jump')) return;
    playTone(220, 0.12, 'sine', 0.2);
    playTone(440, 0.1, 'sine', 0.15);
  },

  doubleJump() {
    if (throttle('doubleJump')) return;
    playTone(330, 0.08, 'sine', 0.2);
    playTone(660, 0.1, 'sine', 0.18);
    playTone(880, 0.08, 'triangle', 0.1);
  },

  wallJump() {
    if (throttle('wallJump')) return;
    playTone(280, 0.06, 'square', 0.1);
    playTone(560, 0.1, 'sine', 0.2);
    playNoise(0.05, 0.08, 'highpass', 3000);
  },

  land() {
    if (throttle('land')) return;
    playNoise(0.08, 0.12, 'lowpass', 400);
    playTone(80, 0.1, 'sine', 0.1);
  },

  dash() {
    if (throttle('dash')) return;
    playNoise(0.15, 0.15, 'bandpass', 2000);
    playTone(150, 0.08, 'sawtooth', 0.1);
    playTone(300, 0.12, 'sine', 0.08);
  },

  slam() {
    if (throttle('slam')) return;
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(600, c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, c.currentTime + 0.2);
    gain.gain.setValueAtTime(0.15, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.25);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(c.currentTime);
    osc.stop(c.currentTime + 0.25);
  },

  slamImpact() {
    if (throttle('slamImpact')) return;
    playNoise(0.25, 0.25, 'lowpass', 200);
    playTone(50, 0.3, 'sine', 0.2);
    playTone(35, 0.4, 'sine', 0.15);
  },

  bounce() {
    if (throttle('bounce')) return;
    playTone(300, 0.06, 'sine', 0.15);
    playTone(600, 0.1, 'sine', 0.2);
    playTone(900, 0.08, 'triangle', 0.1);
  },

  footstep() {
    if (throttle('footstep')) return;
    playNoise(0.04, 0.04, 'lowpass', 600 + Math.random() * 400);
  },

  push() {
    if (throttle('push')) return;
    playNoise(0.06, 0.06, 'lowpass', 300);
    playTone(60 + Math.random() * 30, 0.08, 'sine', 0.05);
  },
};
