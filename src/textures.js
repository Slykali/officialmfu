// Procedurally drawn canvas textures, so the game needs no image assets.
import * as THREE from 'three';

// Older browsers lack roundRect; fall back to a plain rectangle path.
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function roundRect(x, y, w, h) {
    this.rect(x, y, w, h);
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function tex(c, repeat = false) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = THREE.RepeatWrapping;
    t.wrapT = THREE.RepeatWrapping;
  }
  return t;
}

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gravelTexture() {
  const [c, g] = canvas(256, 256);
  const r = seeded(7);
  g.fillStyle = '#6f675e';
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const v = 70 + Math.floor(r() * 80);
    g.fillStyle = `rgb(${v + 8},${v},${v - 8})`;
    const s = 1 + r() * 3;
    g.fillRect(r() * 256, r() * 256, s, s);
  }
  return tex(c, true);
}

export function concreteTexture() {
  const [c, g] = canvas(512, 64);
  const r = seeded(11);
  g.fillStyle = '#a7a39b';
  g.fillRect(0, 0, 512, 64);
  for (let i = 0; i < 900; i++) {
    const v = 140 + Math.floor(r() * 60);
    g.fillStyle = `rgba(${v},${v},${v - 6},0.5)`;
    g.fillRect(r() * 512, r() * 64, 2, 2);
  }
  // panel seams
  g.fillStyle = 'rgba(0,0,0,0.25)';
  for (let x = 0; x < 512; x += 128) g.fillRect(x, 0, 3, 64);
  // graffiti blobs
  const colors = ['#ff4d6d', '#3bc9db', '#ffd43b', '#9775fa', '#51cf66', '#ff922b'];
  for (let i = 0; i < 5; i++) {
    const x = 30 + r() * 450;
    const col = colors[Math.floor(r() * colors.length)];
    g.lineWidth = 7;
    g.lineCap = 'round';
    g.strokeStyle = col;
    g.beginPath();
    g.moveTo(x, 20 + r() * 25);
    for (let k = 0; k < 4; k++) g.quadraticCurveTo(x + k * 14 + r() * 20, 8 + r() * 48, x + (k + 1) * 16, 15 + r() * 35);
    g.stroke();
    g.lineWidth = 2;
    g.strokeStyle = '#1b1b1b';
    g.stroke();
  }
  return tex(c, true);
}

export function facadeTexture() {
  const [c, g] = canvas(128, 128);
  const r = seeded(23);
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 4; y++) {
    for (let x = 0; x < 4; x++) {
      const lit = r() < 0.3;
      g.fillStyle = lit ? '#fff3b0' : '#5b6b80';
      g.fillRect(x * 32 + 7, y * 32 + 7, 18, 20);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(x * 32 + 7, y * 32 + 25, 18, 3);
    }
  }
  return tex(c, true);
}

export const LIVERIES = [
  { base: '#e9e9e4', stripe: '#d62828', accent: '#1d3557' },
  { base: '#2f6fd6', stripe: '#ffd23f', accent: '#0b2545' },
  { base: '#3aa655', stripe: '#f1faee', accent: '#1b4332' },
  { base: '#ee8a1c', stripe: '#2b2d42', accent: '#5a2a00' },
  { base: '#b9c3cc', stripe: '#e63946', accent: '#22223b' }, // oncoming
];

export function trainSideTexture(livery, seed) {
  const L = LIVERIES[livery];
  const [c, g] = canvas(512, 128);
  const r = seeded(seed);
  g.fillStyle = L.base;
  g.fillRect(0, 0, 512, 128);
  g.fillStyle = L.stripe;
  g.fillRect(0, 88, 512, 14);
  g.fillStyle = L.accent;
  g.fillRect(0, 104, 512, 6);
  // windows and doors
  for (let i = 0; i < 6; i++) {
    const x = 18 + i * 82;
    if (i === 2) {
      g.fillStyle = L.accent;
      g.fillRect(x, 18, 44, 98);
      g.fillStyle = '#9fd3f5';
      g.fillRect(x + 6, 26, 14, 40);
      g.fillRect(x + 24, 26, 14, 40);
    } else {
      g.fillStyle = '#20324a';
      g.fillRect(x, 26, 58, 42);
      g.fillStyle = 'rgba(160,215,255,0.55)';
      g.fillRect(x + 4, 30, 22, 14);
    }
  }
  // graffiti tag
  if (r() < 0.8) {
    const colors = ['#ff006e', '#8338ec', '#3a86ff', '#fb5607', '#06d6a0'];
    g.font = 'bold 34px Arial Black, Impact, sans-serif';
    g.lineWidth = 6;
    g.strokeStyle = '#111';
    const word = ['RUSH', 'ZOOM', 'GO!', 'WOW', 'YO', 'FLY'][Math.floor(r() * 6)];
    const x = 40 + r() * 330;
    g.strokeText(word, x, 120);
    g.fillStyle = colors[Math.floor(r() * colors.length)];
    g.fillText(word, x, 120);
  }
  // panel lines
  g.fillStyle = 'rgba(0,0,0,0.18)';
  g.fillRect(0, 0, 512, 4);
  g.fillRect(0, 0, 4, 128);
  g.fillRect(508, 0, 4, 128);
  return tex(c);
}

