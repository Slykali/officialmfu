// Helpers for test/bot.mjs: sim cloning, state keys, lookahead search, the
// autoplayer policy and layout dumps. Pure test code - it never edits src/.
//
// The gameplay modules are loaded from ../src/ unless BOT_SRC_DIR points at a
// copy (test/bot.mjs snapshots src/ at start-up so that every worker tests the
// same code even while src/ is being edited).
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SRC = process.env.BOT_SRC_DIR
  ? pathToFileURL(path.resolve(process.env.BOT_SRC_DIR) + path.sep).href
  : new URL('../src/', import.meta.url).href;
const { Sim } = await import(SRC + 'sim.js');
const { LevelGenerator } = await import(SRC + 'generator.js');
const { trainFront, surfaceHeight, hitBarrier } = await import(SRC + 'physics.js');
const { laneX, PLAYER, TRAIN, RAMP_L, HURDLE, OVERHEAD, MOVING, GRAVITY, FAST_FALL_V, speedAt } = await import(SRC + 'config.js');
export const SRC_URL = SRC;

export const DT = 1 / 60;
export const A_NONE = 0;
export const A_LEFT = 1;
export const A_RIGHT = 2;
export const A_JUMP = 3;
export const A_DOWN = 4;
export const ACTION_NAMES = ['none', 'left', 'right', 'jump', 'down'];

export function applyAction(sim, a) {
  switch (a) {
    case A_LEFT: sim.left(); break;
    case A_RIGHT: sim.right(); break;
    case A_JUMP: sim.jump(); break;
    case A_DOWN: sim.down(); break;
    default: break;
  }
}

// ---------------------------------------------------------------------------
// Cloning
//
// A lookahead clone must never call the level generator (it holds an RNG
// closure, so generating in a clone would either be impossible to copy or would
// advance the real RNG). Clones get a stub whose cursor is +Infinity, which
// makes Sim._generate() return immediately; the real sim already holds the
// level ~GEN_AHEAD units ahead, far more than any lookahead horizon.
//
// Every item object a clone can mutate (barriers get `smashed`, coins get
// `magnet`, arrays get spliced/pruned) is copied, so a clone can never corrupt
// the real sim. Unknown fields added to Sim later are copied generically
// (arrays element-wise, plain objects shallowly).
const NO_GEN = Object.freeze({ cursor: Infinity, generate() { return []; } });

// Fields of Sim known to this helper. Any other own field (added to Sim later)
// is copied generically, so the clone stays complete if Sim grows.
const KNOWN = new Set(['seed', 'gen', 'time', 's', 'x', 'lane', 'y', 'vy', 'grounded', 'coyote', 'rollT',
  'rollQueued', 'jumpBuf', 'alive', 'deathCause', 'stumbleT', 'stumbleCool', 'graceT', 'power', 'coins',
  'score', 'trains', 'barriers', 'coinItems', 'powers', 'events', 'added', 'removed', 'nextSkyId']);
const EXTRA = Symbol('extraKeys');

const copyItem = (o) => ({ ...o });
const copyGeneric = (v) => {
  if (Array.isArray(v)) return v.map((o) => (o && typeof o === 'object' ? { ...o } : o));
  if (v && typeof v === 'object') return { ...v };
  return v;
};

function trainInWindow(t, s, lo, hi) {
  const f = trainFront(t, s);
  if (f + t.len < lo) return false; // fully behind
  const start = t.moving ? Math.min(f, t.s) - 1 : f - (t.ramp ? RAMP_L : 0);
  return start < hi;
}

// Copy-on-write rules. Sim mutates item objects in exactly two places:
// barrier.smashed (only while a board is held) and coin.magnet (only while a
// magnet is held). If the clone holds neither and cannot pick one up from its
// (windowed) power list, the objects can be shared; the arrays themselves are
// always copied because Sim splices and prunes them.
function mayGet(c, type) {
  if (c.power[type] > 0) return true;
  for (let i = 0; i < c.powers.length; i++) if (c.powers[i].type === type) return true;
  return false;
}

function shapeClone(src, proto) {
  const c = Object.create(proto);
  c.seed = src.seed; c.gen = NO_GEN; c.time = src.time; c.s = src.s; c.x = src.x; c.lane = src.lane;
  c.y = src.y; c.vy = src.vy; c.grounded = src.grounded; c.coyote = src.coyote; c.rollT = src.rollT;
  c.rollQueued = src.rollQueued; c.jumpBuf = src.jumpBuf; c.alive = src.alive; c.deathCause = src.deathCause;
  c.stumbleT = src.stumbleT; c.stumbleCool = src.stumbleCool; c.graceT = src.graceT;
  c.power = { ...src.power }; c.coins = src.coins; c.score = src.score;
  c.trains = null; c.barriers = null; c.coinItems = null; c.powers = null;
  c.events = []; c.added = []; c.removed = []; c.nextSkyId = src.nextSkyId;
  return c;
}

