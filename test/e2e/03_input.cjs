// Starting the game (PLAY click, Enter, tap) and controls (keyboard, touch swipes, mouse drags).
const H = require('./helpers.cjs');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
}

// Count start()/sim.reset() calls.
async function instrument(page) {
  await page.evaluate(() => {
    const g = window.__game;
    window.__counts = { start: 0, reset: 0, worldReset: 0 };
    if (!g.__wrapped) {
      g.__wrapped = true;
      const s = g.start.bind(g);
      g.start = function () { window.__counts.start++; return s(); };
      const r = g.sim.reset.bind(g.sim);
      g.sim.reset = function (...a) { window.__counts.reset++; return r(...a); };
      const w = g.world.reset.bind(g.world);
      g.world.reset = function () { window.__counts.worldReset++; return w(); };
    }
  });
}
const counts = (page) => page.evaluate(() => ({ ...window.__counts, state: window.__game.state }));

async function touchSwipe(page, cdp, x0, y0, x1, y1, steps = 6) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0, id: 1 }] });
  for (let i = 1; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    const y = y0 + ((y1 - y0) * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id: 1 }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

async function fresh(browser, url, opts, log, tag) {
  const o = await H.openGame(browser, url, opts, log, tag);
  await H.freeze(o.page);
  await instrument(o.page);
  return o;
}

(async () => {
  const log = [];
  const { srv, url } = await H.serve();
  const browser = await H.launch();
  const desk = { viewport: { width: 1280, height: 720 } };
  const phone = { ...H.pw.devices['iPhone 13'] };

  // ---------------- start via PLAY click (desktop)
  {
    const { ctx, page } = await fresh(browser, url, desk, log, 'playclick');
    await page.click('#playBtn');
    await page.waitForTimeout(200);
    const c = await counts(page);
    check('PLAY click starts once', c.start === 1 && c.reset === 1 && c.state === 'playing', JSON.stringify(c));
    const focus = await page.evaluate(() => document.activeElement && document.activeElement.id);
    check('PLAY button blurred after click (Space/Enter will not re-click it)', !focus, `activeElement=${focus}`);
    // pressing Space right after must jump, not restart
    await page.keyboard.press('Space');
    await H.advance(page, 6);
    const c2 = await counts(page);
    const s2 = await H.sim(page);
    check('Space after PLAY click jumps and does not restart', c2.start === 1 && s2.y > 0.3, `${JSON.stringify(c2)} y=${s2.y.toFixed(2)}`);
    await ctx.close();
  }
  // ---------------- start via Enter (desktop)
  {
    const { ctx, page } = await fresh(browser, url, desk, log, 'enter');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    let c = await counts(page);
    check('Enter starts once', c.start === 1 && c.reset === 1 && c.state === 'playing', JSON.stringify(c));
    await page.keyboard.press('Enter');
    c = await counts(page);
    check('Enter while playing does nothing', c.start === 1 && c.state === 'playing', JSON.stringify(c));
    await ctx.close();
  }
  // ---------------- Tab-focus PLAY then Enter / Space (keyboard-only user)
  for (const key of ['Enter', 'Space']) {
    const { ctx, page } = await fresh(browser, url, desk, log, 'tab' + key);
    await page.keyboard.press('Tab');
    const f = await page.evaluate(() => document.activeElement && document.activeElement.id);
    await page.keyboard.press(key);
    await page.waitForTimeout(150);
    const c = await counts(page);
    check(`Tab-focus (${f}) + ${key} starts exactly once`, c.start === 1 && c.state === 'playing', JSON.stringify(c));
    await ctx.close();
  }
  // ---------------- Space on the menu
  {
    const { ctx, page } = await fresh(browser, url, desk, log, 'spaceMenu');
    await page.keyboard.press('Space');
    await page.waitForTimeout(100);
    const c = await counts(page);
    check('Space on menu (info: does it start?)', true, `state=${c.state} start=${c.start}`);
    await ctx.close();
  }
  // ---------------- touch: tap PLAY button, tap screen
  {
    const { ctx, page } = await fresh(browser, url, phone, log, 'tapPlay');
    const b = await page.locator('#playBtn').boundingBox();
    await page.touchscreen.tap(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(400);
    const c = await counts(page);
    check('Touch tap on PLAY starts once', c.start === 1 && c.reset === 1 && c.state === 'playing', JSON.stringify(c));
    await ctx.close();
  }
  {
    const { ctx, page } = await fresh(browser, url, phone, log, 'tapScreen');
    await page.touchscreen.tap(195, 600); // below the panel
    await page.waitForTimeout(400);
    let c = await counts(page);
    check('Touch tap on empty screen starts once', c.start === 1 && c.reset === 1 && c.state === 'playing', JSON.stringify(c));
    await page.touchscreen.tap(195, 300);
    await page.waitForTimeout(300);
    c = await counts(page);
    check('Second tap while playing does not restart', c.start === 1, JSON.stringify(c));
    // tap on the panel text (not the button)
    await ctx.close();
  }
  {
    const { ctx, page } = await fresh(browser, url, phone, log, 'tapPanel');
    const b = await page.locator('.help').boundingBox();
    await page.touchscreen.tap(b.x + b.width / 2, b.y + 10);
    await page.waitForTimeout(400);
    const c = await counts(page);
    check('Touch tap on the menu panel help text (info)', true, JSON.stringify(c));
    await ctx.close();
  }
  // ---------------- Mouse click on empty screen (desktop)
  {
    const { ctx, page } = await fresh(browser, url, desk, log, 'clickScreen');
    await page.mouse.click(100, 650);
    await page.waitForTimeout(200);
    const c = await counts(page);
    check('Mouse click on empty screen starts once', c.start === 1 && c.state === 'playing', JSON.stringify(c));
    await ctx.close();
  }

  // ---------------- keyboard controls
  {
    const { ctx, page } = await fresh(browser, url, desk, log, 'keys');
    await page.keyboard.press('Enter');
    await H.advance(page, 130);
    await page.evaluate(() => { const s = window.__game.sim; s.trains.length = 0; s.barriers.length = 0; s.gen.cursor = 1e9; });
    const keyTest = async (key, expect) => {
      const before = await H.sim(page);
      await page.keyboard.press(key);
      const mid = await H.sim(page);
      await H.advance(page, 8);
      const after = await H.sim(page);
      const ok = expect(before, mid, after);
      check(`key ${key}`, ok, `lane ${before.lane}->${after.lane} y=${after.y.toFixed(2)} rollT=${after.rollT.toFixed(2)}`);
      await H.advance(page, 60);
    };
    await keyTest('ArrowLeft', (b, m) => m.lane === b.lane - 1);
    await keyTest('ArrowRight', (b, m) => m.lane === b.lane + 1);
    await keyTest('a', (b, m) => m.lane === b.lane - 1);
    await keyTest('d', (b, m) => m.lane === b.lane + 1);
    await keyTest('A', (b, m) => m.lane === b.lane - 1);
    await keyTest('D', (b, m) => m.lane === b.lane + 1);
    await keyTest('ArrowUp', (b, m, a) => a.y > 0.3);
    await keyTest('w', (b, m, a) => a.y > 0.3);
    await keyTest('Space', (b, m, a) => a.y > 0.3);
    await keyTest('ArrowDown', (b, m, a) => a.rollT > 0);
    await keyTest('s', (b, m, a) => a.rollT > 0);
    // lanes clamp at the edges
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowLeft');
    let s = await H.sim(page);
    check('lane clamps at 0', s.lane === 0, `lane=${s.lane}`);
    for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowRight');
    s = await H.sim(page);
    check('lane clamps at 2', s.lane === 2, `lane=${s.lane}`);
    await H.advance(page, 30);
    // holding a key: auto-repeat must not move several lanes
    await page.keyboard.down('ArrowLeft');
    await page.keyboard.down('ArrowLeft'); // repeat=true
    await page.keyboard.down('ArrowLeft');
    await page.keyboard.up('ArrowLeft');
    s = await H.sim(page);
    check('holding ArrowLeft (auto-repeat) moves one lane only', s.lane === 1, `lane=${s.lane}`);
    await H.advance(page, 30);
    // down while in the air = fast fall + roll on landing
    await page.keyboard.press('ArrowUp');
    await H.advance(page, 6);
    const air = await H.sim(page);
    await page.keyboard.press('ArrowDown');
    await H.advance(page, 1);
    const ff = await H.sim(page);
    await H.advance(page, 12);
    const land = await H.sim(page);
    check('down in the air fast-falls then rolls', air.y > 0.5 && ff.vy < -20 && land.rollT > 0 && land.y === 0, `airY=${air.y.toFixed(2)} vy=${ff.vy.toFixed(1)} landY=${land.y} rollT=${land.rollT.toFixed(2)}`);
    // jump while rolling cancels roll
    await H.advance(page, 60);
    await page.keyboard.press('ArrowDown');
    await H.advance(page, 3);
    await page.keyboard.press('ArrowUp');
    await H.advance(page, 4);
    s = await H.sim(page);
    check('jump during roll cancels roll and jumps', s.rollT === 0 && s.y > 0.2, `rollT=${s.rollT} y=${s.y.toFixed(2)}`);
    // jump buffer: press jump shortly before landing
    await H.advance(page, 60);
    await page.keyboard.press('ArrowUp');
    // advance until falling and close to ground
    await page.evaluate(() => { const g = window.__game; let n = 0; while (!(g.sim.vy < 0 && g.sim.y < 0.6) && n++ < 200) g.__origUpdate.call(g, 1 / 60); });
    await page.keyboard.press('ArrowUp');
    await H.advance(page, 10);
    s = await H.sim(page);
    check('jump buffered just before landing triggers a new jump', s.y > 0.5 && s.vy !== 0, `y=${s.y.toFixed(2)} vy=${s.vy.toFixed(1)}`);
    // modifiers ignored
    await H.advance(page, 60);
    const l0 = (await H.sim(page)).lane;
    await page.keyboard.press('Control+ArrowLeft');
    s = await H.sim(page);
    check('Ctrl+Arrow ignored', s.lane === l0, `lane ${l0}->${s.lane}`);
    // arrow keys preventDefault (no page scroll); check that keydown default was prevented
    const prevented = await page.evaluate(() => {
      const ev = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true });
      window.dispatchEvent(ev);
      return ev.defaultPrevented;
    });
    check('arrow keydown default prevented', prevented);
    await ctx.close();
  }

  // ---------------- touch swipes (CDP touch events -> real pointer events)
  {
    const { ctx, page } = await fresh(browser, url, phone, log, 'swipe');
    const cdp = await ctx.newCDPSession(page);
    await page.touchscreen.tap(195, 600);
    await page.waitForTimeout(200);
    await H.advance(page, 130);
    await page.evaluate(() => { const s = window.__game.sim; s.trains.length = 0; s.barriers.length = 0; s.gen.cursor = 1e9; });
    const sw = async (name, dx, dy, expect) => {
      const b = await H.sim(page);
      await touchSwipe(page, cdp, 195, 400, 195 + dx, 400 + dy);
      await page.waitForTimeout(50);
      const m = await H.sim(page);
      await H.advance(page, 8);
      const a = await H.sim(page);
      check(`swipe ${name}`, expect(b, m, a), `lane ${b.lane}->${m.lane} y=${a.y.toFixed(2)} rollT=${a.rollT.toFixed(2)} state=${a.state}`);
      await H.advance(page, 60);
    };
    await sw('left', -120, 0, (b, m) => m.lane === b.lane - 1);
    await sw('right', 120, 0, (b, m) => m.lane === b.lane + 1);
    await sw('right again', 120, 0, (b, m) => m.lane === b.lane + 1);
    await sw('up', 0, -150, (b, m, a) => a.y > 0.3);
    await sw('down', 0, 150, (b, m, a) => a.rollT > 0);
    await sw('short (20px) swipe = tap, no action', -20, 0, (b, m, a) => m.lane === b.lane && a.state === 'playing');
    await sw('diagonal mostly-left', -100, -40, (b, m) => m.lane === b.lane - 1);
    // one long swipe must fire only once
    await sw('very long swipe left fires once', -330, 0, (b, m) => m.lane === b.lane - 1);
    // a swipe over the pause button region starting on the pause button must not move
    const pb = await page.locator('#pauseBtn').boundingBox();
    const b0 = await H.sim(page);
    await touchSwipe(page, cdp, pb.x + pb.width / 2, pb.y + pb.height / 2, pb.x + pb.width / 2 + 120, pb.y + pb.height / 2);
    await page.waitForTimeout(100);
    const b1 = await H.sim(page);
    check('swipe starting on pause button does not change lane', b1.lane === b0.lane, `lane ${b0.lane}->${b1.lane} state=${b1.state}`);
    // multi-touch: second finger while first is down
    await ctx.close();
  }
  // ---------------- mouse drag on desktop
  {
    const { ctx, page } = await fresh(browser, url, desk, log, 'drag');
    await page.keyboard.press('Enter');
    await H.advance(page, 130);
    await page.evaluate(() => { const s = window.__game.sim; s.trains.length = 0; s.barriers.length = 0; s.gen.cursor = 1e9; });
    const drag = async (name, dx, dy, expect) => {
      const b = await H.sim(page);
      await page.mouse.move(640, 400);
      await page.mouse.down();
      await page.mouse.move(640 + dx / 2, 400 + dy / 2, { steps: 3 });
      await page.mouse.move(640 + dx, 400 + dy, { steps: 3 });
      await page.mouse.up();
      const m = await H.sim(page);
      await H.advance(page, 8);
      const a = await H.sim(page);
      check(`mouse drag ${name}`, expect(b, m, a), `lane ${b.lane}->${m.lane} y=${a.y.toFixed(2)} rollT=${a.rollT.toFixed(2)}`);
      await H.advance(page, 60);
    };
    await drag('left', -150, 0, (b, m) => m.lane === b.lane - 1);
    await drag('right', 150, 0, (b, m) => m.lane === b.lane + 1);
    await drag('up', 0, -150, (b, m, a) => a.y > 0.3);
    await drag('down', 0, 150, (b, m, a) => a.rollT > 0);
    // right-button drag must be ignored
    const b = await H.sim(page);
    await page.mouse.move(640, 400);
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(400, 400, { steps: 4 });
    await page.mouse.up({ button: 'right' });
    const a = await H.sim(page);
    check('right-button drag ignored', a.lane === b.lane, `lane ${b.lane}->${a.lane}`);
    await ctx.close();
  }

  console.log('\nSUMMARY', results.filter((r) => !r.ok).length, 'failures of', results.length);
  console.log('LOG:', log.length ? log.join('\n') : '(none)');
  await browser.close();
  srv.close();
})();
