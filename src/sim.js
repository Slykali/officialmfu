// Headless game simulation: player physics, collisions, pickups and scoring.
// It knows nothing about rendering, so it can be stepped in tests as well.
import {
  LANES, LANE_W, laneX, PLAYER, GRAVITY, JUMP_H, SUPER_JUMP_H, FAST_FALL_V,
  ROLL_TIME, LANE_SPEED, STEP_UP, JUMP_BUFFER, COYOTE_TIME, POWER_TIME,
  FLY_Y, MAGNET_RANGE, STUMBLE_TIME, GRACE_TIME, GEN_AHEAD, KEEP_BEHIND, LEVEL_DIST, MAX_LEVEL, speedAt,
} from './config.js';
import { LevelGenerator } from './generator.js';
import { surfaceHeight, hitBarrier, trainFront } from './physics.js';

const MAX_SUBSTEP_DIST = 0.25;
const MAX_SUBSTEP_TIME = 1 / 120;

function approach(v, target, delta) {
  if (v < target) return Math.min(target, v + delta);
  if (v > target) return Math.max(target, v - delta);
  return v;
}

export class Sim {
  constructor(seed) {
    this.reset(seed);
  }

  reset(seed = (Math.random() * 2 ** 32) >>> 0) {
    this.seed = seed >>> 0;
    this.gen = new LevelGenerator(this.seed);
    this.time = 0;
    this.s = 0;
    this.x = 0;
    this.lane = 1;
    this.y = 0;
    this.vy = 0;
    this.grounded = true;
    this.coyote = 0;
    this.rollT = 0;
    this.rollQueued = false;
    this.jumpBuf = 0;
    this.alive = true;
    this.deathCause = null;
    this.stumbleT = 0;
    this.stumbleCool = 0;
    this.graceT = 0;
    this.power = { magnet: 0, multiplier: 0, sneakers: 0, jetpack: 0, board: 0 };
    this.coins = 0;
    this.score = 0;
    this.lastLevel = 1;
    this.trains = [];
    this.barriers = [];
    this.coinItems = [];
    this.powers = [];
    this.events = [];
    this.added = [];
    this.removed = [];
    this.nextSkyId = -1;
    this._generate();
  }

  get speed() { return speedAt(this.s); }
  get flying() { return this.power.jetpack > 0; }
  get rolling() { return this.rollT > 0; }
  get level() { return Math.min(MAX_LEVEL, 1 + Math.floor(this.s / LEVEL_DIST)); }
  // 0..1 progress towards the next level (1 once the top level is reached)
  get levelProgress() { return this.level >= MAX_LEVEL ? 1 : (this.s % LEVEL_DIST) / LEVEL_DIST; }
  get multiplier() { return this.level * (this.power.multiplier > 0 ? 2 : 1); }
  get height() { return this.rollT > 0 ? PLAYER.rollHeight : PLAYER.height; }

  // ---- input -------------------------------------------------------------
  left() { this._shift(-1); }
  right() { this._shift(1); }

  _shift(dir) {
    if (!this.alive) return;
    const next = this.lane + dir;
    if (next < 0 || next >= LANES) return;
    this.lane = next;
    this.events.push({ type: 'lane', dir });
  }

  jump() {
    if (!this.alive) return;
    this.jumpBuf = JUMP_BUFFER;
    this.rollQueued = false; // the latest input wins
  }

  down() {
    if (!this.alive || this.flying) return;
    if (this.grounded) {
      this._startRoll();
    } else {
      this.vy = Math.min(this.vy, -FAST_FALL_V);
      this.rollQueued = true;
      this.jumpBuf = 0;
    }
  }

  _startRoll() {
    this.rollT = ROLL_TIME;
    this.rollQueued = false;
    this.jumpBuf = 0;
    this.events.push({ type: 'roll' });
  }

  // ---- simulation ----------------------------------------------------------
  step(dt) {
    if (!this.alive || dt <= 0) return;
    const n = Math.max(1, Math.ceil(Math.max(this.speed * dt / MAX_SUBSTEP_DIST, dt / MAX_SUBSTEP_TIME)));
    const h = dt / n;
    for (let i = 0; i < n && this.alive; i++) this._sub(h);
    this._generate();
    this._cleanup();
  }

