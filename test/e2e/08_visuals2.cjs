// Shadow coverage, static vs oncoming train readability, generator coins on roofs, misc.
const H = require('./helpers.cjs');
(async () => {
  const log = [];
  const { srv, url } = await H.serve();
  const browser = await H.launch();
  const { ctx, page } = await H.openGame(browser, url, { viewport: { width: 1280, height: 720 } }, log, 'vis2');
  await H.freeze(page);
  await page.evaluate(() => {
    const g = window.__game;
    window.__T = {
      clear() {
        const s = g.sim;
        for (const arr of [s.trains, s.barriers, s.coinItems, s.powers]) { for (const it of arr) s.removed.push(it); arr.length = 0; }
        s.gen.cursor = 1e9; g._syncAdded();
      },
      add(it) {
        const s = g.sim; it.id = 500000 + Math.floor(Math.random() * 1e6);
        if (it.kind === 'train') { Object.assign(it, { len: it.cars * 14, moving: !!it.moving, k: it.moving ? 0.55 : 0, R: it.moving ? 75 : 0, livery: it.livery ?? 1, ramp: !!it.ramp }); s.trains.push(it); } else if (it.kind === 'coin') s.coinItems.push(it); else if (it.kind === 'power') { it.y = 1.2; s.powers.push(it); } else s.barriers.push(it);
        s.added.push(it); g._syncAdded(); return it;
      },
      cam(pos, look, fov = 50) { const C = g.camera.constructor; const c = new C(fov, g.camera.aspect, 0.1, 500); c.position.set(...pos); c.lookAt(...look); g.__origRender(g.scene, c); },
    };
  });
  await page.evaluate(() => { const g = window.__game; g.start(); });
  await H.advance(page, 130);
  // 1) shadows: hurdles + trains at increasing distances in lanes 0/2
  await page.evaluate(() => {
    const g = window.__game; const s = g.sim.s; __T.clear(); g.guardGap = 30; g.runStart = -100;
    for (let k = 0; k < 8; k++) __T.add({ kind: 'hurdle', lane: 1, s: s + 8 + k * 12 });
    for (let k = 0; k < 4; k++) __T.add({ kind: 'train', lane: k % 2 ? 2 : 0, s: s + 10 + k * 25, cars: 1, livery: k % 4 });
  });
  await H.advance(page, 1);
  await page.waitForTimeout(150); await H.shot(page, 'qa/vis2_shadow_game');
  await page.evaluate(() => { const s = window.__game.sim.s; __T.cam([0, 70, -(s + 45)], [0, 0, -(s + 45.01)], 70); });
  await page.waitForTimeout(150); await H.shot(page, 'qa/vis2_shadow_topdown');

  // 2) static (lane 0) vs oncoming (lane 2) trains at the same distance
  await page.evaluate(() => {
    const g = window.__game; const s = g.sim.s; __T.clear();
    __T.add({ kind: 'train', lane: 0, s: s + 30, cars: 2, livery: 0 });
    const t = __T.add({ kind: 'train', lane: 2, s: s + 30, cars: 2, moving: true, livery: 4 });
    // put the moving train's front at the same place as the static one by placing it far enough
    t.s = s + 30 - 0; // front = t.s + k*min(R, t.s - s) = s+30+16.5
  });
  await H.advance(page, 1);
  await page.waitForTimeout(150); await H.shot(page, 'qa/vis2_static_vs_oncoming');

  // 3) natural level: find generator coins on a roof and run to them
  const found = await page.evaluate(() => {
    const g = window.__game;
    for (let seed = 1; seed < 400; seed++) {
      g.sim.reset(seed); g.world.reset(); g._clearViews(); g._syncAdded();
      // generate further
      g.sim.gen.generate(g.sim.s + 1500).forEach((it) => {
        if (it.kind === 'train') g.sim.trains.push(it); else if (it.kind === 'coin') g.sim.coinItems.push(it); else if (it.kind === 'power') g.sim.powers.push(it); else g.sim.barriers.push(it); g.sim.added.push(it);
      });
      const c = g.sim.coinItems.find((c) => c.y > 4);
      if (c) { g._syncAdded(); return { seed, s: c.s, lane: c.lane, y: c.y }; }
    }
    return null;
  });
  console.log('roof coin', JSON.stringify(found));
  if (found) {
    await page.evaluate((f) => {
      const g = window.__game; g.state = 'playing'; g.ui.showHud();
      g.sim.s = f.s - 12; g.sim.lane = f.lane; g.sim.x = (f.lane - 1) * 2.5; g.sim.y = 0; g.guardGap = 30; g.runStart = -100;
    }, found);
    await H.advance(page, 1);
    await page.waitForTimeout(150); await H.shot(page, 'qa/vis2_roof_coins_game');
    await page.evaluate((f) => { const x = (f.lane - 1) * 2.5; __T.cam([x + 9, 6, -(f.s - 4)], [x, 3.6, -(f.s + 4)]); }, found);
    await page.waitForTimeout(150); await H.shot(page, 'qa/vis2_roof_coins_side');
  }
  // 4) panorama of the level ahead at s=3000 from high above (look for gaps / void)
  await page.evaluate(() => { const g = window.__game; g.sim.reset(3); g._clearViews(); g._syncAdded(); g.state = 'playing'; });
  await page.evaluate(() => { const g = window.__game; const upd = g.__origUpdate; for (let i = 0; i < 60 * 100; i++) { g.sim.graceT = 2; upd.call(g, 1 / 60); } });
  await H.render(page, true);
  await page.waitForTimeout(150); await H.shot(page, 'qa/vis2_s_far_game');
  await page.evaluate(() => { const s = window.__game.sim.s; __T.cam([0, 30, -(s - 10)], [0, 0, -(s + 60)], 60); });
  await page.waitForTimeout(150); await H.shot(page, 'qa/vis2_s_far_birdseye');
  await page.evaluate(() => { const s = window.__game.sim.s; __T.cam([0, 6, -(s)], [-20, 3, -(s + 10)], 60); });
  await page.waitForTimeout(150); await H.shot(page, 'qa/vis2_side_gap_look');
  console.log('LOG:', log.length ? log.join('\n') : '(none)');
  await browser.close(); srv.close();
})();
