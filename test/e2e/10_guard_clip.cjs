// Guard behaviour next to trains: the guard follows the player's x with lag, so
// after a lane change right past the end of a train it can overlap that train.
const H = require('./helpers.cjs');
(async () => {
  const log = [];
  const { srv, url } = await H.serve();
  const browser = await H.launch();
  const { ctx, page } = await H.openGame(browser, url, { viewport: { width: 1280, height: 720 } }, log, 'guard');
  await H.freeze(page);
  const r = await page.evaluate(() => {
    const g = window.__game; g.start();
    const upd = g.__origUpdate; for (let i = 0; i < 130; i++) upd.call(g, 1 / 60);
    const s = g.sim;
    for (const arr of [s.trains, s.barriers, s.coinItems, s.powers]) { for (const it of arr) s.removed.push(it); arr.length = 0; }
    s.gen.cursor = 1e9; g._syncAdded();
    const t = { kind: 'train', id: 990001, lane: 0, s: s.s + 6, cars: 1, len: 14, moving: false, k: 0, R: 0, livery: 2, ramp: false };
    s.trains.push(t); s.added.push(t); g._syncAdded();
    s.stumbleT = 5; // guard close behind (as after a stumble)
    for (let i = 0; i < 90; i++) upd.call(g, 1 / 60);
    while (s.s < t.s + t.len + 0.6) upd.call(g, 1 / 60);
    s.left();
    const trace = [];
    for (let i = 0; i < 40; i++) {
      upd.call(g, 1 / 60);
      trace.push({ i, gx: +g.guard.root.position.x.toFixed(2), gy: +g.guard.root.position.y.toFixed(2), gs: +(-g.guard.root.position.z).toFixed(1), trainEnd: t.s + t.len, px: +s.x.toFixed(2) });
      if (i === 14) { g.runner.root.visible = true; g.__origRender(g.scene, g.camera); }
    }
    return trace;
  });
  await page.waitForTimeout(150); await H.shot(page, 'qa/guard_lane_change_next_to_train');
  const maxY = Math.max(...r.map((t) => t.gy));
  console.log('guard trace', r.filter((t, i) => i % 3 === 0).map((t) => JSON.stringify(t)).join('\n'));
  console.log('max guard y', maxY);
  console.log('LOG:', log.length ? log.join('\n') : '(none)');
  await browser.close(); srv.close();
})();
