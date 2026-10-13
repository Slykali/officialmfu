// Mesh builders for every object in the game. Geometries and materials are
// shared and cached so spawning objects is cheap.
import * as THREE from 'three';
import { TRAIN, RAMP_L, HURDLE, OVERHEAD } from './config.js';
import {
  trainSideTexture, trainFrontTexture, trainEndTexture, stripeTexture, powerTexture,
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
  const capM = mat(o.cap);

  const legs = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.14, 0.82, 0);
    leg.add(mesh(box(0.21, 0.74, 0.24), pants, 0, -0.37, 0));
    leg.add(mesh(box(0.25, 0.14, 0.38), shoes, 0, -0.76, -0.06));
    body.add(leg);
    legs.push(leg);
  }
  body.add(mesh(box(0.6, 0.64, 0.34), shirt, 0, 1.13, 0));
  if (o.backpack) body.add(mesh(box(0.44, 0.46, 0.2), mat(o.backpack), 0, 1.16, 0.26));
  if (o.badge) body.add(mesh(box(0.12, 0.12, 0.04), mat('#ffd43b', { metalness: 0.6, roughness: 0.3 }), -0.15, 1.28, -0.18));
  if (o.belt) body.add(mesh(box(0.62, 0.08, 0.36), mat('#222'), 0, 0.84, 0));

  const arms = [];
  for (const side of [-1, 1]) {
    const arm = new THREE.Group();
    arm.position.set(side * 0.39, 1.4, 0);
    arm.add(mesh(box(0.17, 0.58, 0.19), shirt, 0, -0.27, 0));
    arm.add(mesh(box(0.15, 0.13, 0.17), skin, 0, -0.6, 0));
    body.add(arm);
    arms.push(arm);
  }

  const head = new THREE.Group();
  head.position.set(0, 1.47, 0);
  head.add(mesh(box(0.42, 0.42, 0.42), skin, 0, 0.21, 0));
  const eye = mat('#1b1b1b');
  head.add(mesh(box(0.07, 0.08, 0.02), eye, -0.1, 0.25, -0.215, false));
  head.add(mesh(box(0.07, 0.08, 0.02), eye, 0.1, 0.25, -0.215, false));
  head.add(mesh(box(0.46, 0.13, 0.46), capM, 0, 0.47, 0));
  // brim: forward for the guard, backwards for the runner
  head.add(mesh(box(0.42, 0.05, 0.24), capM, 0, 0.43, o.brimForward ? -0.32 : 0.32));
  if (o.hair) head.add(mesh(box(0.44, 0.1, 0.1), mat(o.hair), 0, 0.36, 0.18));
  body.add(head);

  root.scale.setScalar(o.scale || 1);
  root.traverse((c) => { if (c.isMesh) c.castShadow = true; });
  return { root, pivot, body, legs, arms, head };
}

export function makeRunner() {
  const c = makeCharacter({
    skin: '#f1c27d', shirt: '#ff3d68', pants: '#2b59c3', shoes: '#f8f9fa', cap: '#ffd23f',
    backpack: '#3bc9db', hair: '#4a2c1d',
  });
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
  const tank = new THREE.CylinderGeometry(0.11, 0.11, 0.55, 12);
  const flameGeo = new THREE.ConeGeometry(0.1, 0.5, 10);
  const flameMat = new THREE.MeshBasicMaterial({ color: '#ffa94d' });
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
    skin: '#e0ac69', shirt: '#1d3557', pants: '#14213d', shoes: '#111111', cap: '#14213d',
    badge: true, belt: true, brimForward: true, scale: 1.12,
  });
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

let rampGeo = null;
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
    const r = new THREE.Mesh(rampGeometry(), [
      mat('#d9a404', { metalness: 0.5, roughness: 0.4 }),
      mat('#7a5c00', { metalness: 0.3, roughness: 0.6 }),
    ]);
    r.castShadow = true;
    r.receiveShadow = true;
    g.add(r);
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

const powerMats = new Map();
export function makePower(type) {
  let m = powerMats.get(type);
  if (!m) {
    m = new THREE.SpriteMaterial({ map: powerTexture(type), depthWrite: false });
    powerMats.set(type, m);
  }
  const s = new THREE.Sprite(m);
  s.scale.set(1.5, 1.5, 1);
  return s;
}
