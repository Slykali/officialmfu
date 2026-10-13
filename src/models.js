// Mesh builders for every object in the game. Geometries and materials are
// shared and cached so spawning objects is cheap.
import * as THREE from 'three';
import { TRAIN, RAMP_L, HURDLE, OVERHEAD } from './config.js';
import {
  trainSideTexture, trainFrontTexture, trainEndTexture, stripeTexture, powerTexture, glowTexture, chevronTexture,
  POWER_COLORS,
} from './textures.js';

const geoCache = new Map();
function box(w, h, d) {
  const key = `${w}|${h}|${d}`;
  let g = geoCache.get(key);
  if (!g) {
    g = new THREE.BoxGeometry(w, h, d);
    geoCache.set(key, g);
  }
  return g;
}

const matCache = new Map();
export function mat(color, opts = {}) {
  const key = `${color}|${JSON.stringify(opts)}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.05, ...opts });
    matCache.set(key, m);
  }
  return m;
}

function mesh(geo, material, x = 0, y = 0, z = 0, shadow = true) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  return m;
}

// ---------------------------------------------------------------- characters
// Blocky character. Forward is -Z. The root sits at the feet.
export function makeCharacter(o) {
  const root = new THREE.Group();
  const pivot = new THREE.Group(); // rotation centre for rolling
  pivot.position.y = 0.9;
  root.add(pivot);
  const body = new THREE.Group();
  body.position.y = -0.9;
  pivot.add(body);

  const skin = mat(o.skin);
  const shirt = mat(o.shirt);
  const pants = mat(o.pants);
  const shoes = mat(o.shoes);

  const legs = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.14, 0.82, 0);
    leg.add(mesh(box(0.21, 0.74, 0.24), pants, 0, -0.37, 0));
    leg.add(mesh(box(0.25, 0.14, 0.38), shoes, 0, -0.76, -0.06));
    if (o.soles) leg.add(mesh(box(0.26, 0.04, 0.39), mat(o.soles), 0, -0.82, -0.06));
    body.add(leg);
    legs.push(leg);
  }
  body.add(mesh(box(0.6, 0.64, 0.34), shirt, 0, 1.13, 0));
  if (o.stripe) {
    body.add(mesh(box(0.62, 0.09, 0.36), mat(o.stripe), 0, 1.2, 0));
    body.add(mesh(box(0.06, 0.6, 0.36), mat(o.stripe), 0, 1.13, 0.001));
  }
  if (o.backpack) body.add(mesh(box(0.44, 0.46, 0.2), mat(o.backpack), 0, 1.16, 0.26));
  if (o.badge) body.add(mesh(box(0.12, 0.12, 0.04), mat('#ffd43b', { metalness: 0.6, roughness: 0.3 }), -0.15, 1.28, -0.18));
  if (o.belt) body.add(mesh(box(0.62, 0.08, 0.36), mat(o.belt === true ? '#222' : o.belt), 0, 0.84, 0));

  const arms = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.39, 1.4, 0);
    arm.add(mesh(box(0.17, 0.58, 0.19), mat(o.sleeves || o.shirt), 0, -0.27, 0));
    if (o.stripe) arm.add(mesh(box(0.18, 0.08, 0.2), mat(o.stripe), 0, -0.42, 0));
    arm.add(mesh(box(0.15, 0.13, 0.17), o.gloves ? mat(o.gloves) : skin, 0, -0.6, 0));
    body.add(arm);
    arms.push(arm);
  }

  const head = new THREE.Group();
  head.position.set(0, 1.47, 0);
  head.add(mesh(box(0.42, 0.42, 0.42), skin, 0, 0.21, 0));
  const eye = mat('#1b1b1b');
  head.add(mesh(box(0.07, 0.08, 0.02), eye, -0.1, 0.25, -0.215, false));
  head.add(mesh(box(0.07, 0.08, 0.02), eye, 0.1, 0.25, -0.215, false));
  head.add(mesh(box(0.12, 0.03, 0.02), mat('#7a3b2e'), 0, 0.1, -0.215, false));

  if (o.hair) {
    const hm = mat(o.hair);
    head.add(mesh(box(0.44, 0.08, 0.44), hm, 0, 0.44, 0));
    head.add(mesh(box(0.44, 0.24, 0.08), hm, 0, 0.3, 0.19));
    if (o.hairStyle === 'bun') head.add(mesh(box(0.2, 0.18, 0.2), hm, 0, 0.56, 0.1));
    if (o.hairStyle === 'long') head.add(mesh(box(0.44, 0.5, 0.1), hm, 0, 0.18, 0.22));
    if (o.hairStyle === 'spiky') {
      for (const [x, z, r] of [[-0.12, -0.08, 0.3], [0.02, 0.02, -0.1], [0.14, -0.06, -0.35], [0, 0.14, 0.15]]) {
        const sp = mesh(box(0.1, 0.18, 0.1), hm, x, 0.54, z);
        sp.rotation.z = r;
        head.add(sp);
      }
    }
  }
  if (o.hat === 'cap' || o.hat === 'capFwd') {
    const capM = mat(o.hatColor);
    head.add(mesh(box(0.46, 0.13, 0.46), capM, 0, 0.47, 0));
    head.add(mesh(box(0.42, 0.05, 0.24), capM, 0, 0.43, o.hat === 'capFwd' ? -0.32 : 0.32));
  } else if (o.hat === 'beanie') {
    const bm = mat(o.hatColor);
    head.add(mesh(box(0.46, 0.2, 0.46), bm, 0, 0.5, 0));
    head.add(mesh(box(0.48, 0.07, 0.48), mat(o.hatTrim || o.hatColor), 0, 0.41, 0));
    if (o.pompom) head.add(mesh(box(0.13, 0.13, 0.13), mat(o.pompom), 0, 0.66, 0));
  }
  if (o.glasses) {
    const gm = mat(o.glasses, { metalness: 0.3, roughness: 0.3 });
    head.add(mesh(box(0.42, 0.04, 0.03), gm, 0, 0.29, -0.225, false));
    head.add(mesh(box(0.13, 0.1, 0.03), gm, -0.1, 0.25, -0.228, false));
    head.add(mesh(box(0.13, 0.1, 0.03), gm, 0.1, 0.25, -0.228, false));
  }
  if (o.headphones) {
    const pm = mat(o.headphones, { metalness: 0.2, roughness: 0.4 });
    head.add(mesh(box(0.08, 0.2, 0.18), pm, -0.24, 0.24, 0));
    head.add(mesh(box(0.08, 0.2, 0.18), pm, 0.24, 0.24, 0));
    head.add(mesh(box(0.5, 0.06, 0.1), pm, 0, o.hat ? 0.58 : 0.5, 0));
  }
  body.add(head);

  root.scale.setScalar(o.scale || 1);
  root.traverse((c) => { if (c.isMesh) c.castShadow = true; });
  return { root, pivot, body, legs, arms, head };
}

let jetParts = null; // shared so swapping characters doesn't leak GPU buffers

export function makeRunner(look) {
  const c = makeCharacter(look);
  // hoverboard
  const board = new THREE.Group();
  board.add(mesh(box(0.62, 0.08, 1.45), mat('#9c36b5', { emissive: '#5a189a', emissiveIntensity: 0.6 }), 0, 0, 0));
  board.add(mesh(box(0.66, 0.03, 0.18), mat('#ffd43b', { emissive: '#ffd43b', emissiveIntensity: 0.5 }), 0, 0.05, -0.4));
  board.add(mesh(box(0.66, 0.03, 0.18), mat('#ffd43b', { emissive: '#ffd43b', emissiveIntensity: 0.5 }), 0, 0.05, 0.4));
  board.position.y = 0.04;
  board.visible = false;
  c.body.add(board);
  c.board = board;
  // jetpack
  const jet = new THREE.Group();
  if (!jetParts) {
    jetParts = {
      tank: new THREE.CylinderGeometry(0.11, 0.11, 0.55, 12),
      flameGeo: new THREE.ConeGeometry(0.1, 0.5, 10),
      flameMat: new THREE.MeshBasicMaterial({ color: '#ffa94d' }),
    };
  }
  const { tank, flameGeo, flameMat } = jetParts;
  for (const side of [-1, 1]) {
    jet.add(mesh(tank, mat('#adb5bd', { metalness: 0.7, roughness: 0.3 }), side * 0.13, 1.15, 0.42));
    const f = new THREE.Mesh(flameGeo, flameMat);
    f.rotation.x = Math.PI;
    f.position.set(side * 0.13, 0.65, 0.42);
    jet.add(f);
  }
  jet.visible = false;
  c.body.add(jet);
  c.jetpack = jet;
  c.flames = jet.children.filter((m) => m.geometry === flameGeo);
  return c;
}

export function makeGuard() {
  return makeCharacter({
    skin: '#e0ac69', shirt: '#1d3557', pants: '#14213d', shoes: '#111111', hat: 'capFwd', hatColor: '#14213d',
    badge: true, belt: true, scale: 1.05,
  });
}

// Blocky guard dog. Forward is -Z, root at the paws.
export function makeDog() {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const fur = mat('#a0662f');
  const light = mat('#e9c99a');
  const dark = mat('#4a2c17');
  body.add(mesh(box(0.34, 0.32, 0.82), fur, 0, 0.56, 0));
  body.add(mesh(box(0.3, 0.12, 0.5), light, 0, 0.42, -0.1));
  body.add(mesh(box(0.37, 0.07, 0.09), mat('#e03131'), 0, 0.7, -0.36)); // collar
  const head = new THREE.Group();
  head.position.set(0, 0.78, -0.48);
  head.add(mesh(box(0.3, 0.3, 0.32), fur, 0, 0, 0));
  head.add(mesh(box(0.2, 0.15, 0.22), light, 0, -0.05, -0.24));
  head.add(mesh(box(0.08, 0.06, 0.05), mat('#111'), 0, 0.01, -0.36, false));
  head.add(mesh(box(0.05, 0.05, 0.02), mat('#111'), -0.08, 0.07, -0.165, false));
  head.add(mesh(box(0.05, 0.05, 0.02), mat('#111'), 0.08, 0.07, -0.165, false));
  for (const s of [-1, 1]) {
    const ear = mesh(box(0.08, 0.17, 0.08), dark, s * 0.12, 0.17, 0.06);
    ear.rotation.z = s * 0.25;
    head.add(ear);
  }
  body.add(head);
  const tail = new THREE.Group();
  tail.position.set(0, 0.66, 0.4);
  const tm = mesh(box(0.07, 0.07, 0.32), fur, 0, 0, 0.14);
  tail.add(tm);
  tail.rotation.x = 0.6;
  body.add(tail);
  const legs = [];
  for (const [x, z] of [[-0.11, -0.3], [0.11, -0.3], [-0.11, 0.3], [0.11, 0.3]]) {
    const leg = new THREE.Group();
    leg.position.set(x, 0.44, z);
    leg.add(mesh(box(0.1, 0.4, 0.1), fur, 0, -0.2, 0));
    leg.add(mesh(box(0.12, 0.06, 0.14), light, 0, -0.41, -0.02));
    body.add(leg);
    legs.push(leg);
  }
  root.traverse((c) => { if (c.isMesh) c.castShadow = true; });
  return { root, body, head, tail, legs };
}

// --------------------------------------------------------------------- trains
const trainMats = new Map();
function trainMaterials(livery, moving) {
  const key = `${livery}|${moving}`;
  let m = trainMats.get(key);
  if (!m) {
    const sides = [0, 1, 2].map((i) => new THREE.MeshStandardMaterial({
      map: trainSideTexture(livery, livery * 31 + i * 7 + 1), roughness: 0.55, metalness: 0.15,
    }));
    const front = new THREE.MeshStandardMaterial({
      map: trainFrontTexture(livery, moving), roughness: 0.5, metalness: 0.1,
      emissive: moving ? '#ffe066' : '#000000', emissiveIntensity: moving ? 0.25 : 0,
      emissiveMap: moving ? trainFrontTexture(livery, true) : null,
    });
    const end = new THREE.MeshStandardMaterial({ map: trainEndTexture(livery), roughness: 0.6 });
    const roof = mat('#8d99ae', { metalness: 0.4, roughness: 0.45 });
    const under = mat('#2b2d42');
    m = { sides, front, end, roof, under };
    trainMats.set(key, m);
  }
  return m;
}

let glowTex = null;
const sharedGlow = () => glowTex || (glowTex = glowTexture());

let rampGeo = null;
let rampMats = null;
let glowMat = null;
function rampGeometry() {
  if (rampGeo) return rampGeo;
  const w = 2.2;
  const L = RAMP_L;
  const H = TRAIN.height;
  const hw = w / 2;
  // Low end towards the player (+Z), high end at z = 0 against the train.
  const A = [-hw, 0, L]; const B = [hw, 0, L];
  const C = [-hw, H, 0]; const D = [hw, H, 0];
  const E = [-hw, 0, 0]; const F = [hw, 0, 0];
  const tris = [A, B, D, A, D, C, E, C, D, E, D, F, A, C, E, B, F, D];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris.flat(), 3));
  // chevrons on the slope only: u across, v up the ramp (4 repeats)
  const uv = new Array(tris.length * 2).fill(0);
  [[0, 0], [1, 0], [1, 4], [0, 0], [1, 4], [0, 4]].forEach(([u, v], i) => { uv[i * 2] = u; uv[i * 2 + 1] = v; });
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  g.addGroup(0, 6, 0);
  g.addGroup(6, 12, 1);
  rampGeo = g;
  return g;
}

// A train: the group origin is the front centre at ground level; cars extend along -Z.
export function makeTrain(t) {
  const g = new THREE.Group();
  const M = trainMaterials(t.livery, t.moving);
  const L = TRAIN.carLen;
  for (let i = 0; i < t.cars; i++) {
    const zc = -(i * L + L / 2);
    const faceNear = i === 0 ? M.front : M.end;
    const faceFar = M.end;
    const side = M.sides[(t.id + i) % 3];
    const bodyM = [side, side, M.roof, M.under, faceNear, faceFar];
    const bodyMesh = new THREE.Mesh(box(2.3, 3.0, L - 0.5), bodyM);
    bodyMesh.position.set(0, 0.55 + 1.5, zc);
    bodyMesh.castShadow = true;
    bodyMesh.receiveShadow = true;
    g.add(bodyMesh);
    const roof = mesh(box(2.1, 0.08, L - 0.9), M.roof, 0, TRAIN.height - 0.04, zc);
    roof.receiveShadow = true;
    g.add(roof);
    g.add(mesh(box(1.9, 0.55, L - 2.4), M.under, 0, 0.3, zc, false));
    if (i > 0) g.add(mesh(box(0.8, 0.5, 0.7), M.under, 0, 1.2, -(i * L), false));
  }
  if (t.ramp) {
    if (!rampMats) {
      rampMats = [
        new THREE.MeshStandardMaterial({ map: chevronTexture(), roughness: 0.55, metalness: 0.2 }),
        mat('#7a5c00', { metalness: 0.3, roughness: 0.6 }),
      ];
    }
    const r = new THREE.Mesh(rampGeometry(), rampMats);
    r.castShadow = true;
    r.receiveShadow = true;
    g.add(r);
  }
  if (t.moving) {
    // bright headlights and a flashing beacon so oncoming trains stand out
    if (!glowMat) {
      glowMat = new THREE.SpriteMaterial({
        map: sharedGlow(), color: '#fff6d5', blending: THREE.AdditiveBlending, depthWrite: false, transparent: true,
      });
    }
    for (const x of [-0.72, 0.72]) {
      const s = new THREE.Sprite(glowMat);
      s.scale.set(1.5, 1.5, 1);
      s.position.set(x, 1.79, 0.12);
      g.add(s);
    }
    const beacon = mesh(box(0.34, 0.18, 0.34), mat('#ff2a2a', { emissive: '#ff0000', emissiveIntensity: 2 }), 0, TRAIN.height + 0.09, -0.6, false);
    beacon.userData.beacon = true;
    g.add(beacon);
    g.userData.beacon = beacon;
  }
  return g;
}

// ------------------------------------------------------------------- barriers
let hurdleMats = null;
let overheadMats = null;

export function makeHurdle() {
  if (!hurdleMats) {
    hurdleMats = {
      board: new THREE.MeshStandardMaterial({ map: stripeTexture('#ffffff', '#e03131'), roughness: 0.6 }),
      post: mat('#495057', { metalness: 0.5 }),
      plank: mat('#f8f9fa'),
    };
  }
  const g = new THREE.Group();
  const h = HURDLE.y1;
  for (const s of [-1, 1]) {
    g.add(mesh(box(0.12, h, 0.12), hurdleMats.post, s * 1.0, h / 2, 0));
    g.add(mesh(box(0.14, 0.06, 0.6), hurdleMats.post, s * 1.0, 0.03, 0));
  }
  g.add(mesh(box(2.2, 0.42, 0.1), hurdleMats.board, 0, h - 0.25, 0));
  g.add(mesh(box(2.05, 0.1, 0.08), hurdleMats.plank, 0, 0.3, 0));
  return g;
}

export function makeOverhead() {
  if (!overheadMats) {
    overheadMats = {
      board: new THREE.MeshStandardMaterial({ map: stripeTexture('#ffd43b', '#212529'), roughness: 0.6 }),
      post: mat('#343a40', { metalness: 0.5 }),
      lamp: mat('#ff4d4d', { emissive: '#ff2020', emissiveIntensity: 1.5 }),
    };
  }
  const g = new THREE.Group();
  const top = OVERHEAD.y1;
  for (const s of [-1, 1]) {
    g.add(mesh(box(0.14, top, 0.14), overheadMats.post, s * 1.08, top / 2, 0));
    g.add(mesh(box(0.2, 0.06, 0.7), overheadMats.post, s * 1.08, 0.03, 0));
  }
  const b0 = OVERHEAD.y0 + 0.05;
  g.add(mesh(box(2.3, top - b0 - 0.15, 0.12), overheadMats.board, 0, (b0 + top - 0.15) / 2, 0));
  g.add(mesh(box(2.3, 0.12, 0.16), overheadMats.post, 0, top - 0.06, 0));
  g.add(mesh(box(0.22, 0.14, 0.14), overheadMats.lamp, 0, top + 0.07, 0, false));
  return g;
}

// ------------------------------------------------------------- pickups
let coinGeo = null;
let coinMat = null;
export function makeCoin() {
  if (!coinGeo) {
    coinGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.09, 20);
    coinGeo.rotateX(Math.PI / 2);
    coinMat = new THREE.MeshStandardMaterial({
      color: '#ffd23f', metalness: 0.85, roughness: 0.25, emissive: '#b8860b', emissiveIntensity: 0.45,
    });
  }
  const m = new THREE.Mesh(coinGeo, coinMat);
  m.castShadow = false;
  return m;
}

// Power-up orb: a glowing bubble with the power's icon floating inside.
const orbParts = new Map();
let orbGeo = null;
let ringGeo = null;
export function makePower(type) {
  if (!orbGeo) {
    orbGeo = new THREE.SphereGeometry(0.62, 24, 16);
    ringGeo = new THREE.TorusGeometry(0.8, 0.06, 8, 40);
  }
  let p = orbParts.get(type);
  if (!p) {
    const col = POWER_COLORS[type];
    p = {
      shell: new THREE.MeshStandardMaterial({
        color: col, emissive: col, emissiveIntensity: 0.7, transparent: true, opacity: 0.22,
        roughness: 0.1, metalness: 0.1, depthWrite: false,
      }),
      ring: new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.85 }),
      icon: new THREE.SpriteMaterial({ map: powerTexture(type), depthWrite: false, depthTest: true }),
      glow: new THREE.SpriteMaterial({
        map: sharedGlow(), color: col, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.9,
      }),
    };
    orbParts.set(type, p);
  }
  const g = new THREE.Group();
  const glow = new THREE.Sprite(p.glow);
  glow.scale.set(3, 3, 1);
  g.add(glow);
  const icon = new THREE.Sprite(p.icon);
  icon.scale.set(1.3, 1.3, 1);
  icon.renderOrder = 3; // draw the icon over the bubble so it stays crisp
  g.add(icon);
  const shell = new THREE.Mesh(orbGeo, p.shell);
  shell.renderOrder = 2;
  g.add(shell);
  const ring = new THREE.Mesh(ringGeo, p.ring);
  g.add(ring);
  g.userData.ring = ring;
  return g;
}

// Expanding ring shown when an orb is collected.
export function makeBurst(type) {
  const m = new THREE.SpriteMaterial({
    map: sharedGlow(), color: POWER_COLORS[type] || '#ffd23f', blending: THREE.AdditiveBlending,
    depthWrite: false, transparent: true,
  });
  const s = new THREE.Sprite(m);
  s.scale.set(1, 1, 1);
  return s;
}
