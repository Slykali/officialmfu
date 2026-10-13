// What the runner looks like while paused / during the resume countdown, if the
// pause happens mid-jump, mid-roll or on the hoverboard.
const H = require('./helpers.cjs');
(async () => {
  const log = [];
  const { srv, url } = await H.serve();
  const browser = await H.launch();
  const { ctx, page } = await H.openGame(browser, url, { viewport: { width: 1280, height: 720 } }, log, 'pose');
  await H.freeze(page);
  await page.evaluate(() => { const g = window.__game; g.start(); });
  await H.advance(page, 130);
  await page.evaluate(() => { const s = window.__game.sim; s.trains.length = 0; s.barriers.length = 0; s.gen.cursor = 1e9; });
  await page.keyboard.press('ArrowUp');
  await H.advance(page, 12);
  await H.shot(page, 'qa/pose_jump_playing');
  await page.keyboard.press('p');
  await page.evaluate(() => { document.getElementById('pauseScreen').style.opacity = '0.25'; });
  await H.advance(page, 2);
  await page.waitForTimeout(100);
  await H.shot(page, 'qa/pose_jump_paused');
  await page.keyboard.press('p');
  await H.advance(page, 30);
  await page.waitForTimeout(100);
  await H.shot(page, 'qa/pose_jump_countdown');
  console.log('y during countdown', (await H.sim(page)).y);
  await H.advance(page, 200);
  await page.keyboard.press('ArrowDown');
  await H.advance(page, 10);
  await page.keyboard.press('p');
  await H.advance(page, 2);
  await page.waitForTimeout(100);
  await H.shot(page, 'qa/pose_roll_paused');
  console.log('LOG:', log.length ? log.join('\n') : '(none)');
  await browser.close(); srv.close();
})();