/**
 * Clone of the real sim for lookahead.
 * @param {Sim} sim
 * @param {{window?: number, coins?: boolean}} opt
 *   window: only keep items that can matter within `window` units ahead
 *   coins: keep coin items (needed when coins are scored); default true
 */
export function cloneSim(sim, opt = {}) {
  const c = shapeClone(sim, Object.getPrototypeOf(sim));
  const s = sim.s;
  const lo = s - 3;
  const hi = opt.window != null ? s + opt.window : Infinity;
  const keepCoins = opt.coins !== false;
  c.trains = sim.trains.filter((t) => trainInWindow(t, s, lo, hi)).map(copyItem);
  c.powers = sim.powers.filter((p) => p.s > lo && p.s < hi).map(copyItem);
  c.barriers = sim.barriers.filter((b) => b.s > lo && b.s < hi).map(copyItem);
  c.coinItems = keepCoins ? sim.coinItems.filter((it) => it.s > lo - 2 && it.s < hi).map(copyItem) : [];
  const extra = Object.keys(sim).filter((k) => !KNOWN.has(k));
  for (const k of extra) c[k] = k === 'gen' ? NO_GEN : copyGeneric(sim[k]);
  Object.defineProperty(c, EXTRA, { value: extra, enumerable: false });
  return c;
}

// Fast clone of a clone (items already windowed and owned by the clone tree).
// events/added/removed are one shared scratch array: every user of a clone
// drains them right after each step(), and clones are never stepped
// concurrently, so sharing saves three allocations per clone.
const SCRATCH = [];
export function cloneClone(src) {
  const c = shapeClone(src, Object.getPrototypeOf(src));
  c.events = SCRATCH; c.added = SCRATCH; c.removed = SCRATCH;
  c.trains = src.trains.slice(); // Sim never writes to train objects (checked by itemFingerprint)
  c.powers = src.powers.slice(); // Sim never writes to power objects
  c.barriers = mayGet(src, 'board') ? src.barriers.map(copyItem) : src.barriers.slice();
  c.coinItems = mayGet(src, 'magnet') ? src.coinItems.map(copyItem) : src.coinItems.slice();
  const extra = src[EXTRA];
  if (extra && extra.length) for (const k of extra) c[k] = copyGeneric(src[k]);
  if (extra) Object.defineProperty(c, EXTRA, { value: extra, enumerable: false });
  return c;
}

// Integrity fingerprint of the real sim's items, used to prove that lookahead
// never mutates them.
export function itemFingerprint(sim) {
  let h = 0;
  const mix = (x) => { h = (Math.imul(h ^ x, 2654435761) + 0x9e3779b9) | 0; };
  const num = (n) => mix(Math.round((n ?? 0) * 1000));
  for (const t of sim.trains) { num(t.id); num(t.s); num(t.len); mix(t.ramp ? 1 : 0); mix(t.moving ? 1 : 0); num(t.k); num(t.R); }
  for (const b of sim.barriers) { num(b.id); num(b.s); mix(b.smashed ? 7 : 3); mix(b.lane); }
  for (const c of sim.coinItems) { num(c.id); num(c.s); num(c.y); mix(c.magnet ? 5 : 2); mix(c.lane); }
  for (const p of sim.powers) { num(p.id); num(p.s); mix(p.lane); }
  mix(sim.trains.length); mix(sim.barriers.length); mix(sim.coinItems.length); mix(sim.powers.length);
  return h;
}

// ---------------------------------------------------------------------------
// State keys (for deduplicating search nodes). s is a pure function of time
// (speed depends only on s), so every node at the same search depth has the
// same s and the key does not need it.
//
// The key is split into an exact 47-bit "fast" number (position, velocity,
// roll/jump/coyote timers) and a 32-bit hash of the slowly varying timers
// (grace, stumble, power-ups); see search() for how both are used.
// NOTE: if Sim grows new state that affects physics, add it here.
let KEY_SLOW = 0;
const clampI = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
function mixSlow(h, v) { h = Math.imul(h ^ v, 0x85ebca6b); return (h ^ (h >>> 13)) | 0; }

