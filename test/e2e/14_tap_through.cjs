// Tap-to-start "tap-through": the tap that starts the game must not also hit a
// HUD control (pause button) that appears under the finger.
const H = require('./helpers.cjs');
(async () => {
  const log = [];
  const { srv, url } = await H.serve();
  const browser = await H.launch();
  for (const [name, opts] of [['iphone13', H.pw.devices['iPhone 13']], ['pixel5', H.pw.devices['Pixel 5']]]) {
    const { ctx, page } = await H.openGame(browser, url, opts, log, name);
    await H.freeze(page);
    const pb = await page.evaluate(() => {
      // where will the pause button be? (HUD is hidden on the menu: measure it by showing it briefly)
      const hud = document.getElementById('hud'); hud.classList.remove('hidden');
      const b = document.getElementById('pauseBtn').getBoundingClientRect(); hud.classList.add('hidden');
      return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
    });
    const hit = await page.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e && (e.id || e.className); }, pb);
    await page.touchscreen.tap(pb.x, pb.y);
    await page.waitForTimeout(500);
    const st = await page.evaluate(() => window.__game.state);
    console.log(name, 'tapped at future pause-button spot', JSON.stringify(pb), 'element there on menu:', hit, '-> state', st);
    await ctx.close();
  }
  console.log('LOG:', log.length ? log.join('\n') : '(none)');
  await browser.close(); srv.close();
})();
