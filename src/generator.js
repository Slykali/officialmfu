// Procedural level generator.
//
// The track is generated in "rows" spaced far enough apart that the player
// always has time to react. A *safe lane* is tracked while generating: it never
// contains a train the player cannot run over (only trains with a ramp), and it
// only moves one lane at a time into a lane that has been train-free since the
// previous row. Following the safe lane is therefore always survivable, which
// guarantees every generated level can be beaten.
import {
  LANES, TRAIN, RAMP_L, MOVING, POWER_TYPES, speedAt, laneX, GRAVITY, PLAYER,
} from './config.js';
import { surfaceHeight } from './physics.js';

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST_ROW = 70;
const GAP_AFTER_TRAIN = 16; // free track after a train before the next object
const GAP_AFTER_BARRIER = 8;
const COIN_SPACING = 2.4;
const POWER_MIN_GAP = 240;
const POWER_WEIGHTS = { magnet: 3, multiplier: 2, sneakers: 2, jetpack: 1.5, board: 1.5 };

export const rowGap = (s) => Math.max(20, speedAt(s) * 0.8);

export class LevelGenerator {
  constructor(seed = 1) {
    this.rng = mulberry32(seed);
    this.nextId = 1;
    this.cursor = FIRST_ROW;
    this.prevRow = FIRST_ROW - 6; // the intro coin run covers the stretch before the first row
    this.safe = 1;
    this.trainFree = [0, 0, 0]; // track position where each lane's trains end
    this.objFree = [0, 0, 0]; // earliest position for the next object in a lane
    this.lastPower = 0;
    this.recentTrains = []; // static trains, used to place coins on roofs/ramps
    this.started = false;
  }

  // Generates every item up to track position `until` and returns the new ones.
  generate(until) {
    const out = [];
    if (!this.started) {
      this.started = true;
      // stop short of where the first row could place a ramp
      for (let s = 18; s < FIRST_ROW - RAMP_L - 2; s += COIN_SPACING) this._coin(out, 1, s, 1.0);
    }
    while (this.cursor < until) {
      this._row(this.cursor, out);
      this.prevRow = this.cursor;
      this.cursor += rowGap(this.cursor);
    }
    return out;
  }

  _id() { return this.nextId++; }

  _pick(arr) { return arr[Math.floor(this.rng() * arr.length) % arr.length]; }

  _coin(out, lane, s, y) {
    out.push({ kind: 'coin', id: this._id(), lane, s, y });
  }

  _train(out, lane, s, cars, ramp) {
    const t = {
      kind: 'train', id: this._id(), lane, s, cars, len: cars * TRAIN.carLen,
      ramp, moving: false, k: 0, R: 0, livery: Math.floor(this.rng() * 4),
    };
    out.push(t);
    this.recentTrains.push(t);
    this.trainFree[lane] = s + t.len;
    this.objFree[lane] = s + t.len + GAP_AFTER_TRAIN;
    return t;
  }

  _row(s, out) {
    const r = this.rng;
    const sPrev = this.prevRow;
    const d = Math.min(1, s / 3500); // difficulty 0..1

    // Forget trains far behind the cursor.
    this.recentTrains = this.recentTrains.filter((t) => t.s + t.len > sPrev - 40);

    // 1. Possibly move the safe lane by one into a lane free of trains since the previous row.
    let shifted = false;
    if (r() < 0.4) {
      const cands = [this.safe - 1, this.safe + 1].filter(
        (l) => l >= 0 && l < LANES && this.trainFree[l] <= sPrev,
      );
      if (cands.length) {
        this.safe = this._pick(cands);
        shifted = true;
      }
    }

    // 2. Fill each lane.
    let safeKind = 'none';
    for (let lane = 0; lane < LANES; lane++) {
      if (this.objFree[lane] > s) {
        if (lane === this.safe) safeKind = 'busy';
        continue;
      }
      if (lane === this.safe) safeKind = this._fillSafe(out, lane, s, d, shifted);
      else this._fillOther(out, lane, s, d);
    }

    // 3. Coins along the safe lane between the previous row and this one.
    this._coinsBetween(out, sPrev, s, shifted, safeKind);
  }