export function stateKey(c, fine) {
  const p = c.power;
  let h = 0x2545f491;
  if (fine) {
    for (const k in p) h = mixSlow(h, Math.round(p[k] * 60));
    h = mixSlow(h, Math.round(c.graceT * 60));
    h = mixSlow(h, Math.round(c.stumbleT * 60));
    h = mixSlow(h, Math.round(c.stumbleCool * 60));
    h = mixSlow(h, c.powers.length);
    KEY_SLOW = h;
    let k = c.lane;
    k = k * 1024 + clampI(Math.round(c.x * 100) + 320, 0, 1023);
    k = k * 1024 + clampI(Math.round(c.y * 100), 0, 1023);
    k = k * 1024 + clampI(Math.round(c.vy * 10) + 512, 0, 1023);
    k = k * 64 + clampI(Math.round(c.rollT * 60), 0, 63);
    k = k * 2 + (c.rollQueued ? 1 : 0);
    k = k * 16 + clampI(Math.round(c.jumpBuf * 60), 0, 15);
    k = k * 8 + clampI(Math.round(c.coyote * 60), 0, 7);
    return k * 2 + (c.grounded ? 1 : 0);
  }
  for (const k in p) h = mixSlow(h, Math.round(p[k] * 10));
  h = mixSlow(h, Math.ceil(c.graceT * 4));
  h = mixSlow(h, c.stumbleT > 0 ? 1 : 0);
  h = mixSlow(h, c.powers.length);
  KEY_SLOW = h;
  let k = c.lane;
  k = k * 64 + clampI(Math.round(c.x * 5) + 16, 0, 63);
  k = k * 64 + clampI(Math.round(c.y * 4), 0, 63);
  k = k * 128 + clampI(Math.round(c.vy / 2) + 32, 0, 127);
  k = k * 16 + clampI(Math.ceil(c.rollT * 15), 0, 15);
  k = k * 2 + (c.rollQueued ? 1 : 0);
  k = k * 8 + clampI(Math.ceil(c.jumpBuf * 30), 0, 7);
  k = k * 2 + (c.coyote > 0 ? 1 : 0);
  return k * 2 + (c.grounded ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Safe-lane oracle: a second LevelGenerator with the same seed, instrumented
// (on the instance, not the source) to record the safe lane of every row.
export class SafeLaneOracle {
  constructor(seed) {
    this.gen = new LevelGenerator(seed);
    this.rows = []; // {s, safe, prevSafe, items: ids of non-coin items of the row}
    const g = this.gen;
    const proto = Object.getPrototypeOf(g);
    const rows = this.rows;
    g._row = function (s, out) {
      const before = this.safe;
      const n0 = out.length;
      proto._row.call(this, s, out);
      rows.push({ s, safe: this.safe, prevSafe: before, items: out.slice(n0).filter((i) => i.kind !== 'coin').map((i) => i.id) });
    };
  }
  ensure(until) { if (this.gen.cursor < until) this.gen.generate(until); }
  // Safe lane for track position p: that of the first row at or after p.
  safeAt(p) {
    this.ensure(p + 100);
    const r = this.rows;
    let lo = 0, hi = r.length - 1;
    if (!r.length || p > r[hi].s) return 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (r[m].s >= p) hi = m; else lo = m + 1; }
    return r[lo].safe;
  }
  rowsBetween(a, b) { this.ensure(b + 50); return this.rows.filter((r) => r.s >= a && r.s <= b); }
}

// ---------------------------------------------------------------------------
// Search
//
// Breadth-first over frames with state deduplication: each depth keeps at most
// one node per key (the one with the best value). Inputs are only allowed on
// "decision" frames (every `every` frames). A node is discarded when the sim
// dies, or (unless allowed) when an "incident" happens: a stumble, or the
// board absorbing a crash (an incident can hide an unavoidable crash, so for
// verification we want to know whether it was avoidable).
//
// opt.reward(c) is added to a node's value every frame (path integral);
// pickups of power-ups add opt.powerWeight each, coins opt.coinWeight each.
//
// Returns { ok, plan: action[], end: Sim, value, depth } where depth is the
// number of frames the best node survived (== horizon when ok).
export function search(root, opt) {
  const H = opt.horizon;
  const every = opt.every || 1;
  const beam = opt.beam || 400;
  const fine = !!opt.fine;
  const allowStumble = !!opt.allowStumble;
  const allowBoard = !!opt.allowBoard;
  const boardBonus = opt.boardBonus || 0; // >0: deliberately crash while holding a board (boardcrash variant)
  const reward = opt.reward || null;
  const coinW = opt.coinWeight || 0;
  const powerW = opt.powerWeight || 0;
  const actions = opt.actions || [A_NONE, A_LEFT, A_RIGHT, A_JUMP, A_DOWN];
  const goal = opt.goal || null; // optional predicate: node succeeds early
  const root0 = cloneClone(root);
  root0.events.length = 0;
  let frontier = [{ sim: root0, path: null, v: 0, inc: 0, pk: 0 }];
  let depth = 0;
  let expanded = 0;
  let peak = 1;
  for (let f = 0; f < H; f++) {
    const decide = f % every === 0;
    const acts = decide ? actions : [A_NONE];
    const map = new Map();
    const alt = new Map(); // same fast key, different slow timers (rare)
    for (let ni = 0; ni < frontier.length; ni++) {
      const node = frontier[ni];
      const ns = node.sim;
      for (let ai = 0; ai < acts.length; ai++) {
        const a = acts[ai];
        // inputs that provably do nothing are skipped (left in lane 0, right
        // in lane 2, down while flying)
        if (ai !== acts.length - 1 && ((a === A_LEFT && ns.lane === 0) || (a === A_RIGHT && ns.lane === 2) || (a === A_DOWN && ns.power.jetpack > 0))) continue;
        const last = ai === acts.length - 1;
        const c = last ? node.sim : cloneClone(node.sim);
        const coinsBefore = c.coins;
        applyAction(c, a);
        c.step(DT);
        expanded++;
        if (!c.alive) continue;
        let inc = node.inc;
        let pk = node.pk;
        let bb = node.bb || 0;
        let bad = false;
        const ev = c.events;
        for (let i = 0; i < ev.length; i++) {
          if (ev[i].kind !== undefined) continue; // an item pushed to the shared added/removed scratch
          const t = ev[i].type;
          if (t === 'stumble') { if (!allowStumble) bad = true; inc += 1; }
          else if (t === 'boardBreak') { if (!allowBoard) bad = true; if (boardBonus) bb += 1; else inc += 1; }
          else if (t === 'power') pk += 1;
        }
        ev.length = 0;
        if (c.removed.length) c.removed.length = 0;
        if (bad) continue;
        let v = node.v + (a !== A_NONE ? -0.002 : 0) + coinW * (c.coins - coinsBefore) + powerW * (pk - node.pk) - 50 * (inc - node.inc) +
          boardBonus * (bb - (node.bb || 0));
        if (reward) v += reward(c);
        const key = stateKey(c, fine);
        const slow = KEY_SLOW;
        let prev = map.get(key);
        let useAlt = false;
        if (prev && prev.slow !== slow) { useAlt = true; prev = alt.get(key + ':' + slow); }
        if (prev && prev.v >= v) continue;
        const nn = { sim: c, path: { a, prev: node.path }, v, inc, pk, slow, bb };
        if (useAlt) alt.set(key + ':' + slow, nn); else map.set(key, nn);
        if (goal && goal(c, nn)) return finish(nn, f + 1, true);
      }
    }
    if (!map.size && !alt.size) break;
    let next = Array.from(map.values());
    if (alt.size) for (const n of alt.values()) next.push(n);
    if (next.length > peak) peak = next.length;
    if (next.length > beam) {
      next.sort((p, q) => q.v - p.v);
      next = diverseTruncate(next, beam);
    }
    frontier = next;
    depth = f + 1;
  }
  let best = null;
  for (const n of frontier) if (!best || n.v > best.v) best = n;
  // with a goal, surviving the horizon without reaching it is a failure
  return finish(best, depth, depth === H && !goal);

  function finish(n, d, ok) {
    const plan = [];
    for (let p = n ? n.path : null; p; p = p.prev) plan.push(p.a);
    plan.reverse();
    return { ok, plan, end: n ? n.sim : null, value: n ? n.v : -Infinity, depth: d, expanded, peak, inc: n ? n.inc : 0, pk: n ? n.pk : 0 };
  }
}

// Keep the best nodes but make sure each (lane, grounded, rolling, rising)
// bucket keeps some representatives so the beam does not collapse.
function diverseTruncate(sorted, beam) {
  const per = Math.max(4, Math.floor(beam / 16));
  const counts = new Map();
  const keep = [];
  const rest = [];
  for (const n of sorted) {
    const c = n.sim;
    const b = `${c.lane}|${Math.round(c.x)}|${c.grounded ? 1 : 0}|${c.rollT > 0 ? 1 : 0}|${c.vy > 0 ? 1 : 0}`;
    const k = counts.get(b) || 0;
    if (k < per) { counts.set(b, k + 1); keep.push(n); } else rest.push(n);
  }
  for (const n of rest) { if (keep.length >= beam) break; keep.push(n); }
  return keep;
}

// ---------------------------------------------------------------------------
// The autoplayer.
//
// It keeps a plan of per-frame inputs covering `horizon` frames and the sim
// state at the end of the plan ("tail"). Each frame it executes plan[0],
// appends a no-op and advances the tail by one frame; if the tail dies or has
// an incident the plan is recomputed by search from the real state. Every
// `resync` frames the plan is re-verified from the real sim, so newly
// generated items are always taken into account.
export class Bot {
  constructor(opt = {}) {
    this.horizon = opt.horizon || 150;
    this.every = opt.every || 4;
    this.beam = opt.beam || 60;
    this.resync = opt.resync || 30;
    this.powers = opt.powers || 'avoid'; // avoid | ignore | seek
    this.coins = !!opt.coins;
    this.oracle = opt.oracle || null;
    this.safeWeight = opt.safeWeight ?? 0.02;
    this.crashBoard = !!opt.crashBoard;
    this.plan = [];
    this.tail = null;
    this.sinceSync = Infinity;
    this.doom = 0;
    this.seen = new Set();
    this.stats = { replans: 0, level: {}, predictedDeath: 0, expanded: 0, peak: 0 };
  }

  window() { return 30 + this.horizon * (32 / 60) + 20; }

  _opts() {
    const oracle = this.oracle;
    const w = this.safeWeight;
    const reward = (c) => {
      let v = -0.001 * Math.abs(c.x); // mild centre preference: more escape options
      if (oracle && w) v -= w * Math.abs(c.x - laneX(oracle.safeAt(c.s + 6)));
      return v;
    };
    return {
      horizon: this.horizon, every: this.every, beam: this.beam, reward,
      ...(this.crashBoard && this.holdingBoard ? { allowBoard: true, boardBonus: 60 } : {}),
      coinWeight: this.coins ? 0.6 : 0,
      powerWeight: this.powers === 'seek' ? 40 : this.powers === 'avoid' ? -40 : 0,
    };
  }

  _verifyFrom(sim) {
    const c = cloneSim(sim, { window: this.window(), coins: this.coins });
    for (let i = 0; i < this.plan.length; i++) {
      applyAction(c, this.plan[i]);
      c.step(DT);
      c.removed.length = 0;
      if (!c.alive || badEvents(c, this.powers, this.crashBoard)) return null;
    }
    return c;
  }

  _replan(sim) {
    this.stats.replans++;
    this.holdingBoard = sim.power.board > 0;
    const root = cloneSim(sim, { window: this.window(), coins: this.coins });
    const base = this._opts();
    // Escalating search effort: cheap coarse search first, then finer input
    // timing and wider beams, and only then plans with incidents.
    const ladder = [
      { every: this.every, beam: this.beam },
      { every: 2, beam: this.beam * 5 },
      { every: 1, beam: this.beam * 20 },
      { every: 1, beam: this.beam * 20, allowStumble: root.stumbleT <= 0, allowBoard: true },
    ];
    let r = null;
    let best = null;
    for (let i = 0; i < ladder.length; i++) {
      r = search(root, { ...base, ...ladder[i] });
      this.stats.expanded += r.expanded;
      this.stats.peak = Math.max(this.stats.peak, r.peak);
      if (!best || r.depth > best.depth) best = r;
      if (r.ok) { this.stats.level[i] = (this.stats.level[i] || 0) + 1; break; }
    }
    if (!r.ok) { this.stats.predictedDeath++; r = best; this.doom = 8; }
    this.plan = r.plan.slice();
    while (this.plan.length < this.horizon) this.plan.push(A_NONE);
    this.tail = r.ok ? r.end : null;
    this.lastSearch = r;
    this.sinceSync = 0;
  }

  // New things worth re-planning for even though the plan still survives:
  // power-ups (seek mode) or coins (coin mode) entering the horizon.
  _novelty(sim) {
    if (this.powers !== 'seek' && !this.coins) return false;
    const reach = sim.s + this.horizon * sim.speed / 60;
    let fresh = false;
    if (this.powers === 'seek') {
      for (const p of sim.powers) if (p.s < reach && p.s > sim.s && !this.seen.has(p.id)) { this.seen.add(p.id); fresh = true; }
    }
    if (this.coins) {
      for (const c of sim.coinItems) if (c.s < reach && c.s > sim.s && !this.seen.has(c.id)) { this.seen.add(c.id); fresh = true; }
    }
    return fresh;
  }

  // Returns the input for this frame.
  act(sim) {
    if (this.doom > 0) {
      this.doom--;
    } else if (!this.tail || this.sinceSync >= this.resync || this._novelty(sim)) {
      while (this.plan.length < this.horizon) this.plan.push(A_NONE);
      const end = (this.tail && this.sinceSync < this.resync) ? null : this._verifyFrom(sim);
      if (end) { this.tail = end; this.sinceSync = 0; } else this._replan(sim);
    }
    this.sinceSync++;
    const a = this.plan.shift();
    this.plan.push(A_NONE);
    if (this.tail) {
      this.tail.step(DT);
      this.tail.removed.length = 0;
      if (!this.tail.alive || badEvents(this.tail, this.powers, this.crashBoard)) this.tail = null; // replan next frame
    }
    return a;
  }
}

// Events that invalidate a plan: incidents, and (when avoiding power-ups) a
// pickup the plan did not intend.
function badEvents(c, powers, boardOk) {
  const ev = c.events;
  let bad = false;
  for (let i = 0; i < ev.length; i++) {
    if (ev[i].kind !== undefined) continue;
    const t = ev[i].type;
    if (t === 'stumble' || (t === 'boardBreak' && !boardOk)) bad = true;
    else if (t === 'power' && powers === 'avoid') bad = true;
  }
  ev.length = 0;
  return bad;
}

// ---------------------------------------------------------------------------
// Checkpoints and the exhaustive "judge".
//
// A checkpoint is a full clone of the real sim plus the generator cursor at
// that moment. To search further ahead than the real sim had generated, the
// judge regenerates the level with a fresh LevelGenerator(seed): it is advanced
// to the same cursor and every item generated after that is injected into the
// clone (the level is a pure function of the seed, so ids/positions match).
export function checkpoint(sim, frame) {
  return { frame, s: sim.s, genCursor: sim.gen.cursor, sim: cloneSim(sim, { coins: true }) };
}

export function rootFromCheckpoint(cp, seed, until) {
  const root = cloneClone(cp.sim);
  const g = new LevelGenerator(seed);
  g.generate(cp.genCursor);
  if (g.cursor !== cp.genCursor) throw new Error(`generator replay mismatch ${g.cursor} vs ${cp.genCursor}`);
  if (until > cp.genCursor) {
    for (const it of g.generate(until)) {
      const o = { ...it };
      if (it.kind === 'train') root.trains.push(o);
      else if (it.kind === 'coin') root.coinItems.push(o);
      else if (it.kind === 'power') root.powers.push(o);
      else root.barriers.push(o);
    }
  }
  return root;
}

/**
 * Exhaustive survival search from a checkpoint: inputs allowed every frame,
 * near-exact state dedup, huge beam. Stumbles and board breaks are allowed
 * unless strict (strict = "can it be survived with no incident at all").
 */
export function judge(cp, seed, untilFrame, opt = {}) {
  const H = untilFrame - cp.frame;
  const until = cp.s + (H / 60) * 33 + 80;
  const root = rootFromCheckpoint(cp, seed, until);
  root.coinItems = []; // coins cannot affect survival
  const t0 = Date.now();
  const beam = opt.beam || 20000;
  // Stage A finds an escape quickly when there is an easy one; stage B is the
  // (near-)exhaustive search: inputs on every frame, ~1 cm / 0.1 m/s / 1 frame
  // state resolution, beam large enough that it rarely truncates.
  const stages = opt.stages || [
    { every: 2, beam: 3000, fine: false },
    { every: 1, beam, fine: true },
  ];
  let r = null;
  let stage = 0;
  let expanded = 0;
  for (; stage < stages.length; stage++) {
    r = search(root, {
      horizon: H, ...stages[stage],
      allowStumble: !opt.strict, allowBoard: !opt.strict, coinWeight: 0, powerWeight: 0,
    });
    expanded += r.expanded;
    if (r.ok) break;
  }
  const st = Math.min(stage, stages.length - 1);
  const last = stages[st];
  return { ok: r.ok, stage: st, depth: r.depth, horizon: H, fromFrame: cp.frame, fromS: cp.s, peak: r.peak,
    beam: last.beam, truncated: r.peak > last.beam, expanded, ms: Date.now() - t0, plan: r.plan, endS: r.end ? r.end.s : null };
}

// ---------------------------------------------------------------------------
// Static scan of the generator (no simulation): checks the documented
// safe-lane invariant and item placement directly on the generated level.
// Cheap enough for thousands of seeds.
export function staticScan(seed, until) {
  const g = new LevelGenerator(seed);
  const rows = [];
  const proto = Object.getPrototypeOf(g);
  g._row = function (s, out) {
    const prev = this.safe;
    const sPrev = this.prevRow;
    proto._row.call(this, s, out);
    rows.push({ s, sPrev, safe: this.safe, prevSafe: prev });
  };
  const items = g.generate(until);
  const lanes = [[], [], []];
  const trains = [[], [], []];
  for (const it of items) {
    lanes[it.lane].push(it);
    if (it.kind === 'train') trains[it.lane].push(it);
  }
  const issues = [];
  const add = (type, info) => issues.push({ type, seed, ...info });
  const K = MOVING.k;
  // 1. safe lane segments
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const L = r.safe;
    if (Math.abs(L - r.prevSafe) > 1) add('safe-jump-two-lanes', { row: r.s, from: r.prevSafe, to: L });
    for (const t of trains[L]) {
      if (t.moving) {
        // a moving train hits a player in its lane for player positions in [t.s, t.s + len/(1+k)]
        const h0 = t.s - 0.5, h1 = t.s + t.len / (1 + K) + 0.5;
        if (h0 < r.s && h1 > r.sPrev) add('moving-train-in-safe-lane', { row: r.s, sPrev: r.sPrev, lane: L, train: t.id, hazard: [h0, h1] });
      } else if (!t.ramp) {
        if (t.s < r.s && t.s + t.len > r.sPrev) add('plain-train-in-safe-lane', { row: r.s, sPrev: r.sPrev, lane: L, train: t.id, span: [t.s, t.s + t.len] });
      }
    }
    // when the safe lane shifts, the player still runs in the old lane right
    // after sPrev: the old lane must not have a plain wall in (sPrev, sPrev + 0.5*gap]
    if (L !== r.prevSafe) {
      const gap = r.s - r.sPrev;
      for (const t of trains[r.prevSafe]) {
        if (t.moving || t.ramp) continue;
        if (t.s > r.sPrev && t.s < r.sPrev + 0.5 * gap) add('old-safe-lane-blocked-early', { row: r.s, lane: r.prevSafe, train: t.id, at: t.s });
      }
    }
  }
  // 2. item placement within a lane
  for (let L = 0; L < 3; L++) {
    const ts = trains[L];
    for (let a = 0; a < ts.length; a++) {
      for (let b = a + 1; b < ts.length; b++) {
        const A = ts[a], B = ts[b];
        if (A.moving || B.moving) continue;
        const a0 = A.s - (A.ramp ? RAMP_L : 0), a1 = A.s + A.len, b0 = B.s - (B.ramp ? RAMP_L : 0), b1 = B.s + B.len;
        if (a0 < b1 && b0 < a1) add('trains-overlap', { lane: L, a: A.id, b: B.id });
      }
    }
    for (const it of lanes[L]) {
      if (it.kind === 'train') continue;
      for (const t of ts) {
        if (t.moving) {
          // parked footprint and the meeting point
          if (it.s > t.s - 1 && it.s < t.s + K * MOVING.R + t.len + 1 && it.kind !== 'coin') add('item-in-moving-train-path', { lane: L, item: it.id, kind: it.kind, s: it.s, train: t.id });
          continue;
        }
        let top = -1;
        if (it.s > t.s && it.s < t.s + t.len) top = TRAIN.height;
        else if (t.ramp && it.s > t.s - RAMP_L && it.s <= t.s) top = ((it.s - (t.s - RAMP_L)) / RAMP_L) * TRAIN.height;
        if (top < 0) continue;
        if (it.kind === 'hurdle' || it.kind === 'overhead') add('barrier-inside-train', { lane: L, item: it.id, kind: it.kind, s: it.s, train: t.id });
        else if (it.y < top) add(`${it.kind}-inside-train`, { lane: L, item: it.id, s: it.s, y: it.y, top, train: t.id });
      }
      if (it.kind === 'coin') {
        // Low coin right after a roof end. A runner following the trail leaves
        // the roof at e + halfD and must be within 0.9 m of the coin with its
        // centre within 1.35 m of the coin height. Optimistic model: fast-fall
        // (down) pressed the instant it leaves the roof, and rolling (lowest
        // centre). If even that cannot get low enough in time the coin cannot
        // be collected from the trail; if only a plain fall cannot, the coin
        // needs a well-timed fast-fall.
        for (const t of ts) {
          if (t.moving) continue;
          const e = t.s + t.len;
          const d = it.s - e;
          if (d < 0 || d > 6 || it.y > TRAIN.height) continue;
          const T = Math.max(0, it.s + 0.9 - (e + PLAYER.halfD)) / speedAt(it.s);
          const dropFast = FAST_FALL_V * T + 0.5 * GRAVITY * T * T;
          const dropPlain = 0.5 * GRAVITY * T * T;
          const needRoll = TRAIN.height - (it.y + 1.35 - PLAYER.rollHeight / 2);
          const needStand = TRAIN.height - (it.y + 1.35 - PLAYER.height / 2);
          const info = { lane: L, item: it.id, s: +it.s.toFixed(2), y: +it.y.toFixed(2), after: +d.toFixed(2), speed: +speedAt(it.s).toFixed(1), train: t.id };
          if (dropFast < needRoll) add('coin-unreachable-from-roof', info);
          else if (dropPlain < needStand) add('coin-needs-fast-fall-off-roof', info);
        }
      }
      if (it.kind === 'coin' || it.kind === 'power') {
        for (const b of lanes[L]) {
          if (b.kind !== 'hurdle' && b.kind !== 'overhead') continue;
          const spec = b.kind === 'hurdle' ? HURDLE : OVERHEAD;
          if (Math.abs(it.s - b.s) < spec.halfD + 0.3 && it.y > spec.y0 - 0.3 && it.y < spec.y1 + 0.3) add(`${it.kind}-touches-${b.kind}`, { lane: L, item: it.id, s: it.s, y: it.y, barrier: b.id });
        }
      }
    }
  }
  // 3. coin ids / NaN
  const ids = new Set();
  for (const it of items) {
    if (ids.has(it.id)) add('duplicate-id', { id: it.id });
    ids.add(it.id);
    for (const k of ['s', 'y', 'len']) if (it[k] !== undefined && !Number.isFinite(it[k])) add('nan', { id: it.id, field: k });
  }
  // duplicated coins (same lane & position)
  const coinKey = new Set();
  for (const it of items) {
    if (it.kind !== 'coin') continue;
    const k = `${it.lane}|${Math.round(it.s * 10)}`;
    if (coinKey.has(k)) add('duplicate-coin', { lane: it.lane, s: it.s, id: it.id });
    coinKey.add(k);
  }
  return { rows: rows.length, items: items.length, issues, moving: items.filter((i) => i.moving).length };
}

