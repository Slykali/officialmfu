// Can a touch user reach MAIN MENU on the Game Over panel in phone landscape?
const H = require('./helpers.cjs');
(async () => {
  const log = [];
  const { srv, url } = await H.serve();
  const browser = await H.launch();
  for (const [name, opts] of [['iphone13land', H.pw.devices['iPhone 13 landscape']], ['844x390', { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }]]) {
    const { ctx, page } = await H.openGame(browser, url, opts, log, name);
    await H.freeze(page);
    await page.evaluate(() => { const g = window.__game; g.start(); g.sim._die('train'); });
    await H.advance(page, 120);
    const cdp = await ctx.newCDPSession(page);
    const p = await page.locator('#over .panel').boundingBox();
    const before = await page.evaluate(() => document.querySelector('#over .panel').scrollTop);
    // swipe up inside the panel (finger moves up = scroll down)
    const x = p.x + p.width / 2; const y0 = p.y + p.height * 0.7; const y1 = p.y + p.height * 0.15;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0, id: 1 }] });
    for (let i = 1; i <= 10; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + (y1 - y0) * i / 10, id: 1 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(500);
    // also try the browser's own touch scroll gesture
    await cdp.send('Input.synthesizeScrollGesture', { x: Math.round(x), y: Math.round(y0), yDistance: -200, gestureSourceType: 'touch', speed: 800 }).catch((e) => log.push('gesture err ' + e.message));
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({ st: document.querySelector('#over .panel').scrollTop, sh: document.querySelector('#over .panel').scrollHeight, ch: document.querySelector('#over .panel').clientHeight }));
    const mb = await page.locator('#menuBtn').boundingBox();
    console.log(name, 'scrollTop before', before, 'after touch swipes', JSON.stringify(after), 'menuBtn box', JSON.stringify(mb), 'viewport', JSON.stringify(page.viewportSize()));
    // try tapping where MAIN MENU is (it's off-screen) - can't; tap the visible part of PLAY AGAIN
    await H.shot(page, `qa/over_scroll_${name}`);
    await ctx.close();
  }
  console.log('LOG:', log.length ? log.join('\n') : '(none)');
  await browser.close(); srv.close();
})();
