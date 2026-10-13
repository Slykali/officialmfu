#!/usr/bin/env node
// Autoplayer + verification harness for the headless simulation (src/sim.js).
//
// Usage (suggested package.json script:  "test": "node test/bot.mjs"):
//
//   node test/bot.mjs                      quick run: 24 seeds x 2 variants to s=6000
//   node test/bot.mjs --full               300 seeds x {safe, seek} to s=6000, plus
//                                          blind/coins/jetstress variants on subsets
//   node test/bot.mjs --seeds 1-50 --dist 4000 --variants safe,seek --workers 4
//   node test/bot.mjs --seed 17 --variants seek --verbose     one seed, chatty
//   node test/bot.mjs --json out.json      also write all per-run results as JSON
//
// Variants
//   safe       bot avoids power-ups; mild preference for the generator's "safe lane"
//   seek       bot goes out of its way to collect every power-up
//   blind      no safe-lane hint at all (pure lookahead), power-ups ignored
//   coins      coin-greedy bot; every missed coin is re-checked by a targeted
//              search to decide whether it was reachable at all
//   jetstress  like seek, but the harness also force-activates a jetpack every
//              ~25 s (via Sim._activate) to test landings at random places
//
// The bot only uses the public inputs left/right/jump/down, at most one per
// 1/60 s frame, and steps the sim with step(1/60). It plans with lookahead
// clones of the sim (see test/bot-lib.mjs). Every death, stumble and board
// break is re-examined by an exhaustive search from checkpoints 3, 6 and 10 s
// earlier; a death that no search can avoid is reported as a GAME BUG together
// with the obstacle layout. Exit code is 1 if any bug or sanity failure was
// found, 0 otherwise.
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Snapshot the gameplay sources once (main thread) so every worker tests
// exactly the same code, even if src/ is edited while the run is in progress.
const GAMEPLAY_FILES = ['config.js', 'physics.js', 'generator.js', 'sim.js'];
if (isMainThread && !process.env.BOT_SRC_DIR && !process.argv.includes('--live-src')) {
  const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
  const h = createHash('md5');
  const bufs = GAMEPLAY_FILES.map((f) => fs.readFileSync(path.join(srcDir, f)));
  for (const b of bufs) h.update(b);
  const dir = path.join(os.tmpdir(), `subway-bot-src-${h.digest('hex').slice(0, 10)}`);
  fs.mkdirSync(dir, { recursive: true });
  GAMEPLAY_FILES.forEach((f, i) => fs.writeFileSync(path.join(dir, f), bufs[i]));
  process.env.BOT_SRC_DIR = dir;
}
const {
  Sim, Bot, SafeLaneOracle, applyAction, DT, ACTION_NAMES, describeLayout, checkpoint, judge,
  itemFingerprint, search, rootFromCheckpoint, laneX, PLAYER, TRAIN, RAMP_L, HURDLE, OVERHEAD, trainFront,
  surfaceHeight, hitBarrier, SRC_URL, cloneSim,
} = await import('./bot-lib.mjs');

const SELF = fileURLToPath(import.meta.url);

