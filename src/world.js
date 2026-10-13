// Scenery: ground, rails, sleepers, side walls, buildings and roadside props.
// Everything here is recycled as the player runs so the scene never grows,
// and restyled in place when the map changes.
import * as THREE from 'three';
import { laneX, LANES } from './config.js';
import {
  gravelTexture, concreteTexture, facadeTexture, nightWindowsTexture, rockTexture,
} from './textures.js';
import { mat } from './models.js';

const TRACK_SNAP = 10; // ground texture repeats every 10 units
const TRACK_LEN = 420;
const TRACK_BEHIND = 40;
const TILE = 40;
const TILE_COUNT = 9;
const SNOW_COUNT = 1400;

const NEON_COLORS = ['#ff2bd6', '#00e5ff', '#b26bff', '#7dff5a', '#ff9f1c', '#ff3860'];

// shared geometry for roadside props
const G = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cone: new THREE.ConeGeometry(1, 1, 8),
};

function part(material, sx, sy, sz, x, y, z, geo = G.box) {
  const m = new THREE.Mesh(geo, material);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  return m;
}

const propMats = {};
function pm(key, color, opts) {
  if (!propMats[key]) propMats[key] = new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...opts });
  return propMats[key];
}

function makePalm(rand) {
  const g = new THREE.Group();
  const trunk = pm('trunk', '#9c6b3f');
  let x = 0;
  for (let i = 0; i < 5; i++) {
    x += 0.12 + rand() * 0.06;
    g.add(part(trunk, 0.36 - i * 0.03, 1.25, 0.36 - i * 0.03, x * (i / 2), 0.62 + i * 1.2, 0));
  }
  const topX = x * 2;
  const leaf = pm('leaf', '#2f9e44');
  const leafDark = pm('leafDark', '#237a33');
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + rand() * 0.3;
    const l = new THREE.Group();
    l.position.set(topX, 6.1, 0);
    l.rotation.y = a;
    const blade = part(i % 2 ? leaf : leafDark, 0.5, 0.08, 2.4, 0, 0, 1.1);
    blade.rotation.x = 0.45;
    l.add(blade);
    g.add(l);
  }
  const nut = pm('nut', '#5c3d1e');
  g.add(part(nut, 0.25, 0.25, 0.25, topX + 0.18, 5.85, 0.1));
  g.add(part(nut, 0.25, 0.25, 0.25, topX - 0.12, 5.8, -0.16));
  return g;
}

function makePine(rand, snowy) {
  const g = new THREE.Group();
  const s = 0.85 + rand() * 0.45;
  g.add(part(pm('pineTrunk', '#5d4030'), 0.4, 1.4, 0.4, 0, 0.7, 0));
  const green = pm('pine', '#1f5f3b');
  const white = pm('snowcap', '#ffffff', { roughness: 0.6 });
  const tiers = [[1.7, 2.4, 2.2], [1.3, 2.1, 3.5], [0.9, 1.8, 4.7]];
  for (const [r, h, y] of tiers) {
    g.add(part(green, r, h, r, 0, y, 0, G.cone));
    if (snowy) g.add(part(white, r * 0.55, h * 0.4, r * 0.55, 0, y + h * 0.32, 0, G.cone));
  }
  g.scale.setScalar(s);
  return g;
}

function makeCactus(rand) {
  const g = new THREE.Group();
  const green = pm('cactus', '#4c9a2a');
  const h = 2.4 + rand() * 1.6;
  g.add(part(green, 0.55, h, 0.55, 0, h / 2, 0));
  for (const side of [-1, 1]) {
    if (rand() < 0.75) {
      const y = h * (0.35 + rand() * 0.3);
      g.add(part(green, 0.55, 0.4, 0.4, side * 0.5, y, 0));
      g.add(part(green, 0.4, 1.0, 0.4, side * 0.72, y + 0.45, 0));
    }
  }
  g.add(part(pm('rock', '#b07a52'), 1.1, 0.5, 0.9, 0.9, 0.25, 0.6));
  return g;
}

export class World {
  constructor(scene) {
    this.scene = scene;
    this.rand = Math.random;
    this.theme = null;
    this.sets = new Map();
    this.facade = facadeTexture();
    this.nightWindows = nightWindowsTexture();
    this.rock = rockTexture();
    this._buildTrack();
    this._buildTiles();
    this._buildSnow();
  }