export function trainFrontTexture(livery, lit) {
  const L = LIVERIES[livery];
  const [c, g] = canvas(256, 256);
  g.fillStyle = L.base;
  g.fillRect(0, 0, 256, 256);
  g.fillStyle = L.accent;
  g.fillRect(0, 0, 256, 10);
  // windscreen
  g.fillStyle = '#1b2a3c';
  g.beginPath();
  g.roundRect(26, 30, 204, 92, 14);
  g.fill();
  g.fillStyle = 'rgba(170,220,255,0.5)';
  g.beginPath();
  g.moveTo(40, 40); g.lineTo(110, 40); g.lineTo(60, 110); g.lineTo(40, 110);
  g.fill();
  // stripe
  g.fillStyle = L.stripe;
  g.fillRect(0, 172, 256, 22);
  // headlights
  for (const x of [48, 208]) {
    g.fillStyle = lit ? '#fffbe0' : '#f4e7a1';
    g.beginPath();
    g.arc(x, 150, 15, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = '#333';
    g.lineWidth = 3;
    g.stroke();
  }
  g.fillStyle = '#222';
  g.fillRect(96, 210, 64, 30);
  g.fillStyle = '#ffd23f';
  g.font = 'bold 22px sans-serif';
  g.textAlign = 'center';
  g.fillText(lit ? '!!' : '07', 128, 233);
  return tex(c);
}

export function trainEndTexture(livery) {
  const L = LIVERIES[livery];
  const [c, g] = canvas(128, 128);
  g.fillStyle = L.base;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = L.accent;
  g.fillRect(34, 18, 60, 104);
  g.fillStyle = '#20324a';
  g.fillRect(44, 28, 40, 34);
  g.fillStyle = L.stripe;
  g.fillRect(0, 86, 34, 10);
  g.fillRect(94, 86, 34, 10);
  return tex(c);
}

export function stripeTexture(a, b, w = 256, h = 64) {
  const [c, g] = canvas(w, h);
  g.fillStyle = a;
  g.fillRect(0, 0, w, h);
  g.fillStyle = b;
  for (let x = -h; x < w + h; x += 48) {
    g.beginPath();
    g.moveTo(x, h);
    g.lineTo(x + 24, h);
    g.lineTo(x + 24 + h, 0);
    g.lineTo(x + h, 0);
    g.fill();
  }
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 4;
  g.strokeRect(2, 2, w - 4, h - 4);
  return tex(c);
}

export function skyTexture() {
  const [c, g] = canvas(4, 256);
  const grad = g.createLinearGradient(0, 0, 0, 256);
  grad.addColorStop(0, '#3d8fe0');
  grad.addColorStop(0.5, '#9fd2fb');
  grad.addColorStop(0.62, '#cfe9ff');
  grad.addColorStop(1, '#cfe9ff');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 256);
  return tex(c);
}

// Round power-up badges.
export function powerTexture(type) {
  const [c, g] = canvas(128, 128);
  const colors = {
    magnet: '#ff4d4d', multiplier: '#ffb703', sneakers: '#38d66b', jetpack: '#4dabf7', board: '#c77dff',
  };
  const col = colors[type];
  const glow = g.createRadialGradient(64, 64, 30, 64, 64, 64);
  glow.addColorStop(0, col);
  glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.arc(64, 64, 40, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = 6;
  g.strokeStyle = col;
  g.stroke();
  g.save();
  g.translate(64, 64);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (type === 'magnet') {
    g.lineWidth = 14;
    g.strokeStyle = '#e03131';
    g.beginPath();
    g.arc(0, -2, 16, Math.PI, 0, true);
    g.stroke();
    g.beginPath();
    g.moveTo(-16, -2); g.lineTo(-16, -18);
    g.moveTo(16, -2); g.lineTo(16, -18);
    g.stroke();
    g.strokeStyle = '#dee2e6';
    g.beginPath();
    g.moveTo(-16, -16); g.lineTo(-16, -24);
    g.moveTo(16, -16); g.lineTo(16, -24);
    g.stroke();
    g.rotate(0);
  } else if (type === 'multiplier') {
    g.fillStyle = '#f08c00';
    g.font = 'bold 40px Arial Black, Impact, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText('2X', 0, 3);
  } else if (type === 'sneakers') {
    g.fillStyle = '#2f9e44';
    g.beginPath();
    g.moveTo(-24, 10); g.lineTo(-22, -14); g.lineTo(-6, -14); g.lineTo(0, -2);
    g.lineTo(18, 2); g.quadraticCurveTo(28, 6, 26, 12); g.lineTo(-24, 12);
    g.fill();
    g.fillStyle = '#fff';
    g.fillRect(-24, 10, 50, 5);
    g.strokeStyle = '#fff';
    g.lineWidth = 3;
    g.beginPath();
    g.moveTo(-6, -8); g.lineTo(2, -6); g.moveTo(-4, -2); g.lineTo(6, 0);
    g.stroke();
  } else if (type === 'jetpack') {
    g.fillStyle = '#868e96';
    g.beginPath(); g.roundRect(-20, -24, 16, 36, 7); g.fill();
    g.beginPath(); g.roundRect(4, -24, 16, 36, 7); g.fill();
    g.fillStyle = '#ff922b';
    g.beginPath(); g.moveTo(-18, 14); g.lineTo(-12, 28); g.lineTo(-6, 14); g.fill();
    g.beginPath(); g.moveTo(6, 14); g.lineTo(12, 28); g.lineTo(18, 14); g.fill();
  } else if (type === 'board') {
    g.rotate(-0.5);
    g.fillStyle = '#9c36b5';
    g.beginPath(); g.roundRect(-30, -9, 60, 18, 9); g.fill();
    g.fillStyle = '#ffd43b';
    g.fillRect(-14, -9, 6, 18);
    g.fillRect(8, -9, 6, 18);
  }
  g.restore();
  return tex(c);
}