  _tick(h) {
    this.time += h;
    for (const k in this.power) {
      if (this.power[k] > 0) {
        this.power[k] = Math.max(0, this.power[k] - h);
        if (this.power[k] === 0) {
          this.events.push({ type: 'powerEnd', power: k });
          if (k === 'jetpack') {
            this.graceT = Math.max(this.graceT, GRACE_TIME + 0.5);
            this.vy = 0;
          }
        }
      }
    }
    this.stumbleT = Math.max(0, this.stumbleT - h);
    this.stumbleCool = Math.max(0, this.stumbleCool - h);
    this.graceT = Math.max(0, this.graceT - h);
    this.jumpBuf = Math.max(0, this.jumpBuf - h);
    this.coyote = Math.max(0, this.coyote - h);
    if (this.rollT > 0) this.rollT = Math.max(0, this.rollT - h);
  }

  _surface(x, s) {
    return surfaceHeight(this.trains, x, s, PLAYER.halfW, PLAYER.halfD, s);
  }

  _sub(h) {
    this._tick(h);
    const v = this.speed;

    // --- horizontal movement and walls (trains) ---
    let nx = approach(this.x, laneX(this.lane), LANE_SPEED * h);
    const ns = this.s + v * h;
    if (this._surface(nx, ns) > this.y + STEP_UP) {
      if (nx !== this.x && this._surface(this.x, ns) <= this.y + STEP_UP) {
        // Clipped the side of a train while changing lanes: bounce back.
        const dir = Math.sign(nx - this.x);
        const li = this.x / LANE_W + 1;
        this.lane = dir > 0 ? Math.floor(li + 1e-6) : Math.ceil(li - 1e-6);
        nx = this.x;
        this._stumble();
        if (!this.alive) return;
      } else if (this.graceT > 0 || this.flying) {
        this.y = this._surface(nx, ns); // invulnerable: hop onto the roof
        this.vy = Math.max(this.vy, 0);
      } else if (this.power.board > 0) {
        this._breakBoard();
        this.y = this._surface(nx, ns);
        this.vy = Math.max(this.vy, 0);
      } else {
        this._die('train');
        return;
      }
    }
    this.x = nx;
    this.s = ns;
    const lv = this.level;
    if (lv > this.lastLevel) {
      this.lastLevel = lv;
      this.events.push({ type: 'level', level: lv });
    }

    // --- vertical movement ---
    const ground = this._surface(this.x, this.s);
    if (this.flying) {
      this.y = approach(this.y, FLY_Y, 14 * h);
      if (this.y < ground) this.y = ground;
      this.vy = 0;
      this.grounded = false;
      this.rollT = 0;
      this.rollQueued = false;
    } else {
      if (this.jumpBuf > 0 && (this.grounded || this.coyote > 0) && this.vy <= 0) {
        const jh = this.power.sneakers > 0 ? SUPER_JUMP_H : JUMP_H;
        this.vy = Math.sqrt(2 * GRAVITY * jh);
        this.grounded = false;
        this.coyote = 0;
        this.jumpBuf = 0;
        this.rollT = 0;
        this.rollQueued = false;
        this.events.push({ type: 'jump', super: this.power.sneakers > 0 });
      }
      this.vy -= GRAVITY * h;
      this.y += this.vy * h;
      if (this.y <= ground) {
        if (!this.grounded) this.events.push({ type: 'land', hard: this.vy < -20 });
        this.y = ground;
        this.vy = 0;
        this.grounded = true;
        if (this.rollQueued) this._startRoll();
      } else {
        if (this.grounded) this.coyote = COYOTE_TIME;
        this.grounded = false;
      }
    }

    // --- barriers ---
    if (this.graceT <= 0 && !this.flying) {
      const b = hitBarrier(this.barriers, this.x, this.s, this.y, this.height, PLAYER.halfW, PLAYER.halfD);
      if (b) {
        if (this.power.board > 0) {
          b.smashed = true;
          this._breakBoard();
        } else {
          this._die(b.kind);
          return;
        }
      }
    }

    // --- score and pickups ---
    this.score += v * h * this.multiplier;
    this._pickups();
  }

