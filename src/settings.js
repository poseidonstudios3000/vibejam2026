// Shared game settings — adjusted via HUD sliders and dropdowns

export const settings = {
  walkSpeed: 8,
  gravityZoneStrength: 15,
  colorTheme: 'light', // 'dark' | 'light' | 'soft'
  invertMouseY: true, // true = inverted (default); false = mouse up looks up
};

export const themes = {
  dark: {
    sky: ['#0a0020', '#1a0a4e', '#0d1a3a', '#050510'],
    fog: 0x050510,
    fogDensity: 0.006,
    ground: 0x111122,
    grid1: 0x222244,
    grid2: 0x181830,
    ambient: 0x334466,
    ambientIntensity: 0.6,
    sunColor: 0xffeedd,
    sunIntensity: 1.5,
    labelColor: '#0ff',
    hudText: '#0ff',
    hudBg: 'rgba(5, 5, 20, 0.9)',
    hudBorder: 'rgba(0, 255, 255, 0.2)',
  },
  light: {
    sky: ['#87ceeb', '#b0e0ff', '#d4edfc', '#f0f8ff'],
    fog: 0xe8f4f8,
    fogDensity: 0.004,
    ground: 0xc8d8c8,
    grid1: 0xaabbaa,
    grid2: 0xbbccbb,
    ambient: 0xffffff,
    ambientIntensity: 1.0,
    sunColor: 0xffffff,
    sunIntensity: 2.0,
    labelColor: '#226',
    hudText: '#226',
    hudBg: 'rgba(240, 245, 250, 0.9)',
    hudBorder: 'rgba(50, 50, 100, 0.2)',
  },
  soft: {
    sky: ['#1a1028', '#2a1848', '#1e2040', '#151520'],
    fog: 0x151520,
    fogDensity: 0.005,
    ground: 0x1e1e2e,
    grid1: 0x2e2e4e,
    grid2: 0x252540,
    ambient: 0x667799,
    ambientIntensity: 0.8,
    sunColor: 0xffddc8,
    sunIntensity: 1.2,
    labelColor: '#9bd',
    hudText: '#9bd',
    hudBg: 'rgba(20, 20, 35, 0.9)',
    hudBorder: 'rgba(150, 180, 220, 0.2)',
  },
};
