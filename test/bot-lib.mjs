// Helpers for test/bot.mjs: sim cloning, state keys, lookahead search, the
// autoplayer policy and layout dumps. Pure test code - it never edits src/.
import { Sim } from '../src/sim.js';
import { LevelGenerator } from '../src/generator.js';
import { trainFront } from '../src/physics.js';
import { laneX, PLAYER, TRAIN, RAMP_L, HURDLE, OVERHEAD, MOVING } from '../src/config.js';

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
export function cloneClone(src) {
  const c = shapeClone(src, Object.getPrototypeOf(src));
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
export function stateKey(c, fine) {
  const q = fine ? 1000 : 1;
  const p = c.power;
  let pk = '';
  for (const k in p) pk += p[k] > 0 ? Math.round(p[k] * (fine ? 60 : 10)) + ',' : '0,';
  if (fine) {
    return `${c.lane}|${Math.round(c.x * q)}|${Math.round(c.y * q)}|${Math.round(c.vy * q)}|${Math.round(c.rollT * 600)}|` +
      `${c.rollQueued ? 1 : 0}|${Math.round(c.jumpBuf * 600)}|${Math.round(c.coyote * 600)}|${c.grounded ? 1 : 0}|` +
      `${Math.round(c.graceT * 60)}|${Math.round(c.stumbleT * 60)}|${Math.round(c.stumbleCool * 60)}|${pk}|${c.powers.length}`;
  }
  return `${c.lane}|${Math.round(c.x * 5)}|${Math.round(c.y * 4)}|${Math.round(c.vy / 2)}|${Math.ceil(c.rollT * 15)}|` +
    `${c.rollQueued ? 1 : 0}|${Math.ceil(c.jumpBuf * 30)}|${c.coyote > 0 ? 1 : 0}|${c.grounded ? 1 : 0}|` +
    `${Math.ceil(c.graceT * 4)}|${c.stumbleT > 0 ? 1 : 0}|${pk}|${c.powers.length}`;
}

// ---------------------------------------------------------------------------
// Safe-lane oracle: a second LevelGenerator with the same seed, instrumented
// (on the instance, not the source) to record the safe lane of every row.
export class SafeLaneOracle {
  constructor(seed) {
    this.gen = new LevelGenerator(seed);
    this.rows = []; // {s, safe, shifted, kinds}
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
    for (let ni = 0; ni < frontier.length; ni++) {
      const node = frontier[ni];
      for (let ai = 0; ai < acts.length; ai++) {
        const a = acts[ai];
        const last = ai === acts.length - 1;
        const c = last ? node.sim : cloneClone(node.sim);
        const coinsBefore = c.coins;
        applyAction(c, a);
        c.step(DT);
        expanded++;
        if (!c.alive) continue;
        let inc = node.inc;
        let pk = node.pk;
        let bad = false;
        const ev = c.events;
        for (let i = 0; i < ev.length; i++) {
          const t = ev[i].type;
          if (t === 'stumble') { if (!allowStumble) bad = true; inc += 1; }
          else if (t === 'boardBreak') { if (!allowBoard) bad = true; inc += 1; }
          else if (t === 'power') pk += 1;
        }
        ev.length = 0;
        if (c.removed.length) c.removed.length = 0;
        if (bad) continue;
        let v = node.v + (a !== A_NONE ? -0.002 : 0) + coinW * (c.coins - coinsBefore) + powerW * (pk - node.pk) - 50 * (inc - node.inc);
        if (reward) v += reward(c);
        const key = stateKey(c, fine);
        const prev = map.get(key);
        if (prev && prev.v >= v) continue;
        const nn = { sim: c, path: { a, prev: node.path }, v, inc, pk };
        map.set(key, nn);
        if (goal && goal(c, nn)) return finish(nn, f + 1, true);
      }
    }
    if (!map.size) break;
    let next = Array.from(map.values());
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
  return finish(best, depth, depth === H);

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
    this.horizon = opt.horizon || 120;
    this.every = opt.every || 4;
    this.beam = opt.beam || 60;
    this.resync = opt.resync || 30;
    this.powers = opt.powers || 'avoid'; // avoid | ignore | seek
    this.coins = !!opt.coins;
    this.oracle = opt.oracle || null;
    this.plan = [];
    this.tail = null;
    this.sinceSync = Infinity;
    this.stats = { replans: 0, level: {}, predictedDeath: 0, expanded: 0, peak: 0 };
  }

  window() { return 30 + this.horizon * (32 / 60) + 20; }

  _opts() {
    const oracle = this.oracle;
    const H = this.horizon;
    const reward = (c) => {
      let v = -0.004 * Math.abs(c.x) / H * 60; // mild centre preference: more escape options
      if (oracle) v -= (0.05 * Math.abs(c.x - laneX(oracle.safeAt(c.s + 6)))) / H * 60;
      return v;
    };
    return {
      horizon: H, every: this.every, beam: this.beam, reward,
      coinWeight: this.coins ? 0.5 : 0,
      powerWeight: this.powers === 'seek' ? 30 : this.powers === 'avoid' ? -30 : 0,
    };
  }

  _verifyFrom(sim) {
    const c = cloneSim(sim, { window: this.window(), coins: this.coins });
    for (let i = 0; i < this.plan.length; i++) {
      applyAction(c, this.plan[i]);
      c.step(DT);
      c.removed.length = 0;
      if (!c.alive || badEvents(c, this.powers)) return null;
    }
    return c;
  }

  _replan(sim) {
    this.stats.replans++;
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
    if (!r.ok) { this.stats.predictedDeath++; r = best; }
    this.plan = r.plan.slice();
    while (this.plan.length < this.horizon) this.plan.push(A_NONE);
    this.tail = r.ok ? r.end : null;
    this.lastSearch = r;
    this.sinceSync = 0;
  }

  // Returns the input for this frame.
  act(sim) {
    if (!this.tail || this.sinceSync >= this.resync) {
      while (this.plan.length < this.horizon) this.plan.push(A_NONE);
      const end = this._verifyFrom(sim);
      if (end) { this.tail = end; this.sinceSync = 0; } else this._replan(sim);
    }
    this.sinceSync++;
    const a = this.plan.shift();
    this.plan.push(A_NONE);
    if (this.tail) {
      this.tail.step(DT);
      this.tail.removed.length = 0;
      if (!this.tail.alive || badEvents(this.tail, this.powers)) this.tail = null; // replan next frame
    }
    return a;
  }
}

// Events that invalidate a plan: incidents, and (when avoiding power-ups) a
// pickup the plan did not intend.
function badEvents(c, powers) {
  const ev = c.events;
  let bad = false;
  for (let i = 0; i < ev.length; i++) {
    const t = ev[i].type;
    if (t === 'stumble' || t === 'boardBreak') bad = true;
  }
  ev.length = 0;
  return bad;
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

export { Sim, trainFront, laneX, PLAYER, TRAIN, RAMP_L, HURDLE, OVERHEAD, MOVING };