// ---------------------------------------------------------------------------
// Layout dump around a track position (for bug reports).
export function describeLayout(sim, from, to, oracle) {
  const lines = [];
  const items = [];
  for (const t of sim.trains) {
    const f = trainFront(t, sim.s);
    if (t.moving ? (t.s < to + 60 && f + t.len > from) : (t.s < to && t.s + t.len > from - (t.ramp ? RAMP_L : 0))) items.push(t);
  }
  for (const b of sim.barriers) if (b.s > from - 1 && b.s < to) items.push(b);
  for (const p of sim.powers) if (p.s > from - 1 && p.s < to) items.push(p);
  items.sort((a, b) => a.s - b.s);
  for (const it of items) {
    if (it.kind === 'train') {
      lines.push(`  train id=${it.id} lane=${it.lane} s=${it.s.toFixed(2)}..${(it.s + it.len).toFixed(2)} cars=${it.cars} ramp=${it.ramp}` +
        (it.moving ? ` MOVING k=${it.k} R=${it.R} (parked front=${(it.s + it.k * it.R).toFixed(2)}, meets player at s=${it.s.toFixed(2)})` : '') +
        (it.ramp ? ` ramp from ${(it.s - RAMP_L).toFixed(2)}` : ''));
    } else if (it.kind === 'power') {
      lines.push(`  power id=${it.id} lane=${it.lane} s=${it.s.toFixed(2)} type=${it.type}`);
    } else {
      lines.push(`  ${it.kind} id=${it.id} lane=${it.lane} s=${it.s.toFixed(2)}`);
    }
  }
  if (oracle) {
    const rows = oracle.rowsBetween(from - 30, to);
    lines.push('  generator rows (s: safe lane): ' + rows.map((r) => `${r.s.toFixed(1)}:${r.safe}${r.safe !== r.prevSafe ? '(shift from ' + r.prevSafe + ')' : ''}`).join(', '));
  }
  return lines.join('\n');
}

export { Sim, LevelGenerator, trainFront, surfaceHeight, hitBarrier, laneX, PLAYER, TRAIN, RAMP_L, HURDLE, OVERHEAD, MOVING };
