// Opening index.html straight from disk (file://), as the README promises.
const H = require('./helpers.cjs');
(async () => {
  const log = [];
  const browser = await H.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  const page = await ctx.newPage();
  H.collect(page, log, 'file');
  await page.goto('file://' + H.ROOT + '/index.html');
  await page.waitForFunction(() => window.__game && document.getElementById('loading').classList.contains('hidden'), null, { timeout: 30000 });
  await H.freeze(page);
  await page.keyboard.press('Enter');
  await H.advance(page, 200);
  await page.evaluate(() => window.__game.sim._die('train'));
  await H.advance(page, 120);
  const best = await page.evaluate(() => localStorage.getItem('sr2-best'));
  await page.reload();
  await page.waitForFunction(() => window.__game);
  const menuBest = await page.evaluate(() => document.getElementById('bestMenu').textContent);
  console.log('file:// boot ok; stored best', best, 'menu best after reload', menuBest);
  console.log('LOG:', log.length ? log.join('\n') : '(none)');
  await browser.close();
})();
