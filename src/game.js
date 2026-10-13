// Ties the simulation, renderer, audio and UI together.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  laneX, ROLL_TIME, MAGNET_RANGE, POWER_TIME, POWER_TYPES, PLAYER, MAX_LEVEL,
} from './config.js';
import { Sim } from './sim.js';
import { trainFront, surfaceHeight } from './physics.js';
import { World } from './world.js';
import {
  makeRunner, makeGuard, makeDog, makeTrain, makeHurdle, makeOverhead, makeCoin, makePower, makeBurst,
} from './models.js';
import { skyTexture } from './textures.js';
import { CHARACTERS, characterById } from './characters.js';

const POWER_LABEL = {
  magnet: 'Coin Magnet', multiplier: '2x Score', sneakers: 'Super Sneakers', jetpack: 'Jetpack', board: 'Hoverboard',
};
const DEATH_TEXT = {
  train: 'You ran into a train!',
  hurdle: 'Tripped over a barrier! (jump over those)',
  overhead: 'Hit a sign! (roll under those)',
  caught: 'The guard caught you!',
};

function load(key, fallback) {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : JSON.parse(v);
  } catch (e) {
    return fallback;
  }
}
function save(key, v) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) { /* storage unavailable */ }
}
function loadNumber(key) {
  const v = Number(load(key, 0));
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

export class Game {
  constructor(container, ui, audio) {
    this.ui = ui;
    this.audio = audio;
    this.state = 'menu';
    this.best = loadNumber('sr2-best');
    this.bank = loadNumber('sr2-coins');
    const owned = load('sr2-owned', ['dash']);
    this.owned = new Set(Array.isArray(owned) ? owned.filter((id) => CHARACTERS.some((c) => c.id === id)) : []);
    this.owned.add(CHARACTERS[0].id);
    this.charId = characterById(load('sr2-char', CHARACTERS[0].id)).id;
    if (!this.owned.has(this.charId)) this.charId = CHARACTERS[0].id;
    this.previewIndex = 0;

    const lowEnd = (window.matchMedia && window.matchMedia('(pointer: coarse)').matches)
      || Math.min(window.screen?.width || 1000, window.screen?.height || 1000) < 600;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;
    renderer.domElement.addEventListener('webglcontextlost', (e) => {
      e.preventDefault(); // allow the context to be restored
      this.pause();
    });

    const scene = new THREE.Scene();
    scene.background = skyTexture();
    scene.fog = new THREE.Fog('#cfe9ff', 70, 230);
    // soft reflections so metal (rails, coins) doesn't render nearly black
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    scene.environmentIntensity = 0.45;
    pmrem.dispose();
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 300);
    scene.add(new THREE.HemisphereLight('#dbeeff', '#6b5b4b', 1.3));
    const sun = new THREE.DirectionalLight('#fff1d6', 2.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(lowEnd ? 1024 : 2048, lowEnd ? 1024 : 2048);
    const sc = sun.shadow.camera;
    sc.left = -16; sc.right = 16; sc.top = 22; sc.bottom = -22; sc.near = 1; sc.far = 80;
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.03;
    scene.add(sun);
    scene.add(sun.target);
    this.sun = sun;

    this.world = new World(scene);
    this.runner = null;
    this._setRunnerLook(this.charId);
    this.guard = makeGuard();
    scene.add(this.guard.root);
    this.dog = makeDog();
    scene.add(this.dog.root);

    this.views = new Map();
    this.coinPool = [];
    this.flying = []; // smashed barriers
    this.bursts = []; // orb pickup effects
    this.sim = new Sim(1);
    this._syncAdded();

    this.runPhase = 0;
    this.guardPhase = 0;
    this.camY = 0;
    this.camBack = 7.2;
    this.shake = 0;
    this.guardGap = 30;
    this.deathT = 0;
    this.deathY = 0;
    this.deathVy = 0;
    this.countdown = 0;
    this.time = 0;
    this.overAt = 0;

    this._resize();
    window.addEventListener('resize', () => this._resize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.pause();
    });
    window.addEventListener('blur', () => this.pause());

    this.ui.showMenu(this._menuInfo());
    this.last = performance.now();
    requestAnimationFrame((t) => this._frame(t));
  }

  // ------------------------------------------------------------- state
  start() {
    if (this.state === 'chars') this._setRunnerLook(this.charId);
    this.audio.unlock();
    this._clearViews();
    this.sim.reset();
    this.world.reset();
    this._syncAdded();
    this.sim.takeEvents();
    this.runPhase = 0;
    this.shake = 0;
    this.guardGap = this._guardBase(); // the guard and dog start right behind and fall back
    this.camY = 0;
    this.deathT = 0;
    this.state = 'playing';
    this.ui.showHud();
    this.audio.startMusic();
    this.audio.play('click');
    this.audio.play('bark');
  }

  pause() {
    if (this.state !== 'playing' && this.state !== 'countdown') return;
    this.state = 'paused';
    this.audio.stopMusic();
    this.ui.showPause();
  }

  resume() {
    if (this.state !== 'paused') return;
    this.audio.unlock();
    this.state = 'countdown';
    this.countdown = 3;
    this.ui.showCountdown(3);
  }

  toMenu() {
    // quitting a run part-way still keeps its coins and score
    if (this.state === 'paused' || this.state === 'countdown') this._saveRun();
    if (this.state === 'chars') this._setRunnerLook(this.charId);
    this.audio.stopMusic();
    this._clearViews();
    this.sim.reset();
    this.world.reset();
    this._syncAdded();
    this.sim.takeEvents();
    this.guardGap = 30;
    this.state = 'menu';
    this.ui.showMenu(this._menuInfo());
  }

  togglePause() {
    if (this.state === 'chars') this.toMenu();
    else if (this.state === 'paused') this.resume();
    else this.pause();
  }

  confirm() {
    if (this.state === 'menu') this.start();
    else if (this.state === 'paused') this.resume();
    else if (this.state === 'over' && this.time - this.overAt > 0.6) this.start();
    else if (this.state === 'chars') this.charsAction();
  }

  act(name) {
    if (this.state !== 'playing') return;
    this.sim[name]();
  }

  _menuInfo() {
    return { best: this.best, bank: this.bank, character: characterById(this.charId).name };
  }

  _saveRun() {
    const score = Math.floor(this.sim.score);
    const newBest = score > this.best;
    if (newBest) {
      this.best = score;
      save('sr2-best', score);
    }
    this.bank += this.sim.coins;
    save('sr2-coins', this.bank);
    return { score, newBest };
  }

  _gameOver() {
    this.state = 'over';
    this.overAt = this.time;
    const { score, newBest } = this._saveRun();
    if (newBest) this.audio.play('record');
    this.ui.showOver({
      score, coins: this.sim.coins, best: this.best, newBest,
      cause: DEATH_TEXT[this.sim.deathCause] || '', distance: Math.floor(this.sim.s), level: this.sim.level,
    });
  }

  // ------------------------------------------------------------- characters
  _setRunnerLook(id) {
    if (this.runner) this.scene.remove(this.runner.root);
    this.runner = makeRunner(characterById(id).look);
    this.scene.add(this.runner.root);
  }

  openChars() {
    if (this.state !== 'menu') return;
    this.audio.unlock();
    this.audio.play('click');
    this.state = 'chars';
    this.previewIndex = Math.max(0, CHARACTERS.findIndex((c) => c.id === this.charId));
    this._showPreview();
  }

  charsStep(dir) {
    if (this.state !== 'chars') return;
    const n = CHARACTERS.length;
    this.previewIndex = (this.previewIndex + dir + n) % n;
    this.audio.play('lane');
    this._showPreview();
  }

  charsAction() {
    if (this.state !== 'chars') return;
    const c = CHARACTERS[this.previewIndex];
    if (this.owned.has(c.id)) {
      if (this.charId !== c.id) {
        this.charId = c.id;
        save('sr2-char', c.id);
        this.audio.play('power');
      }
    } else if (this.bank >= c.price) {
      this.bank -= c.price;
      save('sr2-coins', this.bank);
      this.owned.add(c.id);
      save('sr2-owned', [...this.owned]);
      this.charId = c.id;
      save('sr2-char', c.id);
      this.audio.play('record');
      this.ui.toast(`${c.name} unlocked!`);
    } else {
      this.audio.play('stumble');
      this.ui.nudge();
      return;
    }
    this._showPreview();
  }

  _showPreview() {
    const c = CHARACTERS[this.previewIndex];
    this._setRunnerLook(c.id);
    this.ui.showChars({
      name: c.name, tagline: c.tagline, price: c.price, owned: this.owned.has(c.id), selected: this.charId === c.id,
      bank: this.bank, index: this.previewIndex, total: CHARACTERS.length,
    });
  }

  // ------------------------------------------------------------- views
  _clearViews() {
    for (const v of this.views.values()) this._disposeView(v);
    this.views.clear();
    for (const f of this.flying) this.scene.remove(f.obj);
    this.flying.length = 0;
    for (const b of this.bursts) {
      this.scene.remove(b.obj);
      b.obj.material.dispose();
    }
    this.bursts.length = 0;
  }

  _disposeView(v) {
    this.scene.remove(v.obj);
    if (v.item.kind === 'coin') this.coinPool.push(v.obj);
  }

  _syncAdded() {
    const sim = this.sim;
    for (const it of sim.added) {
      let obj;
      switch (it.kind) {
        case 'train': obj = makeTrain(it); break;
        case 'hurdle': obj = makeHurdle(); break;
        case 'overhead': obj = makeOverhead(); break;
        case 'coin': obj = this.coinPool.pop() || makeCoin(); break;
        case 'power': obj = makePower(it.type); break;
        default: continue;
      }
      obj.position.set(laneX(it.lane), it.kind === 'coin' || it.kind === 'power' ? it.y : 0, -it.s);
      if (it.kind === 'train') obj.position.z = -trainFront(it, sim.s);
      this.scene.add(obj);
      this.views.set(it.id, { item: it, obj });
    }
    sim.added.length = 0;
    for (const it of sim.removed) {
      const v = this.views.get(it.id);
      if (!v) continue;
      if (it.smashed && !v.flown) continue; // let the smash animation finish
      this._disposeView(v);
      this.views.delete(it.id);
    }
    sim.removed.length = 0;
  }

  _updateViews(dt) {
    const sim = this.sim;
    const t = this.time;
    const pcx = sim.x;
    const pcy = sim.y + sim.height / 2;
    const pcz = -sim.s;
    for (const v of this.views.values()) {
      const it = v.item;
      if (it.kind === 'coin') {
        v.obj.rotation.y = t * 3.2 + it.s * 0.15;
        if (it.magnet) {
          const k = Math.min(1, Math.max(0, (it.s - sim.s) / MAGNET_RANGE));
          v.obj.position.set(pcx + (laneX(it.lane) - pcx) * k, pcy + (it.y - pcy) * k, pcz - (it.s - sim.s) * k);
        }
      } else if (it.kind === 'power') {
        v.obj.position.y = it.y + Math.sin(t * 3 + it.s) * 0.15;
        const ring = v.obj.userData.ring;
        ring.rotation.x = t * 1.7;
        ring.rotation.y = t * 2.3;
      } else if (it.kind === 'train' && it.moving) {
        v.obj.position.z = -trainFront(it, sim.s);
        if (v.obj.userData.beacon) v.obj.userData.beacon.visible = (t * 3) % 1 < 0.55;
        // sound the horn as the train starts moving towards the player
        if (!v.honked && this.state === 'playing' && it.s - sim.s < it.R + 12) {
          v.honked = true;
          this.audio.play('horn');
        }
      } else if (it.smashed && !v.flown) {
        v.flown = true;
        this.flying.push({ obj: v.obj, vx: (Math.random() - 0.5) * 6, vy: 9, vz: -6, spin: (Math.random() - 0.5) * 12, life: 1.5 });
        this.views.delete(it.id);
      }
    }
    for (let i = this.flying.length - 1; i >= 0; i--) {
      const f = this.flying[i];
      f.life -= dt;
      f.vy -= 25 * dt;
      f.obj.position.x += f.vx * dt;
      f.obj.position.y += f.vy * dt;
      f.obj.position.z += f.vz * dt;
      f.obj.rotation.x += f.spin * dt;
      f.obj.rotation.z += f.spin * 0.5 * dt;
      if (f.life <= 0) {
        this.scene.remove(f.obj);
        this.flying.splice(i, 1);
      }
    }
    for (let i = this.bursts.length - 1; i >= 0; i--) {
      const b = this.bursts[i];
      b.t += dt;
      const k = b.t / 0.55;
      b.obj.position.set(sim.x, sim.y + sim.height / 2, -sim.s);
      b.obj.scale.setScalar(1 + k * 5);
      b.obj.material.opacity = Math.max(0, 1 - k);
      if (k >= 1) {
        this.scene.remove(b.obj);
        b.obj.material.dispose();
        this.bursts.splice(i, 1);
      }
    }
  }

  // ------------------------------------------------------------- frame
  _frame(now) {
    requestAnimationFrame((t) => this._frame(t));
    const dt = Math.min(0.05, Math.max(0, (now - this.last) / 1000));
    this.last = now;
    try {
      this._update(dt);
      this.renderer.render(this.scene, this.camera);
    } catch (e) {
      // keep the loop alive; surface the problem in the console
      console.error(e);
    }
  }

  _update(dt) {
    this.time += dt;
    const sim = this.sim;
    if (this.state === 'playing') {
      sim.step(dt);
      this._handleEvents(sim.takeEvents());
      if (!sim.alive) {
        this.state = 'dying';
        this.deathT = 0;
        this.deathY = sim.y;
        this.deathVy = Math.max(0, sim.vy) * 0.3;
        this.audio.stopMusic();
      }
    } else if (this.state === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.state = 'playing';
        this.ui.showHud();
        this.audio.startMusic();
      } else {
        this.ui.showCountdown(Math.ceil(this.countdown));
      }
    } else if (this.state === 'dying') {
      this.deathT += dt;
      if (this.deathT > 1.4) this._gameOver();
    }
    if (this.state === 'dying' || this.state === 'over') {
      // the body drops to whatever is underneath it
      const ground = surfaceHeight(sim.trains, sim.x, sim.s + 0.9, PLAYER.halfW, PLAYER.halfD, sim.s);
      this.deathVy -= 30 * dt;
      this.deathY = Math.max(ground, this.deathY + this.deathVy * dt);
      if (this.deathY === ground) this.deathVy = 0;
    }
    this._syncAdded();
    this._updateViews(dt);
    this.world.update(sim.s);
    this._animateRunner(dt);
    this._animateChasers(dt);
    this._updateCamera(dt);
    if (this.state === 'playing' || this.state === 'countdown' || this.state === 'paused' || this.state === 'dying') this._updateHud();
  }

  _handleEvents(events) {
    for (const e of events) {
      switch (e.type) {
        case 'coin': this.audio.play('coin'); break;
        case 'jump': this.audio.play(e.super ? 'superjump' : 'jump'); break;
        case 'roll': this.audio.play('roll'); break;
        case 'lane': this.audio.play('lane'); break;
        case 'land': if (e.hard) this.audio.play('land'); break;
        case 'stumble':
          this.audio.play('stumble');
          this.audio.play('bark');
          this.shake = 0.35;
          this.ui.flash();
          break;
        case 'bump': this.audio.play('land'); this.shake = 0.15; break;
        case 'crash': this.audio.play('crash'); this.shake = 0.6; this.ui.flash(); break;
        case 'power': {
          this.audio.play('power');
          this.ui.toast(POWER_LABEL[e.power] + '!');
          const burst = makeBurst(e.power);
          this.scene.add(burst);
          this.bursts.push({ obj: burst, t: 0 });
          break;
        }
        case 'powerEnd': if (e.power !== 'board') this.audio.play('powerEnd'); break;
        case 'boardBreak':
          this.audio.play('boardBreak');
          this.shake = 0.3;
          this.ui.toast('Hoverboard saved you!');
          break;
        case 'level':
          this.audio.play('level');
          this.ui.toast(e.level >= MAX_LEVEL ? `Max level! x${e.level}` : `Level ${e.level}! x${e.level}`);
          break;
        default: break;
      }
    }
  }

  _animateRunner(dt) {
    if (this.state === 'paused' || this.state === 'countdown') return; // hold the current pose
    const sim = this.sim;
    const r = this.runner;
    const root = r.root;
    const dying = this.state === 'dying' || this.state === 'over';
    root.position.set(sim.x, sim.y, -sim.s);
    const running = this.state === 'playing' || dying;
    const boardOn = sim.power.board > 0;
    r.board.visible = boardOn && !sim.flying && this.state !== 'menu' && this.state !== 'chars';
    r.jetpack.visible = sim.flying;
    const lift = r.board.visible ? 0.12 : 0;
    r.body.position.y = -0.9 + lift;

    // reset pose
    r.pivot.rotation.set(0, 0, 0);
    r.pivot.position.y = 0.9;
    r.pivot.scale.setScalar(1);
    root.rotation.set(0, 0, 0);
    for (const l of r.legs) l.rotation.set(0, 0, 0);
    for (const a of r.arms) a.rotation.set(0, 0, 0);

    if (dying) {
      // knocked onto their back; slide back so the legs don't swing into the obstacle
      const k = Math.min(1, this.deathT / 0.45);
      root.position.y = this.deathY;
      root.position.z = -sim.s + 0.9 * k;
      r.pivot.rotation.x = k * 1.45;
      r.pivot.position.y = 0.9 - k * 0.62;
      r.legs[0].rotation.x = -0.3;
      r.legs[1].rotation.x = 0.4;
      r.arms[0].rotation.x = r.arms[1].rotation.x = -2.6 * k;
      root.visible = true;
      return;
    }
    if (this.state === 'chars') {
      // face the camera and turn slowly so the whole outfit shows
      root.rotation.y = Math.PI + Math.sin(this.time * 0.9) * 0.6;
      const b = Math.sin(this.time * 2.5);
      r.arms[0].rotation.z = -0.12;
      r.arms[1].rotation.z = 0.12;
      r.arms[1].rotation.x = -0.2 + 0.1 * b;
      r.body.position.y = -0.9 + Math.abs(b) * 0.02;
      root.visible = true;
      return;
    }
    // lean into lane changes
    const dx = laneX(sim.lane) - sim.x;
    root.rotation.z = Math.max(-0.35, Math.min(0.35, -dx * 0.2));
    root.rotation.y = Math.max(-0.3, Math.min(0.3, dx * 0.12));

    if (!running) {
      // idle on the menu
      const b = Math.sin(this.time * 2.5);
      r.arms[0].rotation.x = r.arms[1].rotation.x = 0.1 * b;
      r.arms[0].rotation.z = -0.08;
      r.arms[1].rotation.z = 0.08;
      r.body.position.y = -0.9 + Math.abs(b) * 0.02;
      root.visible = true;
      return;
    }

    if (sim.flying) {
      r.legs[0].rotation.x = 0.5;
      r.legs[1].rotation.x = 0.35;
      r.arms[0].rotation.x = r.arms[1].rotation.x = -0.4;
      r.pivot.rotation.x = -0.25;
      for (const f of r.flames) f.scale.set(1, 0.8 + Math.random() * 0.6, 1);
    } else if (sim.rolling) {
      const k = 1 - sim.rollT / ROLL_TIME;
      r.pivot.position.y = 0.55;
      r.pivot.scale.setScalar(0.6);
      r.pivot.rotation.x = -k * Math.PI * 2;
      r.legs[0].rotation.x = r.legs[1].rotation.x = -1.4;
      r.arms[0].rotation.x = r.arms[1].rotation.x = -1.8;
    } else if (!sim.grounded) {
      const up = sim.vy > 0;
      r.legs[0].rotation.x = up ? -0.9 : -0.3;
      r.legs[1].rotation.x = up ? 0.4 : 0.2;
      r.arms[0].rotation.x = -2.2;
      r.arms[1].rotation.x = -2.0;
      r.arms[0].rotation.z = -0.3;
      r.arms[1].rotation.z = 0.3;
    } else if (boardOn) {
      r.legs[0].rotation.x = -0.25;
      r.legs[1].rotation.x = 0.25;
      r.arms[0].rotation.x = 0.5;
      r.arms[1].rotation.x = -0.5;
      r.arms[0].rotation.z = -0.5;
      r.arms[1].rotation.z = 0.5;
      root.rotation.y += 0.5;
    } else {
      this.runPhase += dt * sim.speed * 0.62;
      const p = Math.sin(this.runPhase);
      r.legs[0].rotation.x = p * 0.95;
      r.legs[1].rotation.x = -p * 0.95;
      r.arms[0].rotation.x = -p * 0.85;
      r.arms[1].rotation.x = p * 0.85;
      r.arms[0].rotation.z = -0.1;
      r.arms[1].rotation.z = 0.1;
      r.body.position.y = -0.9 + Math.abs(Math.cos(this.runPhase)) * 0.09;
      r.pivot.rotation.x = -0.12;
    }
    // blink while invulnerable
    root.visible = sim.graceT <= 0 || Math.floor(this.time * 12) % 2 === 0;
  }

  // Far enough back that the guard doesn't hide the runner, whatever the camera distance.
  _guardBase() {
    return Math.min(6.2, Math.max(3.6, this.camBack * 0.42));
  }

  _animateChasers(dt) {
    if (this.state === 'paused' || this.state === 'countdown') return; // freeze in place
    const sim = this.sim;
    const g = this.guard;
    const d = this.dog;
    const base = this._guardBase();
    let target = 30;
    if (this.state === 'menu' || this.state === 'chars') target = 30;
    else if (this.state === 'dying' || this.state === 'over') target = 2.4;
    else if (sim.stumbleT > 0) target = base;
    else if (sim.time < 1.8) target = base; // intro: starts right behind, then falls back
    const rate = target < this.guardGap ? 3 : 0.9;
    this.guardGap += (target - this.guardGap) * Math.min(1, dt * rate);
    const visible = this.guardGap < 16 && this.state !== 'menu' && this.state !== 'chars';
    const moving = this.state === 'playing' || this.guardGap - target > 0.05;
    const caught = (this.state === 'dying' || this.state === 'over') && !moving;

    // guard
    const gs = sim.s - this.guardGap;
    const gx = g.root.position.x + (sim.x - g.root.position.x) * Math.min(1, dt * 4);
    const gy = surfaceHeight(sim.trains, gx, gs, 0.4, 0.4, sim.s);
    g.root.visible = visible;
    g.root.position.set(gx, g.root.position.y + (gy - g.root.position.y) * Math.min(1, dt * 10), -gs);
    if (moving) {
      this.guardPhase += dt * 14;
      const p = Math.sin(this.guardPhase);
      g.legs[0].rotation.x = p * 0.9;
      g.legs[1].rotation.x = -p * 0.9;
      g.arms[0].rotation.x = -p * 0.8;
      g.arms[1].rotation.x = p * 0.8;
    } else if (caught) {
      g.legs[0].rotation.x = g.legs[1].rotation.x = 0;
      g.arms[0].rotation.x = -1.2 + Math.sin(this.time * 8) * 0.3; // shaking a fist
      g.arms[1].rotation.x = 0;
    }

    // dog: runs a little ahead of the guard, on the side nearer the middle of the track
    const side = gx > 0.1 ? -1 : 1;
    const ds = gs + 0.7;
    const dxTarget = gx + side * 0.85;
    const dx = d.root.position.x + (dxTarget - d.root.position.x) * Math.min(1, dt * 5);
    const dy = surfaceHeight(sim.trains, dx, ds, 0.2, 0.4, sim.s);
    d.root.visible = visible;
    d.root.position.set(dx, d.root.position.y + (dy - d.root.position.y) * Math.min(1, dt * 10), -ds);
    for (const l of d.legs) l.rotation.x = 0;
    d.body.rotation.x = 0;
    d.body.position.y = 0;
    if (moving) {
      const p = this.guardPhase * 1.25;
      d.legs[0].rotation.x = d.legs[1].rotation.x = Math.sin(p) * 0.9;
      d.legs[2].rotation.x = d.legs[3].rotation.x = Math.sin(p + Math.PI) * 0.9;
      d.body.position.y = Math.abs(Math.sin(p)) * 0.08;
      d.body.rotation.x = Math.sin(p) * 0.08;
      d.tail.rotation.y = Math.sin(p * 2) * 0.4;
    } else if (caught) {
      // sitting, tail wagging
      d.body.rotation.x = -0.35;
      d.body.position.y = -0.1;
      d.legs[2].rotation.x = d.legs[3].rotation.x = 1.0;
      d.tail.rotation.y = Math.sin(this.time * 18) * 0.7;
      d.head.rotation.x = Math.sin(this.time * 9) > 0.6 ? -0.25 : 0; // barking
    }
  }

  _updateCamera(dt) {
    const sim = this.sim;
    const cam = this.camera;
    const aspect = cam.aspect;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const back = Math.min(14, Math.max(7.2, 4.4 / (tanHalf * aspect)));
    this.camBack = back;
    const z = -sim.s;
    if (this.state === 'chars') {
      // close-up from the front for the character screen
      // keep the whole character in the part of the screen above the bottom panel
      const dist = Math.min(7, Math.max(5, 1.7 / (tanHalf * aspect)));
      cam.position.set(sim.x, 1.45, z - 0.6 + dist);
      cam.lookAt(sim.x, 1.0 - dist * 0.17, z);
      return;
    }
    const focusY = sim.flying ? sim.y - 1.5 : (this.state === 'dying' || this.state === 'over') ? this.deathY : sim.y;
    this.camY += (focusY - this.camY) * Math.min(1, dt * (focusY < this.camY ? 7 : 4));
    let sx = 0;
    let sy = 0;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt);
      sx = (Math.random() - 0.5) * this.shake;
      sy = (Math.random() - 0.5) * this.shake;
    }
    // in portrait the camera sits further back; aim further ahead so the runner sits lower on screen
    const ahead = 7 + (back - 7.2) * 0.9;
    cam.position.set(sim.x * 0.8 + sx, 3.3 + back * 0.17 + this.camY * 0.85 + sy, z + back);
    cam.lookAt(sim.x * 0.85, 1.2 + this.camY * 0.85, z - ahead);
    this.sun.position.set(sim.x - 7, 18, z + 10);
    this.sun.target.position.set(sim.x, 0, z - 8);
  }

  _updateHud() {
    const sim = this.sim;
    const powers = [];
    for (const p of POWER_TYPES) {
      if (sim.power[p] > 0) powers.push({ type: p, frac: sim.power[p] / POWER_TIME[p] });
    }
    this.ui.updateHud(Math.floor(sim.score), sim.coins, sim.multiplier, powers, sim.level, sim.levelProgress, MAX_LEVEL);
  }

  _resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.fov = w < h ? 70 : 60;
    this.camera.updateProjectionMatrix();
  }
}
