// Robustness: storage unavailable, no WebGL, WebGL context loss/restore.
const H = require('./helpers.cjs');
(async () => {
  const { srv, url } = await H.serve();
  // 1) localStorage throws (privacy mode / blocked cookies)
  {
    const log = [];
    const browser = await H.launch();
    const ctx = await browser.newContext({ viewport: { width: 800, height: 600 } });
    await ctx.addInitScript(() => {
      const thrower = () => { throw new DOMException('blocked', 'SecurityError'); };
      Object.defineProperty(window, 'localStorage', { configurable: true, get: thrower });
    });
    const page = await ctx.newPage();
    H.collect(page, log, 'nostorage');
    await page.goto(url);
    await page.waitForFunction(() => window.__game, null, { timeout: 30000 });
    await H.freeze(page);
    await page.keyboard.press('m');
    await page.keyboard.press('Enter');
    await H.advance(page, 100);
    await page.evaluate(() => window.__game.sim._die('train'));
    await H.advance(page, 120);
    console.log('no-storage: state', await page.evaluate(() => window.__game.state), 'LOG:', log.length ? log.join('\n') : '(none)');
    await browser.close();
  }
  // 2) no WebGL
  {
    const log = [];
    const browser = await H.pw.chromium.launch({ headless: true, args: ['--disable-webgl', '--disable-webgl2', '--disable-3d-apis'] });
    const page = await browser.newPage();
    H.collect(page, log, 'nogl');
    await page.goto(url);
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => ({ err: document.getElementById('error').textContent, errVisible: !document.getElementById('error').classList.contains('hidden'), loadingHidden: document.getElementById('loading').classList.contains('hidden'), game: !!window.__game }));
    await H.shot(page, 'qa/no_webgl');
    console.log('no-webgl:', JSON.stringify(r), 'LOG:', log.length ? log.join('\n') : '(none)');
    // keyboard on the error screen must not throw
    await page.keyboard.press('Enter');
    await page.keyboard.press('m');
    await page.mouse.click(100, 100);
    await page.waitForTimeout(300);
    console.log('no-webgl after input LOG:', log.length ? log.join('\n') : '(none)');
    await browser.close();
  }
  // 3) WebGL context lost + restored mid-run
  {
    const log = [];
    const browser = await H.launch();
    const { page } = await H.openGame(browser, url, { viewport: { width: 640, height: 400 } }, log, 'ctxloss');
    await H.freeze(page);
    await page.evaluate(() => window.__game.start());
    await H.advance(page, 60);
    await page.evaluate(() => { window.__ext = window.__game.renderer.getContext().getExtension('WEBGL_lose_context'); window.__ext.loseContext(); });
    await page.waitForTimeout(500);
    await H.advance(page, 30);
    const mid = await page.evaluate(() => ({ lost: window.__game.renderer.getContext().isContextLost(), state: window.__game.state }));
    await page.evaluate(() => window.__ext.restoreContext());
    await page.waitForTimeout(1000);
    await H.advance(page, 30);
    await page.waitForTimeout(200);
    await H.shot(page, 'qa/context_restored');
    const after = await page.evaluate(() => ({ lost: window.__game.renderer.getContext().isContextLost(), state: window.__game.state, tex: window.__game.renderer.info.memory.textures }));
    console.log('context loss: during', JSON.stringify(mid), 'after restore', JSON.stringify(after), 'LOG:', log.length ? log.join('\n') : '(none)');
    await browser.close();
  }
  srv.close();
})();
