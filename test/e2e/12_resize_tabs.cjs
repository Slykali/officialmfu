// Rotating a phone mid-run (viewport resize) and a real tab switch.
const H = require('./helpers.cjs');
(async () => {
  const log = [];
  const { srv, url } = await H.serve();
  const browser = await H.launch();
  const { ctx, page } = await H.openGame(browser, url, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, log, 'rot');
  await H.freeze(page);
  await page.evaluate(() => window.__game.start());
  await H.advance(page, 200);
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(300);
  await H.advance(page, 2);
  const a = await page.evaluate(() => { const g = window.__game; const c = g.renderer.domElement; return { cw: c.width, ch: c.height, css: [c.clientWidth, c.clientHeight], aspect: +g.camera.aspect.toFixed(3), fov: g.camera.fov, state: g.state }; });
  console.log('after rotate to landscape', JSON.stringify(a));
  await H.shot(page, 'qa/rotate_landscape');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await H.advance(page, 2);
  const b = await page.evaluate(() => { const g = window.__game; const c = g.renderer.domElement; return { cw: c.width, ch: c.height, aspect: +g.camera.aspect.toFixed(3), fov: g.camera.fov, state: g.state }; });
  console.log('after rotate back', JSON.stringify(b));
  await H.shot(page, 'qa/rotate_portrait');

  // real tab switch: open another tab and bring it to front
  await H.freeze(page, false);
  const p2 = await ctx.newPage();
  await p2.bringToFront();
  await page.waitForTimeout(800);
  const st = await page.evaluate(() => ({ hidden: document.hidden, vis: document.visibilityState, state: window.__game.state }));
  console.log('after switching to another tab', JSON.stringify(st));
  await page.bringToFront();
  await page.waitForTimeout(500);
  console.log('back', JSON.stringify(await page.evaluate(() => ({ hidden: document.hidden, state: window.__game.state }))));
  console.log('LOG:', log.length ? log.join('\n') : '(none)');
  await browser.close(); srv.close();
})();