  _fillSafe(out, lane, s, d, shifted) {
    const r = this.rng;
    const x = r();
    const pRamp = 0.08 + 0.14 * d;
    if (!shifted && x < pRamp && this.objFree[lane] <= s - RAMP_L - 2) {
      this._train(out, lane, s, Math.min(3, 1 + Math.floor(r() * (1.5 + 1.5 * d))), true);
      return 'ramp';
    }
    if (x < pRamp + 0.2 + 0.1 * d) {
      out.push({ kind: 'hurdle', id: this._id(), lane, s });
      this.objFree[lane] = s + GAP_AFTER_BARRIER;
      return 'hurdle';
    }
    if (x < pRamp + 0.36 + 0.18 * d) {
      out.push({ kind: 'overhead', id: this._id(), lane, s });
      this.objFree[lane] = s + GAP_AFTER_BARRIER;
      return 'overhead';
    }
    if (s - this.lastPower > POWER_MIN_GAP && r() < 0.22) {
      this.lastPower = s;
      out.push({ kind: 'power', id: this._id(), lane, s, y: 1.2, type: this._powerType() });
      this.objFree[lane] = s + GAP_AFTER_BARRIER;
      return 'power';
    }
    return 'none';
  }

  _fillOther(out, lane, s, d) {
    const r = this.rng;
    const x = r();
    const pMoving = s > 450 ? 0.03 + 0.09 * d : 0;
    const pTrain = 0.3 + 0.25 * d;
    if (x < pMoving) {
      const cars = 1 + Math.floor(r() * 2);
      const t = {
        kind: 'train', id: this._id(), lane, s, cars, len: cars * TRAIN.carLen,
        ramp: false, moving: true, k: MOVING.k, R: MOVING.R, livery: 4,
      };
      out.push(t);
      // Reserve the whole stretch the train sweeps through, plus the point where it meets the player.
      const end = s + MOVING.k * MOVING.R + t.len;
      this.trainFree[lane] = end;
      this.objFree[lane] = end + GAP_AFTER_TRAIN;
      return;
    }
    if (x < pMoving + pTrain) {
      const ramp = r() < 0.35 && this.objFree[lane] <= s - RAMP_L - 2;
      this._train(out, lane, s, Math.min(3, 1 + Math.floor(r() * (1.5 + 1.5 * d))), ramp);
      return;
    }
    if (x < pMoving + pTrain + 0.16) {
      out.push({ kind: 'hurdle', id: this._id(), lane, s });
      this.objFree[lane] = s + GAP_AFTER_BARRIER;
      return;
    }
    if (x < pMoving + pTrain + 0.3) {
      out.push({ kind: 'overhead', id: this._id(), lane, s });
      this.objFree[lane] = s + GAP_AFTER_BARRIER;
    }
  }

  _powerType() {
    let total = 0;
    for (const t of POWER_TYPES) total += POWER_WEIGHTS[t];
    let x = this.rng() * total;
    for (const t of POWER_TYPES) {
      x -= POWER_WEIGHTS[t];
      if (x < 0) return t;
    }
    return 'magnet';
  }

  _coinsBetween(out, sPrev, s, shifted, safeKind) {
    const lane = this.safe;
    const r = this.rng;
    // Arc over a hurdle, or a low line under an overhead bar, at this row.
    if (safeKind === 'hurdle') {
      for (let ds = -4; ds <= 4.01; ds += 2) {
        this._coin(out, lane, s + ds, 1.0 + 1.5 * (1 - (ds / 5) ** 2));
      }
    } else if (safeKind === 'overhead') {
      for (let ds = -2; ds <= 2.01; ds += 2) this._coin(out, lane, s + ds, 0.55);
    }
    if (r() > 0.55) return;
    const start = sPrev + (shifted ? 8 : 6);
    const end = s - (safeKind === 'hurdle' ? 6 : safeKind === 'overhead' ? 4 : 3);
    for (let cs = start; cs <= end; cs += COIN_SPACING) {
      let h = surfaceHeight(this.recentTrains, laneX(lane), cs, 0.01, 0.01, 0);
      // just past a roof end, follow the arc the runner falls along instead of dropping straight down
      for (const t of this.recentTrains) {
        const d = cs - (t.s + t.len);
        if (t.lane !== lane || d < 0 || d > 14) continue;
        const tt = Math.max(0, d - PLAYER.halfD) / speedAt(cs);
        h = Math.max(h, TRAIN.height - 0.5 * GRAVITY * tt * tt);
      }
      this._coin(out, lane, cs, h + 1.0);
    }
  }
}
