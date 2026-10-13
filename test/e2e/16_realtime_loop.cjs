// Let the game's own requestAnimationFrame loop drive a full run (rendering is
// stubbed out so headless runs at full speed): PLAY -> playing -> dying -> over,
// observing state transitions frame by frame.
const H = require('./helpers.cjs');
(async () => {
  const log = [];
  const { srv, url } = await H.serve();
  const browser = await H.launch();
  const { page } = await H.openGame(browser, url, { viewport: { width: 800, height: 500 } }, log, 'rt');
  await page.evaluate(() => {
    const g = window.__game;
    g.renderer.render = () => {}; // update-only loop
    window.__trans = [];
    window.__overCalls = 0;
    const o = g._gameOver.bind(g); g._gameOver = function () { window.__overCalls++; return o(); };
    let last = g.state;
    const tick = () => { if (g.state !== last) { window.__trans.push(`${last}->${g.state}@${g.time.toFixed(2)}`); last = g.state; } requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await page.click('#playBtn');
  const t0 = Date.now();
  await page.waitForFunction(() => window.__game.state === 'over', null, { timeout: 120000 });
  const wall = (Date.now() - t0) / 1000;
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({ trans: window.__trans, over: window.__overCalls, cause: window.__game.sim.deathCause, s: Math.round(window.__game.sim.s), fps: null }));
  console.log('wall seconds to game over', wall.toFixed(1), JSON.stringify(r));
  // PLAY AGAIN then pause/resume through the real loop
  await page.click('#againBtn');
  await page.waitForTimeout(500);
  await page.keyboard.press('p');
  await page.waitForTimeout(300);
  const s1 = await page.evaluate(() => window.__game.sim.s);
  await page.waitForTimeout(1000);
  const s2 = await page.evaluate(() => window.__game.sim.s);
  await page.keyboard.press('p');
  const t1 = Date.now();
  await page.waitForFunction(() => window.__game.state === 'playing', null, { timeout: 20000 });
  console.log('paused s stable', s1 === s2, 'countdown wall seconds', ((Date.now() - t1) / 1000).toFixed(2), 'transitions', JSON.stringify(await page.evaluate(() => window.__trans.slice(-6))));
  console.log('LOG:', log.length ? log.join('\n') : '(none)');
  await browser.close(); srv.close();
})();
