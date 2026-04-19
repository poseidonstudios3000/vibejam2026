// Shared game settings

export const settings = {
  walkSpeed: 8,
  colorTheme: 'frost', // 'mystic' | 'frost' | 'sandstone' | 'void'
  invertMouseY: false,
  pitchClampDeg: 25,
};

export const themes = {
  // --- MYSTIC: rich purple/gold, medium brightness, fantasy magic feel.
  //     Warm gold light makes characters glow, purple ground gives depth ---
  mystic: {
    sky: ['#2a1545', '#4a2878', '#352060', '#1a1030'],
    fog: 0x1a1030,
    fogDensity: 0.003,
    ground: 0x2a2040,
    grid1: 0x443868,
    grid2: 0x362a55,
    ambient: 0xaa88dd,
    ambientIntensity: 1.2,
    sunColor: 0xffd088,
    sunIntensity: 2.0,
    labelColor: '#eebb55',
    hudAccent: '#eebb55',
    wallColor: 0x5a4480,
    coverColor: 0x4a3870,
    platColor: 0x6a5090,
    rampColor: 0x7a60a0,
  },

  // --- FROST: bright icy blue-white, high contrast, clean readability.
  //     Almost daylight-level brightness with cool tones, characters are very visible ---
  frost: {
    sky: ['#4488bb', '#6699cc', '#88bbdd', '#aaddee'],
    fog: 0xbbddee,
    fogDensity: 0.002,
    ground: 0x889aaa,
    grid1: 0x99aabb,
    grid2: 0x7799aa,
    ambient: 0xccddee,
    ambientIntensity: 1.6,
    sunColor: 0xffffff,
    sunIntensity: 2.5,
    labelColor: '#224466',
    hudAccent: '#224466',
    wallColor: 0x7788aa,
    coverColor: 0x6688a0,
    platColor: 0x8899bb,
    rampColor: 0x99aacc,
  },

  // --- SANDSTONE: warm desert/ancient temple, earthy oranges and browns.
  //     Medium-high brightness, golden hour lighting, great character contrast ---
  sandstone: {
    sky: ['#cc8844', '#ddaa66', '#eebb77', '#ffddaa'],
    fog: 0xddbb88,
    fogDensity: 0.003,
    ground: 0x8a7560,
    grid1: 0x998870,
    grid2: 0x887760,
    ambient: 0xddbb88,
    ambientIntensity: 1.3,
    sunColor: 0xffcc77,
    sunIntensity: 2.2,
    labelColor: '#553311',
    hudAccent: '#ffddaa',
    wallColor: 0x9a8568,
    coverColor: 0x887558,
    platColor: 0xaa9575,
    rampColor: 0xbba585,
  },

  // --- DARK: midnight sky, cool moonlight ambient — moody night arena ---
  dark: {
    sky: ['#020510', '#050920', '#0a1030', '#152040'],
    fog: 0x050b20,
    fogDensity: 0.004,
    ground: 0x1a2030,
    grid1: 0x2a3040,
    grid2: 0x202838,
    ambient: 0x334466,
    ambientIntensity: 0.75,
    sunColor: 0x7788cc,
    sunIntensity: 1.1,
    labelColor: '#88aadd',
    hudAccent: '#88aadd',
    wallColor: 0x2a3444,
    coverColor: 0x243040,
    platColor: 0x344050,
    rampColor: 0x405060,
  },

  // --- MAGIC: violet aurora sky, mystical ambient — MANA FIGHT flavor ---
  magic: {
    sky: ['#1a0833', '#3a1055', '#5a2288', '#8844cc'],
    fog: 0x2a1544,
    fogDensity: 0.003,
    ground: 0x3a2a55,
    grid1: 0x5a4080,
    grid2: 0x4a3370,
    ambient: 0xaa88dd,
    ambientIntensity: 1.15,
    sunColor: 0xccaaff,
    sunIntensity: 1.7,
    labelColor: '#eecbff',
    hudAccent: '#eecbff',
    wallColor: 0x6a4a90,
    coverColor: 0x5a3e80,
    platColor: 0x7a55a0,
    rampColor: 0x8a65b0,
  },

  // --- VOID: deep black with neon accent pops, high contrast dark mode.
  //     Nearly black environment, characters and spells glow intensely ---
  void: {
    sky: ['#020208', '#050510', '#080818', '#030308'],
    fog: 0x020205,
    fogDensity: 0.008,
    ground: 0x0a0a12,
    grid1: 0x181828,
    grid2: 0x101018,
    ambient: 0x445566,
    ambientIntensity: 0.4,
    sunColor: 0x8888ff,
    sunIntensity: 1.0,
    labelColor: '#44ffaa',
    hudAccent: '#44ffaa',
    wallColor: 0x181825,
    coverColor: 0x14141e,
    platColor: 0x20202e,
    rampColor: 0x282838,
  },
};
