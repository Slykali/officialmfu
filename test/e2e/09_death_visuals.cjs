// What the crash looks like: death on the ground, death in mid-air (jumping into a
// train / sign), death on a roof.
const H = require('./helpers.cjs');
(async () => {
  const log = [];
  const { srv, url } = await H.serve();
  const browser = await H.launch();
  const { ctx, page } = await H.openGame(browser, url, { viewport: { width: 1280, height: 720 } }, log, 'death');
  await H.freeze(page);
  const setup = (spec) => page.evaluate((spec) => {
    const g = window.__game; g.start();
    const upd = g.__origUpdate; for (let i = 0; i < 130; i++) upd.call(g, 1 / 60);
    const s = g.sim;
    for (const arr of [s.trains, s.barriers, s.coinItems, s.powers]) { for (const it of arr) s.removed.push(it); arr.length = 0; }
    s.gen.cursor = 1e9; g._syncAdded();
    const it = { ...spec.item, id: 900000 + Math.floor(Math.random() * 1e5), s: s.s + spec.item.ds };
    if (it.kind === 'train') { Object.assign(it, { len: it.cars * 14, moving: false, k: 0, R: 0, livery: 1, ramp: false }); s.trains.push(it); } else s.barriers.push(it);
    s.added.push(it); g._syncAdded();
    // run until the object is spec.jumpAt ahead, jump, run until dead
    let n = 0;
    while (s.alive && it.s - s.s > spec.jumpAt && n++ < 2000) upd.call(g, 1 / 60);
    if (spec.jump) s.jump();
    n = 0;
    while (s.alive && n++ < 2000) upd.call(g, 1 / 60);
    const yAtDeath = s.y;
    for (let i = 0; i < 60; i++) upd.call(g, 1 / 60); // ~1 s into the death animation
    g.__origRender(g.scene, g.camera);
    return { cause: s.deathCause, yAtDeath: +yAtDeath.toFixed(2), state: g.state, runnerY: +g.runner.root.position.y.toFixed(2), guardY: +g.guard.root.position.y.toFixed(2) };
  }, spec);
  const side = () => page.evaluate(() => {
    const g = window.__game; const s = g.sim.s; const C = g.camera.constructor;
    const c = new C(50, g.camera.aspect, 0.1, 400); c.position.set(g.sim.x + 7, 2.5, -(s - 1)); c.lookAt(g.sim.x, 1.5, -(s + 1)); g.__origRender(g.scene, c);
  });
  for (const [name, spec] of [
    ['ground_train', { item: { kind: 'train', lane: 1, cars: 1, ds: 30 }, jump: false, jumpAt: 0 }],
    ['midair_train', { item: { kind: 'train', lane: 1, cars: 1, ds: 30 }, jump: true, jumpAt: 4.5 }],
    ['midair_sign', { item: { kind: 'overhead', lane: 1, ds: 30 }, jump: true, jumpAt: 4.0 }],
    ['ground_hurdle', { item: { kind: 'hurdle', lane: 1, ds: 30 }, jump: false, jumpAt: 0 }],
  ]) {
    const r = await setup(spec);
    console.log(name, JSON.stringify(r));
    await page.waitForTimeout(150); await H.shot(page, `qa/death_${name}`);
    await side();
    await page.waitForTimeout(150); await H.shot(page, `qa/death_${name}_side`);
  }
  console.log('LOG:', log.length ? log.join('\n') : '(none)');
  await browser.close(); srv.close();
})();