  _pickups() {
    const cy = this.y + this.height / 2;
    const magnet = this.power.magnet > 0;
    for (let i = this.coinItems.length - 1; i >= 0; i--) {
      const c = this.coinItems[i];
      const ds = c.s - this.s;
      if (ds > MAGNET_RANGE + 2) continue;
      let take = false;
      if ((magnet || c.magnet) && ds < MAGNET_RANGE && ds > -3) {
        c.magnet = true;
        take = ds < 1.2;
      } else if (Math.abs(ds) < 0.9 && Math.abs(laneX(c.lane) - this.x) < 0.95 && Math.abs(c.y - cy) < 1.35) {
        take = true;
      }
      if (take) {
        this.coinItems.splice(i, 1);
        this.removed.push(c);
        this.coins += 1;
        this.score += 10 * this.multiplier;
        this.events.push({ type: 'coin' });
      }
    }
    for (let i = this.powers.length - 1; i >= 0; i--) {
      const p = this.powers[i];
      const ds = p.s - this.s;
      if (Math.abs(ds) < 1.0 && Math.abs(laneX(p.lane) - this.x) < 1.1 && Math.abs(p.y - cy) < 1.6) {
        this.powers.splice(i, 1);
        this.removed.push(p);
        this._activate(p.type);
      }
    }
  }

  _activate(type) {
    this.power[type] = POWER_TIME[type];
    if (type === 'jetpack') {
      this.rollT = 0;
      this.rollQueued = false;
      this.jumpBuf = 0;
      this._skyCoins();
    }
    this.events.push({ type: 'power', power: type });
  }

  _skyCoins() {
    const v = this.speed;
    let lane = this.lane;
    let n = 0;
    const end = this.s + v * POWER_TIME.jetpack - 25;
    for (let cs = this.s + 22; cs < end; cs += 2.4) {
      if (n > 0 && n % 12 === 0) {
        const opts = [lane - 1, lane + 1].filter((l) => l >= 0 && l < LANES);
        lane = opts[(n / 12) % opts.length];
      }
      const c = { kind: 'coin', id: this.nextSkyId--, lane, s: cs, y: FLY_Y + PLAYER.height / 2 };
      this.coinItems.push(c);
      this.added.push(c);
      n++;
    }
  }

  _stumble() {
    if (this.stumbleCool > 0) return;
    this.stumbleCool = 0.5;
    if (this.graceT > 0 || this.flying) {
      this.events.push({ type: 'bump' });
      return;
    }
    if (this.stumbleT > 0) {
      if (this.power.board > 0) {
        this._breakBoard();
        return;
      }
      this._die('caught');
      return;
    }
    this.stumbleT = STUMBLE_TIME;
    this.events.push({ type: 'stumble' });
  }

  _breakBoard() {
    this.power.board = 0;
    this.graceT = GRACE_TIME;
    this.events.push({ type: 'boardBreak' });
  }

  _die(cause) {
    this.alive = false;
    this.deathCause = cause;
    this.events.push({ type: 'crash', cause });
  }

  _generate() {
    if (this.gen.cursor >= this.s + GEN_AHEAD) return;
    const items = this.gen.generate(this.s + GEN_AHEAD);
    for (const it of items) {
      if (it.kind === 'train') this.trains.push(it);
      else if (it.kind === 'coin') this.coinItems.push(it);
      else if (it.kind === 'power') this.powers.push(it);
      else this.barriers.push(it);
      this.added.push(it);
    }
  }

  _cleanup() {
    const limit = this.s - KEEP_BEHIND;
    const prune = (arr, endOf) => {
      let w = 0;
      for (let i = 0; i < arr.length; i++) {
        const it = arr[i];
        if (endOf(it) < limit) this.removed.push(it);
        else arr[w++] = it;
      }
      arr.length = w;
    };
    prune(this.trains, (t) => trainFront(t, this.s) + t.len);
    prune(this.barriers, (b) => b.s);
    prune(this.coinItems, (c) => c.s + KEEP_BEHIND - 4);
    prune(this.powers, (p) => p.s + KEEP_BEHIND - 4);
  }

  // Drains and returns the events produced since the last call.
  takeEvents() {
    const e = this.events;
    this.events = [];
    return e;
  }
}
