// Unit checks for the daily mission system: node test/missions.mjs
import assert from 'node:assert/strict';
import { Missions, missionsFor, dateKey, BONUS_REWARD } from '../src/missions.js';

const store = () => {
  const m = new Map();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => m.set(k, v), m };
};

// deterministic and always three distinct types with sane targets
const seen = new Set();
for (let d = 0; d < 400; d++) {
  const day = new Date(2026, 0, 1 + d);
  const key = dateKey(day);
  const a = missionsFor(key);
  assert.deepEqual(a, missionsFor(key));
  assert.equal(a.length, 3);
  assert.equal(new Set(a.map((m) => m.type)).size, 3);
  for (const m of a) {
    assert.ok(m.target > 0 && m.reward > 0 && m.text.length > 5, JSON.stringify(m));
    assert.ok(!m.text.includes('undefined') && !m.text.includes('NaN'), m.text);
    seen.add(m.type);
  }
}
assert.ok(seen.size >= 12, 'all mission types appear over a year');
assert.equal(dateKey(new Date(2026, 9, 3)), '2026-10-03');

// progress, completion, bonus, persistence and day rollover
let now = new Date(2026, 9, 13, 10, 0, 0);
const s = store();
let ms = new Missions({ storage: s, now: () => now });
const list = ms.list;
ms.startRun();
let paid = 0;
const feed = (arr) => { for (const d of arr) paid += d.reward; return arr; };
// drive every mission to completion with generous stats
for (let i = 0; i < 3000; i++) {
  feed(ms.add('coin')); feed(ms.add('jump')); feed(ms.add('roll')); feed(ms.add('roof', 1)); feed(ms.add('meters', 10));
  for (const k of ['jetpack', 'sneakers', 'magnet', 'board', 'multiplier']) feed(ms.add('orb', 1, k));
}
feed(ms.runStats({ coins: 999, distance: 99999, score: 1e6, level: 10, clean: 99999 }));
for (let i = 0; i < 20; i++) { feed(ms.endRun()); ms.startRun(); }
assert.ok(ms.allDone, 'all missions complete');
assert.equal(paid, list.reduce((a, m) => a + m.reward, 0) + BONUS_REWARD, 'each reward paid exactly once, plus the bonus');
// nothing pays twice
assert.equal(feed(ms.add('coin')).length, 0);
// reload from storage keeps state
const ms2 = new Missions({ storage: s, now: () => now });
assert.ok(ms2.allDone && ms2.state.bonus);
// next day starts fresh
now = new Date(2026, 9, 14, 0, 0, 1);
const ms3 = new Missions({ storage: s, now: () => now });
assert.ok(!ms3.allDone && ms3.state.progress.every((p) => p === 0));
assert.notDeepEqual(ms3.list, list);
// a run that started yesterday keeps yesterday's missions until it ends
now = new Date(2026, 9, 14, 23, 59, 0);
const ms4 = new Missions({ storage: store(), now: () => now });
ms4.startRun();
const before = ms4.list;
now = new Date(2026, 9, 15, 0, 1, 0);
ms4.add('coin');
assert.equal(ms4.list, before);
ms4.endRun();
ms4.startRun();
assert.notEqual(ms4.list, before);
// run-scoped missions keep the best run, not a sum
const rs = new Missions({ storage: store(), now: () => new Date(2026, 9, 13) });
rs.list = [{ type: 'coins_run', scope: 'run', stat: 'coins', target: 100, reward: 100, text: 't' }, ...rs.list.slice(1)];
rs.state.progress = [0, 0, 0];
rs.state.done = [false, false, false];
rs.startRun(); rs.runStats({ coins: 60 }); rs.endRun();
rs.startRun(); rs.runStats({ coins: 50 }); rs.endRun();
assert.equal(rs.state.progress[0], 60);
assert.equal(rs.state.done[0], false);
// corrupt storage doesn't crash
const bad = store(); bad.set('sr2-missions', '{not json');
assert.doesNotThrow(() => new Missions({ storage: bad }));
// reset countdown is within a day
assert.ok(ms.msUntilReset() > 0 && ms.msUntilReset() <= 86400000);
// two tabs sharing storage never pay the same mission twice
{
  const shared = store();
  const day = () => new Date(2026, 9, 20, 12);
  const a = new Missions({ storage: shared, now: day });
  const b = new Missions({ storage: shared, now: day });
  let paidA = 0;
  let paidB = 0;
  a.startRun(); b.startRun();
  for (let i = 0; i < 3000; i++) {
    for (const [m, add] of [[a, (r) => { paidA += r; }], [b, (r) => { paidB += r; }]]) {
      for (const d of [...m.add('coin'), ...m.add('jump'), ...m.add('roll'), ...m.add('roof', 1), ...m.add('meters', 10),
        ...['jetpack', 'sneakers', 'magnet', 'board', 'multiplier'].flatMap((k) => m.add('orb', 1, k))]) add(d.reward);
      for (const d of m.runStats({ coins: 999, distance: 99999, score: 1e6, level: 10, clean: 99999 })) add(d.reward);
    }
  }
  for (let i = 0; i < 20; i++) {
    for (const d of a.endRun()) paidA += d.reward;
    a.startRun();
    for (const d of b.endRun()) paidB += d.reward;
    b.startRun();
  }
  const total = a.list.reduce((s, m) => s + m.reward, 0) + BONUS_REWARD;
  assert.equal(paidA + paidB, total, 'shared storage pays each mission once in total');
}
// quitting straight away doesn't count as a run
{
  const st = store();
  const m = new Missions({ storage: st, now: () => new Date(2026, 9, 21) });
  const idx = m.list.findIndex((x) => x.type === 'runs_day');
  if (idx >= 0) {
    m.startRun(); m.endRun(false);
    assert.equal(m.state.progress[idx], 0);
    m.startRun(); m.endRun(true);
    assert.equal(m.state.progress[idx], 1);
  }
}
// a save with a malformed done list is ignored instead of granting the bonus
{
  const st = store();
  const key = dateKey(new Date(2026, 9, 22));
  st.set('sr2-missions', JSON.stringify({ date: key, progress: [0, 0, 0], done: [], bonus: false }));
  const m = new Missions({ storage: st, now: () => new Date(2026, 9, 22) });
  assert.equal(m.allDone, false);
}
// mission text reads naturally
for (let d = 0; d < 400; d++) {
  for (const m of missionsFor(dateKey(new Date(2026, 0, 1 + d)))) {
    assert.ok(!/ 2x orb/.test(m.text) && !/Collect 1 /.test(m.text), m.text);
  }
}
console.log('missions: all checks passed');