  _buildTrack() {
    const g = new THREE.Group();
    this.track = g;
    const gravel = gravelTexture();
    gravel.repeat.set(4, TRACK_LEN / TRACK_SNAP);
    this.groundMat = new THREE.MeshStandardMaterial({ map: gravel, roughness: 1 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, TRACK_LEN), this.groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.position.z = TRACK_BEHIND - TRACK_LEN / 2;
    ground.receiveShadow = true;
    g.add(ground);

    // sea beyond the right-hand buildings (beach map only)
    this.seaMat = new THREE.MeshStandardMaterial({ color: '#22a6c9', roughness: 0.25, metalness: 0.2 });
    this.sea = new THREE.Mesh(new THREE.PlaneGeometry(400, TRACK_LEN), this.seaMat);
    this.sea.rotation.x = -Math.PI / 2;
    this.sea.position.set(220, 0.02, TRACK_BEHIND - TRACK_LEN / 2);
    this.sea.visible = false;
    g.add(this.sea);

    // rails
    const railGeo = new THREE.BoxGeometry(0.1, 0.14, TRACK_LEN);
    const railMat = mat('#d5dae1', { metalness: 0.9, roughness: 0.3 });
    for (let l = 0; l < LANES; l++) {
      for (const s of [-0.72, 0.72]) {
        const r = new THREE.Mesh(railGeo, railMat);
        r.position.set(laneX(l) + s, 0.17, TRACK_BEHIND - TRACK_LEN / 2);
        r.receiveShadow = true;
        g.add(r);
      }
    }
    // sleepers (one instanced draw call)
    const spacing = 1.25;
    const perLane = Math.floor(TRACK_LEN / spacing);
    const sleeperGeo = new THREE.BoxGeometry(2.0, 0.12, 0.3);
    this.sleeperMat = new THREE.MeshStandardMaterial({ color: '#5c4033', roughness: 0.9 });
    const sleepers = new THREE.InstancedMesh(sleeperGeo, this.sleeperMat, perLane * LANES);
    const m4 = new THREE.Matrix4();
    let i = 0;
    for (let l = 0; l < LANES; l++) {
      for (let k = 0; k < perLane; k++) {
        m4.makeTranslation(laneX(l), 0.06, TRACK_BEHIND - k * spacing);
        sleepers.setMatrixAt(i++, m4);
      }
    }
    sleepers.receiveShadow = true;
    g.add(sleepers);
    this.scene.add(g);
  }

  _buildTiles() {
    this.tiles = [];
    const wallTex = concreteTexture();
    wallTex.repeat.set(TILE / 16, 1);
    this.wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 });
    this.wallTopMat = new THREE.MeshStandardMaterial({ color: '#9a968e', roughness: 0.95 });
    const wallGeo = new THREE.BoxGeometry(0.6, 1.8, TILE);
    const wallMats = [this.wallMat, this.wallMat, this.wallTopMat, this.wallTopMat, this.wallTopMat, this.wallTopMat];
    this.roofMat = new THREE.MeshStandardMaterial({ color: '#495057', roughness: 0.8 });
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.09, 5.2, 8);
    const poleMat = mat('#495057', { metalness: 0.6 });
    const lampGeo = new THREE.BoxGeometry(0.5, 0.16, 0.3);
    this.lampMat = new THREE.MeshStandardMaterial({ color: '#fff3bf', emissive: '#fff3bf', emissiveIntensity: 1.2 });
    const armGeo = new THREE.BoxGeometry(0.9, 0.08, 0.08);
    this.neonMats = NEON_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 2.2 }));

    for (let t = 0; t < TILE_COUNT; t++) {
      const tile = new THREE.Group();
      tile.userData.buildings = [];
      for (const side of [-1, 1]) {
        const wall = new THREE.Mesh(wallGeo, wallMats);
        wall.position.set(side * 5.1, 0.9, -TILE / 2);
        wall.receiveShadow = true;
        tile.add(wall);
        for (let b = 0; b < 2; b++) {
          const bm = new THREE.Mesh(G.box, this.wallMat);
          const roof = new THREE.Mesh(G.box, this.roofMat);
          bm.add(roof);
          const signs = [0, 1].map(() => {
            const s = new THREE.Mesh(G.box, this.neonMats[0]);
            s.visible = false;
            bm.add(s);
            return s;
          });
          bm.userData = { side, slot: b, roof, signs };
          tile.add(bm);
          tile.userData.buildings.push(bm);
        }
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(side * 4.55, 2.6, -TILE / 2);
        tile.add(pole);
        const arm = new THREE.Mesh(armGeo, poleMat);
        arm.position.set(side * 4.15, 5.1, -TILE / 2);
        tile.add(arm);
        const lamp = new THREE.Mesh(lampGeo, this.lampMat);
        lamp.position.set(side * 3.75, 5.0, -TILE / 2);
        tile.add(lamp);
      }
      const deco = new THREE.Group();
      tile.add(deco);
      tile.userData.deco = deco;
      tile.userData.index = t;
      tile.position.z = TRACK_BEHIND / 2 - t * TILE;
      this.scene.add(tile);
      this.tiles.push(tile);
    }
  }

  _buildSnow() {
    const pos = new Float32Array(SNOW_COUNT * 3);
    for (let i = 0; i < SNOW_COUNT; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 44;
      pos[i * 3 + 1] = Math.random() * 26;
      pos[i * 3 + 2] = 15 - Math.random() * 110;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.snow = new THREE.Points(geo, new THREE.PointsMaterial({
      color: '#ffffff', size: 0.16, transparent: true, opacity: 0.9, depthWrite: false,
    }));
    this.snow.frustumCulled = false;
    this.snow.visible = false;
    this.scene.add(this.snow);
  }

  // Building geometry and materials for a map, built once and cached.
  _buildingSet(theme) {
    let set = this.sets.get(theme.id);
    if (set) return set;
    const B = theme.buildings;
    const house = B.style === 'house';
    const geos = [];
    for (let i = 0; i < 14; i++) {
      const w = house ? 5 + this.rand() * 2.5 : 6 + this.rand() * 4;
      const h = B.h[0] + this.rand() * (B.h[1] - B.h[0]);
      const d = house ? 8 + this.rand() * 4 : 14 + this.rand() * 5;
      const geo = new THREE.BoxGeometry(w, h, d);
      // scale UVs so windows (or rock layers) keep a constant size
      const uv = geo.attributes.uv;
      const sizes = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
      for (let f = 0; f < 6; f++) {
        for (let v = 0; v < 4; v++) {
          const idx = f * 4 + v;
          uv.setXY(idx, uv.getX(idx) * sizes[f][0] / 4, uv.getY(idx) * sizes[f][1] / 4);
        }
      }
      geo.translate(0, h / 2, 0);
      geo.userData = { w, h, d };
      geos.push(geo);
    }
    const mats = B.colors.map((c) => {
      if (B.style === 'rock') return new THREE.MeshStandardMaterial({ color: c, map: this.rock, roughness: 1 });
      if (B.style === 'night') {
        return new THREE.MeshStandardMaterial({
          color: c, map: this.facade, roughness: 0.8, emissive: '#ffffff', emissiveMap: this.nightWindows, emissiveIntensity: 1.1,
        });
      }
      return new THREE.MeshStandardMaterial({ color: c, map: this.facade, roughness: 0.85 });
    });
    set = { geos, mats };
    this.sets.set(theme.id, set);
    return set;
  }

  applyTheme(theme) {
    this.theme = theme;
    this.groundMat.color.set(theme.ground);
    this.sleeperMat.color.set(theme.sleeper);
    this.wallMat.color.set(theme.wall);
    this.wallTopMat.color.set(theme.wallTop);
    this.roofMat.color.set(theme.buildings.roof);
    this.lampMat.color.set(theme.lamp[0]);
    this.lampMat.emissive.set(theme.lamp[0]);
    this.lampMat.emissiveIntensity = theme.lamp[1];
    this.sea.visible = !!theme.sea;
    if (theme.sea) this.seaMat.color.set(theme.sea);
    this.snow.visible = !!theme.snow;
    this.set = this._buildingSet(theme);
    for (const tile of this.tiles) {
      const deco = tile.userData.deco;
      deco.clear();
      for (const side of [-1, 1]) {
        for (let k = 0; k < 2; k++) {
          let prop = null;
          if (theme.deco === 'palms') prop = makePalm(this.rand);
          else if (theme.deco === 'pines') prop = makePine(this.rand, !!theme.snow);
          else if (theme.deco === 'cacti') prop = makeCactus(this.rand);
          if (!prop) continue;
          prop.userData = { side, k };
          prop.traverse((c) => { if (c.isMesh) c.castShadow = false; });
          deco.add(prop);
        }
      }
      this._dressTile(tile);
    }
  }

  _dressTile(tile) {
    const theme = this.theme;
    if (!theme) return;
    const { geos, mats } = this.set;
    const house = theme.buildings.style === 'house';
    for (const bm of tile.userData.buildings) {
      const geo = geos[Math.floor(this.rand() * geos.length)];
      bm.geometry = geo;
      bm.material = mats[Math.floor(this.rand() * mats.length)];
      const { w, h, d } = geo.userData;
      const { side, slot, roof, signs } = bm.userData;
      bm.position.set(side * (8.2 + w / 2 + this.rand() * 2), 0, -slot * (TILE / 2) - d / 2 + 2);
      roof.visible = theme.buildings.style !== 'rock';
      roof.rotation.set(0, 0, 0);
      if (house) {
        // gable roof: a box turned 45 degrees, half sunk into the walls
        const s = w * 0.72;
        roof.scale.set(s, s, d * 1.04);
        roof.rotation.z = Math.PI / 4;
        roof.position.set(0, h, 0);
      } else if (theme.snow) {
        roof.scale.set(w * 1.04, 0.5, d * 1.04); // snow cap over the whole roof
        roof.position.set(0, h + 0.25, 0);
      } else {
        roof.scale.set(w * 0.6, 0.4, d * 0.5);
        roof.position.set(0, h + 0.2, 0);
      }
      signs.forEach((sg, i) => {
        sg.visible = theme.deco === 'neon' && (i === 0 || this.rand() < 0.5);
        if (!sg.visible) return;
        sg.material = this.neonMats[Math.floor(this.rand() * this.neonMats.length)];
        const tall = this.rand() < 0.4;
        sg.scale.set(0.16, tall ? 3.2 : 0.7, tall ? 0.8 : 3 + this.rand() * 2);
        // on the face that looks at the track
        sg.position.set(-side * (w / 2 + 0.1), Math.min(h - 2, 3.5 + i * 4 + this.rand() * 3), (this.rand() - 0.5) * (d - 5));
      });
    }
    for (const prop of tile.userData.deco.children) {
      const { side, k } = prop.userData;
      prop.position.set(side * (6.5 + this.rand() * 0.8), 0, -6 - k * 20 - this.rand() * 10);
      prop.rotation.y = this.rand() * Math.PI * 2;
    }
  }

  reset() {
    this.lastS = undefined;
    for (const tile of this.tiles) {
      tile.position.z = TRACK_BEHIND / 2 - tile.userData.index * TILE;
      this._dressTile(tile);
    }
  }

  // Keep the scenery around track position s (world z = -s).
  update(s, dt = 0) {
    this.track.position.z = -Math.floor(s / TRACK_SNAP) * TRACK_SNAP;
    const pz = -s;
    for (const tile of this.tiles) {
      // tile spans z in [tile.z - TILE, tile.z]; recycle once fully behind the camera
      while (tile.position.z - TILE > pz + TRACK_BEHIND) {
        tile.position.z -= TILE * TILE_COUNT;
        this._dressTile(tile);
      }
    }
    // flakes live in a box that follows the player; shift them back by the
    // distance run so they stream past instead of moving with the camera
    const moved = this.lastS === undefined ? 0 : Math.max(0, Math.min(5, s - this.lastS));
    this.lastS = s;
    if (this.snow.visible) {
      this.snow.position.z = pz;
      const p = this.snow.geometry.attributes.position;
      const a = p.array;
      for (let i = 0; i < SNOW_COUNT; i++) {
        let y = a[i * 3 + 1] - dt * (2.2 + (i % 7) * 0.25);
        if (y < 0) y += 26;
        a[i * 3 + 1] = y;
        a[i * 3] += Math.sin(y * 0.8 + i) * dt * 0.4;
        let z = a[i * 3 + 2] + moved;
        if (z > 15) z -= 110;
        a[i * 3 + 2] = z;
      }
      p.needsUpdate = true;
    }
  }
}
