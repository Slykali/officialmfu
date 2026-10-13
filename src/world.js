// Scenery: ground, rails, sleepers, side walls and buildings. Everything here
// is recycled as the player runs so the scene never grows.
import * as THREE from 'three';
import { laneX, LANES } from './config.js';
import { gravelTexture, concreteTexture, facadeTexture } from './textures.js';
import { mat } from './models.js';

const TRACK_SNAP = 10; // ground texture repeats every 10 units
const TRACK_LEN = 420;
const TRACK_BEHIND = 40;
const TILE = 40;
const TILE_COUNT = 9;

const BUILDING_COLORS = ['#f4a261', '#e76f51', '#2a9d8f', '#e9c46a', '#8ecae6', '#cdb4db', '#ffafcc', '#b5e48c', '#adb5bd', '#ffd6a5'];

export class World {
  constructor(scene) {
    this.scene = scene;
    this.rand = Math.random;
    this._buildTrack();
    this._buildTiles();
  }

  _buildTrack() {
    const g = new THREE.Group();
    this.track = g;
    const gravel = gravelTexture();
    gravel.repeat.set(4, TRACK_LEN / TRACK_SNAP);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, TRACK_LEN),
      new THREE.MeshStandardMaterial({ map: gravel, roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.z = TRACK_BEHIND - TRACK_LEN / 2;
    ground.receiveShadow = true;
    g.add(ground);

    // rails
    const railGeo = new THREE.BoxGeometry(0.1, 0.14, TRACK_LEN);
    const railMat = mat('#c9ced6', { metalness: 0.9, roughness: 0.3 });
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
    const sleepers = new THREE.InstancedMesh(sleeperGeo, mat('#5c4033', { roughness: 0.9 }), perLane * LANES);
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
    const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.9 });
    const wallGeo = new THREE.BoxGeometry(0.6, 1.8, TILE);
    const wallTopMat = mat('#9a968e', { roughness: 0.95 });
    const facade = facadeTexture();
    this.buildingGeos = [];
    for (let i = 0; i < 14; i++) {
      const w = 6 + this.rand() * 4;
      const h = 9 + this.rand() * 22;
      const d = 14 + this.rand() * 5;
      const geo = new THREE.BoxGeometry(w, h, d);
      // scale UVs so windows keep a constant size
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
      this.buildingGeos.push(geo);
    }
    this.buildingMats = BUILDING_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, map: facade, roughness: 0.85 }));
    const roofMat = mat('#495057');
    const poleGeo = new THREE.CylinderGeometry(0.07, 0.09, 5.2, 8);
    const poleMat = mat('#495057', { metalness: 0.6 });
    const lampGeo = new THREE.BoxGeometry(0.5, 0.16, 0.3);
    const lampMat = mat('#fff3bf', { emissive: '#fff3bf', emissiveIntensity: 1.2 });
    const armGeo = new THREE.BoxGeometry(0.9, 0.08, 0.08);

    for (let t = 0; t < TILE_COUNT; t++) {
      const tile = new THREE.Group();
      tile.userData.buildings = [];
      for (const side of [-1, 1]) {
        const wall = new THREE.Mesh(wallGeo, [wallMat, wallMat, wallTopMat, wallTopMat, wallTopMat, wallTopMat]);
        wall.position.set(side * 5.1, 0.9, -TILE / 2);
        wall.receiveShadow = true;
        tile.add(wall);
        for (let b = 0; b < 2; b++) {
          const bm = new THREE.Mesh(this.buildingGeos[0], this.buildingMats[0]);
          const roof = new THREE.Mesh(new THREE.BoxGeometry(1, 0.4, 1), roofMat);
          bm.add(roof);
          bm.userData = { side, slot: b, roof };
          tile.add(bm);
          tile.userData.buildings.push(bm);
        }
        const pole = new THREE.Mesh(poleGeo, poleMat);
        pole.position.set(side * 4.55, 2.6, -TILE / 2);
        tile.add(pole);
        const arm = new THREE.Mesh(armGeo, poleMat);
        arm.position.set(side * 4.15, 5.1, -TILE / 2);
        tile.add(arm);
        const lamp = new THREE.Mesh(lampGeo, lampMat);
        lamp.position.set(side * 3.75, 5.0, -TILE / 2);
        tile.add(lamp);
      }
      this._dressTile(tile);
      tile.userData.index = t;
      tile.position.z = TRACK_BEHIND / 2 - t * TILE;
      this.scene.add(tile);
      this.tiles.push(tile);
    }
  }

  _dressTile(tile) {
    for (const bm of tile.userData.buildings) {
      const geo = this.buildingGeos[Math.floor(this.rand() * this.buildingGeos.length)];
      bm.geometry = geo;
      bm.material = this.buildingMats[Math.floor(this.rand() * this.buildingMats.length)];
      const { w, h, d } = geo.userData;
      const { side, slot, roof } = bm.userData;
      bm.position.set(side * (8.2 + w / 2 + this.rand() * 2), 0, -slot * (TILE / 2) - d / 2 + 2);
      roof.scale.set(w * 0.6, 1, d * 0.5);
      roof.position.set(0, h + 0.2, 0);
    }
  }

  reset() {
    for (const tile of this.tiles) {
      tile.position.z = TRACK_BEHIND / 2 - tile.userData.index * TILE;
      this._dressTile(tile);
    }
  }

  // Keep the scenery around track position s (world z = -s).
  update(s) {
    this.track.position.z = -Math.floor(s / TRACK_SNAP) * TRACK_SNAP;
    const pz = -s;
    for (const tile of this.tiles) {
      // tile spans z in [tile.z - TILE, tile.z]; recycle once fully behind the camera
      while (tile.position.z - TILE > pz + TRACK_BEHIND) {
        tile.position.z -= TILE * TILE_COUNT;
        this._dressTile(tile);
      }
    }
  }
}