// ---------------------------------------------------------------------------
// argument parsing
function parseArgs(argv) {
  const o = {
    seeds: null, dist: 6000, variants: null, workers: Math.max(1, os.cpus().length), full: false,
    verbose: false, json: null, judge: true, maxMissedCoinChecks: 25,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--seeds') o.seeds = parseSeeds(next());
    else if (a === '--seed') o.seeds = [Number(next())];
    else if (a === '--dist') o.dist = Number(next());
    else if (a === '--variants') o.variants = next().split(',');
    else if (a === '--workers') o.workers = Number(next());
    else if (a === '--full') o.full = true;
    else if (a === '--verbose') o.verbose = true;
    else if (a === '--json') o.json = next();
    else if (a === '--no-judge') o.judge = false;
    else if (a === '--live-src') { /* import ../src directly instead of a snapshot */ }
    else if (a === '--selftest') o.selftest = true;
    else if (a === '--help' || a === '-h') { console.log(fs.readFileSync(SELF, 'utf8').split('\n').slice(1, 30).join('\n')); process.exit(0); }
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

function parseSeeds(str) {
  const out = [];
  for (const part of str.split(',')) {
    const m = part.match(/^(\d+)-(\d+)$/);
    if (m) for (let i = Number(m[1]); i <= Number(m[2]); i++) out.push(i);
    else out.push(Number(part));
  }
  return out;
}

function buildJobs(o) {
  const jobs = [];
  if (o.seeds || o.variants) {
    const seeds = o.seeds || range(1, 24);
    const variants = o.variants || ['safe', 'seek'];
    for (const v of variants) for (const s of seeds) jobs.push({ seed: s, variant: v, dist: o.dist });
    return jobs;
  }
  if (o.full) {
    for (const s of range(1, 300)) jobs.push({ seed: s, variant: 'safe', dist: o.dist });
    for (const s of range(1001, 1300)) jobs.push({ seed: s, variant: 'seek', dist: o.dist });
    for (const s of range(2001, 2060)) jobs.push({ seed: s, variant: 'blind', dist: o.dist });
    for (const s of range(3001, 3040)) jobs.push({ seed: s, variant: 'jetstress', dist: o.dist });
    for (const s of range(4001, 4012)) jobs.push({ seed: s, variant: 'coins', dist: 3000 });
    return jobs;
  }
  for (const s of range(1, 24)) jobs.push({ seed: s, variant: 'safe', dist: o.dist });
  for (const s of range(1001, 1024)) jobs.push({ seed: s, variant: 'seek', dist: o.dist });
  return jobs;
}

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

// ---------------------------------------------------------------------------
// one run
const NUM_FIELDS = ['time', 's', 'x', 'y', 'vy', 'coyote', 'rollT', 'jumpBuf', 'stumbleT', 'stumbleCool', 'graceT', 'coins', 'score'];

function variantBot(variant, oracle) {
  switch (variant) {
    case 'safe': return new Bot({ oracle, powers: 'avoid' });
    case 'seek': return new Bot({ oracle, powers: 'seek' });
    case 'jetstress': return new Bot({ oracle, powers: 'seek' });
    case 'blind': return new Bot({ oracle: null, powers: 'ignore', horizon: 180 });
    case 'coins': return new Bot({ oracle, powers: 'avoid', coins: true });
    default: throw new Error(`unknown variant ${variant}`);
  }
}

export function runOne(job, log = () => {}) {
  const { seed, variant, dist } = job;
  const sim = new Sim(seed);
  const oracle = new SafeLaneOracle(seed);
  const bot = variantBot(variant, oracle);
  const t0 = Date.now();
  const actions = [];
  const cps = [];
  const R = {
    seed, variant, dist, alive: true, s: 0, frames: 0, deathCause: null, deathFrame: null, ms: 0,
    deaths: [], incidents: [], bugs: [], anomalies: [], powers: {}, powerEnds: {}, jetLandings: 0,
    maxLen: { trains: 0, barriers: 0, coinItems: 0, powers: 0, recentTrains: 0 }, lenAt: {},
    events: {}, landPairsClose: 0, multiEventFrames: {}, coinsMissed: [], coinsUnreachable: [], coinGeo: [],
    powerGeo: [], movingOverlaps: [], placement: [], powersMissed: [], coinsSeen: 0, coinsTaken: 0,
    bot: null, offSafeFrames: 0,
  };
  const anomaly = (type, info) => {
    if (R.anomalies.filter((a) => a.type === type).length < 5) R.anomalies.push({ type, frame: R.frames, s: +sim.s.toFixed(3), ...info });
    else R.anomalies.find((a) => a.type === type).count = (R.anomalies.find((a) => a.type === type).count || 5) + 1;
  };

  let prevScore = 0;
  let prevCoins = 0;
  let prevS = 0;
  let lastLandFrame = -1000;
  let lastJumpFrame = -1000;
  let nextJet = 25 * 60;
  const seenIds = new Set();
  const passed = new Set();
  let coinChecks = 0;
  const pendingIncidents = [];
  const liveTrains = new Map(); // id -> train (for placement checks)
  let fingerprintChecks = 0;

  const placementCheck = (it) => {
    for (const k of ['s', 'lane', 'y', 'len', 'k', 'R']) {
      if (it[k] !== undefined && !Number.isFinite(it[k])) anomaly('item-nan', { id: it.id, kind: it.kind, field: k, value: String(it[k]) });
    }
    if (seenIds.has(it.id)) anomaly('duplicate-id', { id: it.id, kind: it.kind });
    seenIds.add(it.id);
    if (it.kind === 'train') {
      // overlapping trains in the same lane (static footprint incl. ramp)
      for (const t of sim.trains) {
        if (t === it || t.lane !== it.lane || t.moving || it.moving) continue;
        const a0 = it.s - (it.ramp ? RAMP_L : 0), a1 = it.s + it.len;
        const b0 = t.s - (t.ramp ? RAMP_L : 0), b1 = t.s + t.len;
        if (a0 < b1 && b0 < a1) anomaly('train-overlap', { a: it.id, b: t.id, lane: it.lane, a0, a1, b0, b1 });
      }
    }
    if (it.kind === 'coin' || it.kind === 'power' || it.kind === 'hurdle' || it.kind === 'overhead') {
      // inside a static train / ramp of the same lane?
      for (const t of sim.trains) {
        if (t.moving || t.lane !== it.lane) continue;
        const y = it.y ?? 0.5;
        let top = -1;
        if (it.s > t.s && it.s < t.s + t.len) top = TRAIN.height;
        else if (t.ramp && it.s > t.s - RAMP_L && it.s <= t.s) top = ((it.s - (t.s - RAMP_L)) / RAMP_L) * TRAIN.height;
        if (top < 0) continue;
        if (it.kind === 'hurdle' || it.kind === 'overhead') anomaly('barrier-on-train', { id: it.id, kind: it.kind, lane: it.lane, s: it.s, train: t.id });
        else if (y < top + 0.25) {
          const rec = { id: it.id, kind: it.kind, lane: it.lane, s: +it.s.toFixed(2), y: +y.toFixed(2), train: t.id, surface: +top.toFixed(2) };
          (it.kind === 'coin' ? R.coinGeo : R.powerGeo).push({ why: y < top ? 'inside-train' : 'touching-train-surface', ...rec });
        }
      }
      if (it.kind === 'coin' || it.kind === 'power') {
        for (const b of sim.barriers) {
          if (b.lane !== it.lane) continue;
          const spec = b.kind === 'hurdle' ? HURDLE : OVERHEAD;
          const r = it.kind === 'coin' ? 0.35 : 0.5; // rough visual radius
          if (Math.abs(it.s - b.s) < spec.halfD + r && it.y > spec.y0 - r && it.y < spec.y1 + r) {
            (it.kind === 'coin' ? R.coinGeo : R.powerGeo).push({ why: `overlaps-${b.kind}`, id: it.id, lane: it.lane, s: +it.s.toFixed(2), y: +it.y.toFixed(2), barrier: b.id });
          }
        }
      }
    }
  };

  const checkAdded = () => {
    // trains first so coins generated in the same batch see them
    const add = sim.added;
    for (const it of add) if (it.kind === 'train') placementCheck(it);
    for (const it of add) if (it.kind !== 'train') placementCheck(it);
    sim.added.length = 0;
    sim.removed.length = 0;
  };
  checkAdded();

  let safeFrames = 0;
  while (sim.alive && sim.s < dist) {
    const frame = R.frames;
    if (frame % 30 === 0) {
      cps.push(checkpoint(sim, frame));
      if (cps.length > 26) cps.shift();
    }
    if (variant === 'jetstress' && frame >= nextJet && sim.power.jetpack <= 0 && sim.graceT <= 0) {
      sim._activate('jetpack'); // synthetic: same code path as a pickup
      nextJet = frame + 25 * 60;
      bot.tail = null; // world changed outside the bot's model
    }
    const fpBefore = (frame % 97 === 0) ? itemFingerprint(sim) : null;
    const a = bot.act(sim);
    if (fpBefore !== null) {
      fingerprintChecks++;
      if (itemFingerprint(sim) !== fpBefore) anomaly('lookahead-mutated-real-sim', {});
    }
    actions.push(a);
    const wasGrounded = sim.grounded;
    const prevMult = sim.multiplier;
    applyAction(sim, a);
    sim.step(DT);
    R.frames++;
    const ev = sim.takeEvents();

    // ---- events
    const per = {};
    for (const e of ev) {
      R.events[e.type] = (R.events[e.type] || 0) + 1;
      per[e.type] = (per[e.type] || 0) + 1;
      if (e.type === 'power') R.powers[e.power] = (R.powers[e.power] || 0) + 1;
      if (e.type === 'powerEnd') {
        R.powerEnds[e.power] = (R.powerEnds[e.power] || 0) + 1;
        if (e.power === 'jetpack') R.jetLandings++;
      }
      if (e.type === 'land') {
        if (R.frames - lastLandFrame <= 6 && lastJumpFrame < lastLandFrame) R.landPairsClose++;
        lastLandFrame = R.frames;
      }
      if (e.type === 'jump') lastJumpFrame = R.frames;
      if (e.type === 'stumble' || e.type === 'boardBreak') {
        const inc = { type: e.type, frame: R.frames, s: +sim.s.toFixed(2), lane: sim.lane, x: +sim.x.toFixed(2), y: +sim.y.toFixed(2) };
        R.incidents.push(inc);
        pendingIncidents.push({ inc, cps: cps.slice(), due: R.frames + 2 });
      }
    }
    for (const k in per) if (per[k] > 1 && k !== 'coin') R.multiEventFrames[k] = (R.multiEventFrames[k] || 0) + 1;
    if (per.land && wasGrounded && !per.jump) anomaly('land-while-grounded', { y: sim.y });

    // ---- numeric sanity
    for (const k of NUM_FIELDS) if (!Number.isFinite(sim[k])) anomaly('nan', { field: k, value: String(sim[k]) });
    for (const k in sim.power) if (!Number.isFinite(sim.power[k]) || sim.power[k] < 0) anomaly('nan-power', { field: k, value: String(sim.power[k]) });
    if (sim.lane < 0 || sim.lane > 2 || !Number.isInteger(sim.lane)) anomaly('bad-lane', { lane: sim.lane });
    if (sim.x < laneX(0) - 1e-9 || sim.x > laneX(2) + 1e-9) anomaly('x-out-of-track', { x: sim.x });

    // ---- score / coins
    const dCoins = sim.coins - prevCoins;
    if (dCoins !== (per.coin || 0)) anomaly('coin-count-mismatch', { dCoins, events: per.coin || 0 });
    const m = sim.multiplier;
    if (sim.score < prevScore) anomaly('score-decreased', { prev: prevScore, now: sim.score });
    if (m === prevMult && !per.power) {
      const expect = (sim.s - prevS) * m + 10 * m * dCoins;
      if (Math.abs(sim.score - prevScore - expect) > 1e-6 * Math.max(1, sim.score)) anomaly('score-delta', { got: sim.score - prevScore, expect });
    }
    R.coinsTaken += dCoins;
    prevScore = sim.score; prevCoins = sim.coins; prevS = sim.s;

    if (sim.alive) {
      // ---- player inside a train volume?
      const surf = surfaceHeight(sim.trains, sim.x, sim.s, PLAYER.halfW, PLAYER.halfD, sim.s);
      if (sim.y < surf - 1e-6) anomaly('inside-train', { x: sim.x, y: sim.y, surface: surf, grace: sim.graceT, flying: sim.flying });
      // ---- overlapping a barrier without dying (outside grace/flight)
      if (sim.graceT <= 0 && !sim.flying) {
        const b = hitBarrier(sim.barriers, sim.x, sim.s, sim.y, sim.height, PLAYER.halfW, PLAYER.halfD);
        if (b && !b.smashed) anomaly('inside-barrier-alive', { id: b.id, kind: b.kind });
      }
      if (sim.grounded && sim.y > 0 && Math.abs(sim.y - surf) > 1e-6) anomaly('grounded-floating', { y: sim.y, surface: surf });
    }

    // ---- moving trains sweeping through other items ahead of the player
    for (const t of sim.trains) {
      if (!t.moving) continue;
      const f = trainFront(t, sim.s);
      if (f > sim.s + 120) continue;
      for (const o of sim.trains) {
        if (o === t || o.lane !== t.lane) continue;
        const of = trainFront(o, sim.s);
        const o0 = of - (o.ramp ? RAMP_L : 0);
        if (f < of + o.len && o0 < f + t.len && Math.max(f, o0) > sim.s - 8) {
          if (R.movingOverlaps.length < 20) R.movingOverlaps.push({ frame: R.frames, s: +sim.s.toFixed(1), moving: t.id, other: o.id, kind: 'train', lane: t.lane, at: +Math.max(f, o0).toFixed(1) });
        }
      }
      for (const o of sim.barriers) {
        if (o.lane === t.lane && o.s > f && o.s < f + t.len && o.s > sim.s - 8 && R.movingOverlaps.length < 20) {
          R.movingOverlaps.push({ frame: R.frames, s: +sim.s.toFixed(1), moving: t.id, other: o.id, kind: o.kind, lane: t.lane, at: +o.s.toFixed(1) });
        }
      }
      for (const o of sim.coinItems) {
        if (o.lane === t.lane && o.s > f && o.s < f + t.len && o.y < TRAIN.height && o.s > sim.s - 8 && R.movingOverlaps.length < 20) {
          R.movingOverlaps.push({ frame: R.frames, s: +sim.s.toFixed(1), moving: t.id, other: o.id, kind: 'coin', lane: t.lane, at: +o.s.toFixed(1) });
        }
      }
    }

    // ---- array sizes
    R.maxLen.trains = Math.max(R.maxLen.trains, sim.trains.length);
    R.maxLen.barriers = Math.max(R.maxLen.barriers, sim.barriers.length);
    R.maxLen.coinItems = Math.max(R.maxLen.coinItems, sim.coinItems.length);
    R.maxLen.powers = Math.max(R.maxLen.powers, sim.powers.length);
    R.maxLen.recentTrains = Math.max(R.maxLen.recentTrains, sim.gen.recentTrains ? sim.gen.recentTrains.length : 0);
    if (R.frames % 600 === 0) {
      let stale = 0;
      for (const t of sim.trains) if (trainFront(t, sim.s) + t.len < sim.s - 40) stale++;
      for (const b of sim.barriers) if (b.s < sim.s - 40) stale++;
      for (const c of sim.coinItems) if (c.s < sim.s - 60) stale++;
      for (const p of sim.powers) if (p.s < sim.s - 60) stale++;
      if (stale) anomaly('stale-items', { stale });
      R.lenAt[Math.round(sim.s)] = sim.trains.length + sim.barriers.length + sim.coinItems.length + sim.powers.length;
    }

    // ---- coins / powers passed without pickup
    if (variant === 'coins') {
      for (const c of sim.coinItems) {
        if (passed.has(c.id) || c.s >= sim.s - 1.5) continue;
        passed.add(c.id);
        if (c.id < 0) continue; // jetpack sky coins
        const miss = { id: c.id, lane: c.lane, s: c.s, y: c.y, frame: R.frames };
        R.coinsMissed.push(miss);
        if (coinChecks < (workerData?.maxMissedCoinChecks ?? 25)) {
          coinChecks++;
          const res = coinReachable(job, cps, miss);
          miss.reachable = res.ok;
          miss.how = res.how;
          if (!res.ok) R.coinsUnreachable.push({ ...miss, context: res.context });
        }
      }
    }
    if (variant === 'seek' || variant === 'jetstress') {
      for (const p of sim.powers) {
        if (!passed.has(p.id) && p.s < sim.s - 1.5) { passed.add(p.id); R.powersMissed.push({ id: p.id, lane: p.lane, s: p.s, type: p.type, frame: R.frames }); }
      }
    }
    if (oracle && Math.abs(sim.x - laneX(oracle.safeAt(sim.s + 6))) > 0.5) R.offSafeFrames++;
    safeFrames++;

    checkAdded();
    // incidents are judged two frames later (so a crash in the same moment counts as the death)
    while (pendingIncidents.length && pendingIncidents[0].due <= R.frames) {
      const { inc, cps: cpsAt } = pendingIncidents.shift();
      if (!sim.alive) break;
      judgeIncident(job, inc, cpsAt, oracle, R);
    }
  }
  R.alive = sim.alive;
  R.s = +sim.s.toFixed(2);
  R.deathCause = sim.deathCause;
  R.score = Math.round(sim.score);
  R.coins = sim.coins;
  R.bot = bot.stats;
  R.fingerprintChecks = fingerprintChecks;

  // ---------------------------------------------------------------- analysis
  if (!sim.alive) {
    R.deathFrame = R.frames;
    const d = analyseFailure(job, cps, R.frames, sim, oracle, { strict: false });
    d.cause = sim.deathCause;
    d.lane = sim.lane; d.x = +sim.x.toFixed(2); d.y = +sim.y.toFixed(2);
    d.actionsTail = rle(actions.slice(-240));
    R.deaths.push(d);
    if (d.verdict === 'UNAVOIDABLE') R.bugs.push({ kind: 'unavoidable-death', ...d });
  }
  R.coinsMissedChecked = coinChecks;
  R.ms = Date.now() - t0;
  if (!sim.alive) R.actionsB64 = Buffer.from(Uint8Array.from(actions)).toString('base64');
  return R;
}

function judgeIncident(job, inc, cpsAt, oracle, R) {
  const cpsHere = cpsAt.filter((c) => c.frame <= inc.frame - 30);
  if (!cpsHere.length || R.incidents.indexOf(inc) >= 6) { inc.verdict = 'not-checked'; return; }
  const r = analyseFailure(job, cpsHere, inc.frame, null, oracle, { strict: true, extra: 60, s: inc.s });
  inc.verdict = r.verdict === 'UNAVOIDABLE' ? 'UNAVOIDABLE-without-incident' : 'avoidable (bot weakness)';
  inc.judge = r.tries;
  if (r.verdict === 'UNAVOIDABLE') { inc.layout = r.layout; R.bugs.push({ kind: 'forced-incident', ...inc }); }
}

function rle(arr) {
  const out = [];
  for (let i = 0; i < arr.length;) {
    let j = i;
    while (j < arr.length && arr[j] === arr[i]) j++;
    out.push(`${ACTION_NAMES[arr[i]]}x${j - i}`);
    i = j;
  }
  return out.join(' ');
}

// Try exhaustive survival searches from checkpoints ~3, 6 and 10 s before `frame`.
function analyseFailure(job, cps, frame, sim, oracle, opt) {
  const tries = [];
  const pick = (secs) => {
    const want = frame - secs * 60;
    let best = null;
    for (const c of cps) if (c.frame <= want && (!best || c.frame > best.frame)) best = c;
    return best || cps[0];
  };
  const extra = opt.extra ?? 90;
  let verdict = 'UNAVOIDABLE';
  const used = new Set();
  for (const secs of [3, 6, 10]) {
    const cp = pick(secs);
    if (!cp || used.has(cp.frame)) continue;
    used.add(cp.frame);
    const r = judge(cp, job.seed, frame + extra, { strict: opt.strict, beam: 30000 });
    tries.push({ fromFrame: cp.frame, fromS: +cp.s.toFixed(2), secondsBefore: +((frame - cp.frame) / 60).toFixed(2), survived: r.ok, depth: r.depth, horizon: r.horizon, peak: r.peak, truncated: r.truncated, ms: r.ms });
    if (r.ok) { verdict = 'avoidable (bot weakness)'; break; }
  }
  const deathS = sim ? sim.s : opt.s;
  let layout = null;
  if (verdict === 'UNAVOIDABLE') {
    const root = rootFromCheckpoint(cps[0], job.seed, deathS + 100);
    layout = describeLayout(root, deathS - 90, deathS + 40, oracle);
  }
  return { verdict, tries, layout, frame, s: +deathS.toFixed(2) };
}

// Is coin c collectable by some survivable path? Search from the latest
// checkpoint that is >= ~1.5 s before the player reached the coin.
function coinReachable(job, cps, c) {
  const framesToCoin = (cpFrame) => c.frame - cpFrame;
  let cp = null;
  for (const k of cps) if (c.frame - k.frame >= 90 && (!cp || k.frame > cp.frame)) cp = k;
  if (!cp) return { ok: true, how: 'no-checkpoint' };
  const root = rootFromCheckpoint(cp, job.seed, c.s + 120);
  const id = c.id;
  if (!root.coinItems.some((k) => k.id === id)) return { ok: true, how: 'already-gone-at-checkpoint' };
  const H = framesToCoin(cp.frame) + 10;
  const r = search(root, {
    horizon: H, every: 1, beam: 4000, allowStumble: true, allowBoard: true,
    goal: (s) => { for (const k of s.coinItems) if (k.id === id) return false; return true; },
  });
  if (!r.ok || !r.end) return { ok: false, context: coinContext(root, c) };
  // must also be able to live on for a second afterwards
  const after = search(r.end, { horizon: 60, every: 2, beam: 2000, allowStumble: true, allowBoard: true });
  if (!after.ok) return { ok: false, context: coinContext(root, c) + ' (collectable only on a fatal path)' };
  return { ok: true, how: 'search' };
}

function coinContext(root, c) {
  const parts = [];
  for (const t of root.trains) {
    if (t.lane !== c.lane || t.moving) continue;
    const end = t.s + t.len;
    if (c.s >= end - 1 && c.s - end < 12) parts.push(`${(c.s - end).toFixed(2)} after end of train ${t.id} (roof 3.6)`);
    if (c.s > t.s - RAMP_L - 1 && c.s < t.s + 1 && t.ramp) parts.push(`at ramp foot/top of train ${t.id}`);
  }
  for (const b of root.barriers) if (b.lane === c.lane && Math.abs(b.s - c.s) < 6) parts.push(`${(c.s - b.s).toFixed(2)} from ${b.kind} ${b.id}`);
  return `coin y=${c.y.toFixed(2)}; ` + (parts.join('; ') || 'no nearby obstacle');
}

// ---------------------------------------------------------------------------
// physics frame-rate probe (pure function of dt)
function frameRateProbe() {
  const out = [];
  for (const dt of [1 / 30, 1 / 60, 1 / 120, 1 / 144, 0.05]) {
    const sim = new Sim(1);
    // keep away from obstacles: use the initial straight (first row at s=70)
    sim.jump();
    let apex = 0, t = 0, landed = null, s0 = sim.s;
    for (let i = 0; i < 200 && sim.alive; i++) {
      sim.step(dt);
      t += dt;
      apex = Math.max(apex, sim.y);
      if (landed === null && i > 0 && sim.grounded) { landed = t; break; }
    }
    out.push({ dt: +dt.toFixed(4), apex: +apex.toFixed(4), airtime: landed && +landed.toFixed(4), dist: +(sim.s - s0).toFixed(3) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Self-test of the harness itself: the judge must call a careless death
// avoidable and a wall across all three lanes unavoidable, and lookahead must
// never mutate the real sim.
function selftest() {
  let pass = true;
  const say = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'} ${msg}`); if (!ok) pass = false; };
  // 1. careless random player dies; the judge must find it avoidable
  {
    const seed = 7;
    const sim = new Sim(seed);
    const cps = [];
    let rnd = 12345;
    const rand = () => ((rnd = (Math.imul(rnd, 1103515245) + 12345) >>> 0) / 4294967296);
    let f = 0;
    while (sim.alive && f < 20000) {
      if (f % 30 === 0) cps.push(checkpoint(sim, f));
      if (rand() < 0.04) applyAction(sim, 1 + Math.floor(rand() * 4));
      sim.step(DT); sim.takeEvents(); sim.added.length = 0; sim.removed.length = 0; f++;
    }
    const d = analyseFailure({ seed }, cps.slice(-26), f, sim, null, { strict: false });
    say(!sim.alive && d.verdict.startsWith('avoidable'), `random player died at s=${sim.s.toFixed(1)} (${sim.deathCause}); judge: ${d.verdict} ${JSON.stringify(d.tries.map((t) => [t.secondsBefore, t.survived]))}`);
  }
  // 2. an injected wall of plain trains across all lanes must be unavoidable
  {
    const seed = 1;
    const sim = new Sim(seed);
    for (let i = 0; i < 60; i++) { sim.step(DT); sim.takeEvents(); }
    const cp = checkpoint(sim, 60);
    const wallS = sim.s + 45;
    for (let lane = 0; lane < 3; lane++) cp.sim.trains.push({ kind: 'train', id: 900000 + lane, lane, s: wallS, cars: 2, len: 28, ramp: false, moving: false, k: 0, R: 0, livery: 0 });
    const framesToWall = Math.ceil(((wallS - sim.s) / sim.speed) * 60) + 60;
    const r = judge(cp, seed, 60 + framesToWall, { beam: 30000 });
    say(!r.ok, `wall across all lanes at s=${wallS.toFixed(1)}: judge survived=${r.ok} depth=${r.depth}/${r.horizon} peak=${r.peak}`);
    // ... and the same wall with a ramp in lane 2 must be survivable
    cp.sim.trains[cp.sim.trains.length - 1].ramp = true;
    const r2 = judge(cp, seed, 60 + framesToWall, { beam: 30000 });
    say(r2.ok, `same wall but lane 2 has a ramp: judge survived=${r2.ok}`);
  }
  // 3. lookahead with board + magnet never mutates the real sim
  {
    const sim = new Sim(3);
    for (let i = 0; i < 200; i++) { sim.step(DT); sim.takeEvents(); }
    sim.power.board = 30; sim.power.magnet = 12;
    const fp = itemFingerprint(sim);
    const root = cloneSim(sim, { coins: true });
    search(root, { horizon: 150, every: 2, beam: 300 });
    for (let k = 0; k < 20; k++) { const c = cloneSim(sim, { coins: true }); for (let i = 0; i < 300 && c.alive; i++) { applyAction(c, (i * 7 + k) % 5); c.step(DT); } }
    say(itemFingerprint(sim) === fp, 'lookahead clones (board+magnet held) left the real sim untouched');
  }
  return pass;
}

// ---------------------------------------------------------------------------
// worker / main
if (!isMainThread) {
  parentPort.on('message', (job) => {
    if (job === null) { process.exit(0); }
    let r;
    try {
      r = runOne(job);
    } catch (e) {
      r = { seed: job.seed, variant: job.variant, error: String(e && e.stack || e) };
    }
    parentPort.postMessage(r);
  });
} else if (process.argv[1] === SELF) {
  main();
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.selftest) process.exit(selftest() ? 0 : 1);
  const jobs = buildJobs(o);
  const t0 = Date.now();
  const md5 = await srcFingerprint();
  console.log(`bot: ${jobs.length} runs, ${o.workers} workers, src ${md5}`);
  const results = [];
  let next = 0;
  await new Promise((resolve) => {
    let live = 0;
    const spawn = () => {
      const w = new Worker(SELF, { workerData: { maxMissedCoinChecks: o.maxMissedCoinChecks } });
      live++;
      const feed = () => {
        if (next < jobs.length) w.postMessage(jobs[next++]);
        else { w.postMessage(null); }
      };
      w.on('message', (r) => {
        results.push(r);
        const tag = r.error ? 'ERROR' : r.alive ? 'ok  ' : 'DEAD';
        if (o.verbose || !r.alive || r.error || (r.bugs && r.bugs.length) || (r.anomalies && r.anomalies.length)) {
          console.log(`${tag} ${r.variant} seed=${r.seed} s=${r.s} ${(r.ms / 1000).toFixed(1)}s ${r.deathCause || ''} ` +
            `${r.deaths && r.deaths[0] ? r.deaths[0].verdict : ''} anomalies=${r.anomalies ? r.anomalies.length : '?'} ${r.error ? r.error.split('\n')[0] : ''}`);
        }
        if (results.length % 20 === 0) console.log(`  ... ${results.length}/${jobs.length} done (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
        feed();
      });
      w.on('error', (e) => { console.error('worker error', e); });
      w.on('exit', () => { live--; if (live === 0) resolve(); });
      feed();
    };
    for (let i = 0; i < Math.min(o.workers, jobs.length); i++) spawn();
  });
  const summary = report(results, o, Date.now() - t0);
  if (o.json) fs.writeFileSync(o.json, JSON.stringify({ src: md5, results, summary }, null, 1));
  process.exit(summary.failed ? 1 : 0);
}

async function srcFingerprint() {
  const h = createHash('md5');
  for (const f of GAMEPLAY_FILES) h.update(fs.readFileSync(new URL(f, SRC_URL)));
  return `${h.digest('hex').slice(0, 10)} (${fileURLToPath(SRC_URL)})`;
}

function report(results, o, ms) {
  const by = {};
  for (const r of results) (by[r.variant] ||= []).push(r);
  let failed = false;
  console.log('\n================ summary ================');
  console.log(`wall time ${(ms / 1000).toFixed(0)} s`);
  for (const [v, rs] of Object.entries(by)) {
    const errs = rs.filter((r) => r.error);
    const ok = rs.filter((r) => !r.error);
    const dead = ok.filter((r) => !r.alive);
    const dist = ok.reduce((a, r) => a + r.s, 0);
    const pw = {};
    for (const r of ok) for (const k in r.powers) pw[k] = (pw[k] || 0) + r.powers[k];
    const jet = ok.reduce((a, r) => a + r.jetLandings, 0);
    const inc = ok.reduce((a, r) => a + r.incidents.length, 0);
    console.log(`\n[${v}] runs=${rs.length} errors=${errs.length} deaths=${dead.length} total distance=${dist.toFixed(0)} ` +
      `min/max s=${Math.min(...ok.map((r) => r.s)).toFixed(0)}/${Math.max(...ok.map((r) => r.s)).toFixed(0)}`);
    console.log(`  power pickups ${JSON.stringify(pw)} jetpack landings=${jet} incidents(stumble/board)=${inc}`);
    const offSafe = ok.reduce((a, r) => a + r.offSafeFrames, 0), frames = ok.reduce((a, r) => a + r.frames, 0);
    console.log(`  frames=${frames} off-safe-lane=${(100 * offSafe / Math.max(1, frames)).toFixed(1)}% replans=${ok.reduce((a, r) => a + r.bot.replans, 0)} predictedDeaths=${ok.reduce((a, r) => a + r.bot.predictedDeath, 0)}`);
    for (const r of dead) {
      const d = r.deaths[0];
      console.log(`  DEATH seed=${r.seed} frame=${r.deathFrame} s=${r.s} cause=${r.deathCause} -> ${d.verdict}`);
      for (const t of d.tries) console.log(`      judge from ${t.secondsBefore}s before (s=${t.fromS}): survived=${t.survived} depth=${t.depth}/${t.horizon} peak=${t.peak}${t.truncated ? ' (beam-truncated)' : ''} ${t.ms}ms`);
      if (d.layout) console.log(d.layout);
    }
    for (const r of ok) for (const i of r.incidents) {
      if (i.verdict && i.verdict.startsWith('UNAVOIDABLE')) console.log(`  FORCED INCIDENT seed=${r.seed} ${i.type} frame=${i.frame} s=${i.s}\n${i.layout || ''}`);
    }
    for (const e of errs) { console.log(`  ERROR seed=${e.seed}: ${e.error}`); failed = true; }
    // anomalies
    const an = {};
    for (const r of ok) for (const a of r.anomalies) (an[a.type] ||= []).push({ seed: r.seed, ...a });
    for (const [t, list] of Object.entries(an)) {
      console.log(`  ANOMALY ${t}: ${list.length} run(s); e.g. ${JSON.stringify(list[0])}`);
      failed = true;
    }
    const ev = {};
    for (const r of ok) for (const k in r.events) ev[k] = (ev[k] || 0) + r.events[k];
    const multi = {};
    for (const r of ok) for (const k in r.multiEventFrames) multi[k] = (multi[k] || 0) + r.multiEventFrames[k];
    console.log(`  events ${JSON.stringify(ev)}`);
    console.log(`  land events within 6 frames of previous land (no jump between): ${ok.reduce((a, r) => a + r.landPairsClose, 0)}; frames with duplicate events: ${JSON.stringify(multi)}`);
    const ml = { trains: 0, barriers: 0, coinItems: 0, powers: 0, recentTrains: 0 };
    for (const r of ok) for (const k in ml) ml[k] = Math.max(ml[k], r.maxLen[k]);
    console.log(`  max live items ${JSON.stringify(ml)}`);
    const geo = ok.flatMap((r) => r.coinGeo.map((g) => ({ seed: r.seed, ...g })));
    const pgeo = ok.flatMap((r) => r.powerGeo.map((g) => ({ seed: r.seed, ...g })));
    if (geo.length) {
      const kinds = {};
      for (const g of geo) kinds[g.why] = (kinds[g.why] || 0) + 1;
      console.log(`  coin placement issues ${JSON.stringify(kinds)} e.g. ${JSON.stringify(geo[0])}`);
    }
    if (pgeo.length) console.log(`  power placement issues: ${pgeo.length} e.g. ${JSON.stringify(pgeo[0])}`);
    const mov = ok.flatMap((r) => r.movingOverlaps.map((m) => ({ seed: r.seed, ...m })));
    if (mov.length) console.log(`  moving train overlaps items near/ahead of player: ${mov.length} e.g. ${JSON.stringify(mov[0])}`);
    const pmiss = ok.flatMap((r) => r.powersMissed.map((m) => ({ seed: r.seed, ...m })));
    if (v === 'seek' || v === 'jetstress') console.log(`  power-ups passed without pickup: ${pmiss.length}${pmiss.length ? ' e.g. ' + JSON.stringify(pmiss.slice(0, 3)) : ''}`);
    if (v === 'coins') {
      const seen = ok.reduce((a, r) => a + r.coinsTaken + r.coinsMissed.length, 0);
      const missed = ok.reduce((a, r) => a + r.coinsMissed.length, 0);
      const checked = ok.reduce((a, r) => a + (r.coinsMissedChecked || 0), 0);
      const unreach = ok.flatMap((r) => r.coinsUnreachable.map((c) => ({ seed: r.seed, ...c })));
      console.log(`  coins: taken=${ok.reduce((a, r) => a + r.coinsTaken, 0)} missed=${missed} of ~${seen}; missed coins re-checked=${checked}, unreachable=${unreach.length}`);
      for (const u of unreach.slice(0, 12)) console.log(`    unreachable coin seed=${u.seed} id=${u.id} lane=${u.lane} s=${u.s.toFixed(2)}: ${u.context}`);
      const reach = ok.flatMap((r) => r.coinsMissed.filter((c) => c.reachable).map((c) => ({ seed: r.seed, id: c.id, s: +c.s.toFixed(2), how: c.how })));
      if (reach.length) console.log(`    missed but reachable (bot weakness): ${JSON.stringify(reach.slice(0, 6))}`);
    }
    if (dead.some((r) => r.deaths[0].verdict === 'UNAVOIDABLE')) failed = true;
    if (ok.some((r) => r.incidents.some((i) => i.verdict && i.verdict.startsWith('UNAVOIDABLE')))) failed = true;
  }
  console.log('\nframe-rate probe (single jump):', JSON.stringify(frameRateProbe()));
  console.log(failed ? '\nRESULT: problems found (see above)' : '\nRESULT: no game bugs found');
  return { failed };
}
