// Long scripted run to distance 6000+ (and beyond), sampling memory/scene size,
// with periodic screenshots and console/pageerror collection.
const H = require('./helpers.cjs');

(async () => {
  const log = [];
  const { srv, url } = await H.serve();
  const browser = await H.launch();
  const target = Number(process.env.TARGET || 8000);
  const { ctx, page } = await H.openGame(browser, url, { viewport: { width: 1280, height: 720 } }, log, 'long');
  await H.freeze(page);
  await page.keyboard.press('Enter');
  const samples = [];
  const shotsAt = [500, 1500, 3000, 5000, 7000];
  let nextShot = 0;
  for (;;) {
    const r = await page.evaluate(() => {
      const g = window.__game; const upd = g.__origUpdate; const sim = g.sim;
      let maxChildren = 0; let maxViews = 0;
      const t0 = performance.now();
      for (let i = 0; i < 60 * 20; i++) {
        sim.graceT = Math.max(sim.graceT, 1); // invulnerable
        // random player inputs to exercise lanes / jumps / rolls / pickups
        const r = Math.random();
        if (r < 0.01) g.act('left'); else if (r < 0.02) g.act('right'); else if (r < 0.027) g.act('jump'); else if (r < 0.032) g.act('down');
        upd.call(g, 1 / 60);
        maxChildren = Math.max(maxChildren, g.scene.children.length);
        maxViews = Math.max(maxViews, g.views.size);
        if (g.state !== 'playing') break;
      }
      const ms = performance.now() - t0;
      g.runner.root.visible = true;
      g.__origRender(g.scene, g.camera);
      const i = g.renderer.info;
      return {
        s: Math.round(sim.s), state: g.state, speed: +sim.speed.toFixed(1), score: Math.floor(sim.score), coins: sim.coins,
        children: g.scene.children.length, maxChildren, views: g.views.size, maxViews,
        trains: sim.trains.length, barriers: sim.barriers.length, coinItems: sim.coinItems.length, powers: sim.powers.length,
        pool: g.coinPool.length, flying: g.flying.length, geos: i.memory.geometries, tex: i.memory.textures,
        calls: i.render.calls, tris: i.render.triangles, heapMB: performance.memory ? +(performance.memory.usedJSHeapSize / 1e6).toFixed(1) : null,
        msPer1200: Math.round(ms), power: Object.entries(sim.power).filter(([, v]) => v > 0).map(([k]) => k).join('+'),
      };
    });
    samples.push(r);
    if (nextShot < shotsAt.length && r.s >= shotsAt[nextShot]) {
      await page.waitForTimeout(120);
      await H.shot(page, `qa/long_s${shotsAt[nextShot]}`);
      nextShot++;
    }
    if (r.state !== 'playing' || r.s >= target) break;
  }
  for (const s of samples) console.log(JSON.stringify(s));
  const mx = (k) => Math.max(...samples.map((s) => s[k]));
  const mn = (k) => Math.min(...samples.map((s) => s[k]));
  console.log('\nRANGES', ['children', 'maxChildren', 'views', 'trains', 'barriers', 'coinItems', 'pool', 'geos', 'tex', 'calls', 'heapMB', 'msPer1200']
    .map((k) => `${k}: ${mn(k)}..${mx(k)}`).join(' | '));
  // far-distance precision check: jump to a huge s and render (float32 jitter)
  console.log('LOG:', log.length ? log.join('\n') : '(none)');
  await browser.close();
  srv.close();
})();
