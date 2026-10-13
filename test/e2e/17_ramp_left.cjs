// A ramp in the left lane seen from the middle lane (its shaded +x side faces the camera).
const H = require('./helpers.cjs');
(async () => {
  const log = [];
  const { srv, url } = await H.serve();
  const browser = await H.launch();
  const { page } = await H.openGame(browser, url, { viewport: { width: 1280, height: 720 } }, log, 'ramp');
  await H.freeze(page);
  await page.evaluate(() => {
    const g = window.__game; g.start(); const upd = g.__origUpdate; for (let i = 0; i < 130; i++) upd.call(g, 1 / 60);
    const s = g.sim; for (const arr of [s.trains, s.barriers, s.coinItems, s.powers]) { for (const it of arr) s.removed.push(it); arr.length = 0; }
    s.gen.cursor = 1e9; g._syncAdded(); g.guardGap = 30;
    const t = { kind: 'train', id: 777001, lane: 0, s: s.s + 22, cars: 2, len: 28, moving: false, k: 0, R: 0, livery: 1, ramp: true };
    const t2 = { kind: 'train', id: 777002, lane: 2, s: s.s + 22, cars: 2, len: 28, moving: false, k: 0, R: 0, livery: 3, ramp: true };
    s.trains.push(t, t2); s.added.push(t, t2); g._syncAdded();
    upd.call(g, 1 / 60); g.runner.root.visible = true; g.__origRender(g.scene, g.camera);
  });
  await page.waitForTimeout(150);
  await H.shot(page, 'qa/ramps_both_sides');
  console.log('LOG:', log.length ? log.join('\n') : '(none)');
  await browser.close(); srv.close();
})();
