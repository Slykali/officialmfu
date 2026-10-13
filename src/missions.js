// Daily missions. Three missions are picked per calendar day from the date
// alone, so everyone gets the same set on the same day. Progress is saved
// across runs; finishing a mission pays coins right away.

const MISSION_TYPES = [
  { type: 'coins_run', scope: 'run', stat: 'coins', targets: [40, 70, 110, 160], text: (n) => `Collect ${n} coins in one run` },
  { type: 'coins_day', scope: 'day', on: 'coin', targets: [150, 300, 500, 800], text: (n) => `Collect ${n} coins in total` },
  { type: 'distance_run', scope: 'run', stat: 'distance', targets: [500, 1000, 1600, 2500], text: (n) => `Run ${n.toLocaleString('en-US')} m in one run` },
  { type: 'distance_day', scope: 'day', on: 'meters', targets: [2000, 4000, 7000, 10000], text: (n) => `Run ${n.toLocaleString('en-US')} m in total` },
  { type: 'jumps_day', scope: 'day', on: 'jump', targets: [30, 60, 100, 150], text: (n) => `Jump ${n} times` },
  { type: 'rolls_day', scope: 'day', on: 'roll', targets: [20, 40, 70, 100], text: (n) => `Roll ${n} times` },
  { type: 'orbs_day', scope: 'day', on: 'orb', targets: [3, 6, 10, 15], text: (n) => `Collect ${n} power-up orbs` },
  {
    type: 'orb_kind', scope: 'day', on: 'orb', kinds: ['jetpack', 'sneakers', 'magnet', 'board', 'multiplier'], targets: [1, 2, 3, 4],
    text: (n, kind) => `Collect ${n} ${ORB_NAMES[kind]} orb${n > 1 ? 's' : ''}`,
  },
  { type: 'score_run', scope: 'run', stat: 'score', targets: [3000, 8000, 15000, 30000], text: (n) => `Score ${n.toLocaleString('en-US')} in one run` },
  { type: 'level_run', scope: 'run', stat: 'level', targets: [2, 3, 4, 5], text: (n) => `Reach level ${n} in one run` },
  { type: 'runs_day', scope: 'day', on: 'run', targets: [3, 5, 8, 12], text: (n) => `Play ${n} runs` },
  { type: 'roof_day', scope: 'day', on: 'roof', targets: [80, 200, 400, 700], text: (n) => `Run ${n} m on train roofs` },
  { type: 'clean_run', scope: 'run', stat: 'clean', targets: [400, 800, 1400, 2200], text: (n) => `Run ${n.toLocaleString('en-US')} m without stumbling` },
];

export const ORB_NAMES = {
  jetpack: 'Jetpack', sneakers: 'Super Sneakers', magnet: 'Coin Magnet', board: 'Hoverboard', multiplier: '2x',
};
const REWARDS = [100, 150, 250, 400];
export const BONUS_REWARD = 500;
const STORAGE_KEY = 'sr2-missions';

export function dateKey(d) {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function hashString(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The three missions for a given day.
export function missionsFor(key) {
  const r = rng(hashString(`missions:${key}`));
  const pool = MISSION_TYPES.slice();
  const out = [];
  while (out.length < 3) {
    const def = pool.splice(Math.floor(r() * pool.length), 1)[0];
    // mostly easy and medium, sometimes hard, rarely very hard
    const x = r();
    const tier = x < 0.4 ? 0 : x < 0.8 ? 1 : x < 0.95 ? 2 : 3;
    const kind = def.kinds ? def.kinds[Math.floor(r() * def.kinds.length)] : null;
    const target = def.type === 'orb_kind' && (kind === 'jetpack' || kind === 'board') ? Math.min(def.targets[tier], 2) : def.targets[tier];
    out.push({
      type: def.type, scope: def.scope, stat: def.stat || null, on: def.on || null, kind,
      target, reward: REWARDS[tier], text: def.text(target, kind),
    });
  }
  return out;
}

const memoryStore = new Map();
const defaultStorage = {
  get(k) {
    try { return localStorage.getItem(k); } catch (e) { return memoryStore.get(k) ?? null; }
  },
  set(k, v) {
    try { localStorage.setItem(k, v); } catch (e) { memoryStore.set(k, v); }
  },
};

export class Missions {
  constructor({ storage = defaultStorage, now = () => new Date() } = {}) {
    this.storage = storage;
    this.now = now;
    this.state = null;
    this.run = null;
    this.refresh();
  }

  // Loads saved progress, or starts a fresh set if the day has changed.
  refresh() {
    const key = dateKey(this.now());
    if (this.state && this.state.date === key) return false;
    let saved = null;
    try {
      saved = JSON.parse(this.storage.get(STORAGE_KEY) || 'null');
    } catch (e) {
      saved = null;
    }
    const list = missionsFor(key);
    const valid = saved && saved.date === key && Array.isArray(saved.progress) && saved.progress.length === 3;
    this.state = {
      date: key,
      progress: valid ? saved.progress.map((v) => (Number.isFinite(v) && v > 0 ? v : 0)) : [0, 0, 0],
      done: valid && Array.isArray(saved.done) ? saved.done.map(Boolean) : [false, false, false],
      bonus: valid ? !!saved.bonus : false,
    };
    this.list = list;
    this.save();
    return true;
  }

  save() {
    this.storage.set(STORAGE_KEY, JSON.stringify(this.state));
  }

  get allDone() { return this.state.done.every(Boolean); }

  // Milliseconds until the missions change (local midnight).
  msUntilReset() {
    const n = this.now();
    const next = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
    return next - n;
  }

  view() {
    return {
      missions: this.list.map((m, i) => ({
        text: m.text, reward: m.reward, target: m.target, scope: m.scope,
        progress: Math.min(m.target, Math.floor(this.state.progress[i])), done: this.state.done[i],
      })),
      bonus: BONUS_REWARD,
      bonusDone: this.state.bonus,
      resetIn: this.msUntilReset(),
    };
  }

  startRun() {
    // A new day only takes effect between runs, so a run never changes missions half-way.
    this.refresh();
    this.run = { coins: 0, distance: 0, score: 0, level: 1, clean: 0 };
  }

  // A counted action: coin, jump, roll, orb (with kind), run, meters, roof.
  add(on, amount = 1, kind = null) {
    const done = [];
    this.list.forEach((m, i) => {
      if (this.state.done[i] || m.scope !== 'day' || m.on !== on) return;
      if (m.kind && m.kind !== kind) return;
      this.state.progress[i] += amount;
      this._check(i, done);
    });
    return this._finish(done);
  }

  // Latest values for the current run: coins, distance, score, level, clean.
  runStats(stats) {
    if (!this.run) return [];
    Object.assign(this.run, stats);
    const done = [];
    this.list.forEach((m, i) => {
      if (this.state.done[i] || m.scope !== 'run') return;
      const v = this.run[m.stat] || 0;
      if (v > this.state.progress[i]) this.state.progress[i] = v;
      this._check(i, done);
    });
    return this._finish(done);
  }

  endRun() {
    if (!this.run) return [];
    this.run = null;
    const done = this.add('run', 1);
    this.save();
    return done;
  }

  _check(i, done) {
    const m = this.list[i];
    if (!this.state.done[i] && this.state.progress[i] >= m.target) {
      this.state.done[i] = true;
      done.push({ text: m.text, reward: m.reward });
    }
  }

  _finish(done) {
    if (done.length && this.allDone && !this.state.bonus) {
      this.state.bonus = true;
      done.push({ text: 'All daily missions', reward: BONUS_REWARD, bonus: true });
    }
    if (done.length) this.save();
    return done;
  }
}
