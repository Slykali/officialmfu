// Safe-area insets (notch / home indicator) via CDP Emulation.setSafeAreaInsetsOverride.
const H = require('./helpers.cjs');
(async () => {
  const log = [];
  const { srv, url } = await H.serve();
  const browser = await H.launch();
  for (const [name, opts, insets] of [
    ['portrait', { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, { top: 47, bottom: 34, left: 0, right: 0 }],
    ['landscape', { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, { top: 0, bottom: 21, left: 47, right: 47 }],
  ]) {
    const ctx = await browser.newContext(opts);
    const page = await ctx.newPage();
    H.collect(page, log, name);
    const cdp = await ctx.newCDPSession(page);
    let ok = true;
    try { await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets }); } catch (e) { ok = false; console.log('CDP safe-area override not supported:', e.message); }
    await page.goto(url);
    await page.waitForFunction(() => window.__game);
    await H.freeze(page);
    const probe = () => page.evaluate(() => {
      const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; };
      const d = document.createElement('div'); d.style.cssText = 'position:fixed;top:env(safe-area-inset-top);left:env(safe-area-inset-left);right:env(safe-area-inset-right);bottom:env(safe-area-inset-bottom)';
      document.body.appendChild(d); const sb = d.getBoundingClientRect(); d.remove();
      const panel = document.querySelector('.screen:not(.hidden) .panel');
      return { safe: [Math.round(sb.left), Math.round(sb.top), Math.round(sb.right), Math.round(sb.bottom)], pause: r('pauseBtn'), score: r('score'), mute: r('muteBtn'), panel: panel ? (() => { const b = panel.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.right), Math.round(b.bottom)]; })() : null };
    });
    const menu = await probe();
    await page.evaluate(() => { const g = window.__game; g.start(); g.sim._activate('magnet'); g.sim._activate('board'); });
    await H.advance(page, 30);
    const hud = await probe();
    await H.shot(page, `qa/safe_${name}_hud`);
    await page.evaluate(() => { window.__game.sim._die('train'); });
    await H.advance(page, 120);
    const over = await probe();
    await H.shot(page, `qa/safe_${name}_over`);
    console.log(name, 'override', ok, '\n menu', JSON.stringify(menu), '\n hud', JSON.stringify(hud), '\n over', JSON.stringify(over));
    await ctx.close();
  }
  console.log('LOG:', log.length ? log.join('\n') : '(none)');
  await browser.close(); srv.close();
})();
