// Menu / HUD / pause / game-over layout at several viewports.
const H = require('./helpers.cjs');

const VIEWPORTS = {
  desktop: { viewport: { width: 1280, height: 720 } },
  iphone13: { ...H.pw.devices['iPhone 13'] },
  iphone13land: { ...H.pw.devices['iPhone 13 landscape'] },
  android360: { viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, userAgent: H.pw.devices['Pixel 5'].userAgent },
  android640land: { viewport: { width: 640, height: 360 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, userAgent: H.pw.devices['Pixel 5'].userAgent },
  iphoneSE: { ...H.pw.devices['iPhone SE'] },
  // full-screen sizes from the task (e.g. installed PWA / browser chrome hidden)
  phone390x844: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, userAgent: H.pw.devices['iPhone 13'].userAgent },
  phone844x390: { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, userAgent: H.pw.devices['iPhone 13'].userAgent },
};

function layoutProbe() {
  const vis = (el) => el && getComputedStyle(el).display !== 'none' && el.offsetParent !== null;
  const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), b: Math.round(b.bottom), r: Math.round(b.right) }; };
  const out = { vw: innerWidth, vh: innerHeight, issues: [], boxes: {} };
  const ids = ['playBtn', 'againBtn', 'menuBtn', 'resumeBtn', 'quitBtn', 'pauseBtn', 'muteBtn', 'score', 'coinCount', 'hud', 'countdown', 'toast'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (vis(el) || (id === 'muteBtn' && el)) out.boxes[id] = r(el);
  }
  for (const p of document.querySelectorAll('.screen:not(.hidden) .panel')) {
    out.boxes.panel = r(p);
    out.panelScroll = { sh: p.scrollHeight, ch: p.clientHeight, sw: p.scrollWidth, cw: p.clientWidth };
    if (p.scrollHeight > p.clientHeight + 1) out.issues.push(`panel overflows vertically: scrollHeight ${p.scrollHeight} > clientHeight ${p.clientHeight} (content needs scrolling)`);
    if (p.scrollWidth > p.clientWidth + 1) out.issues.push(`panel overflows horizontally ${p.scrollWidth}>${p.clientWidth}`);
    // every visible descendant inside viewport and inside the panel's visible area
    const pb = p.getBoundingClientRect();
    for (const el of p.querySelectorAll('*')) {
      if (!vis(el)) continue;
      const b = el.getBoundingClientRect();
      if (b.width === 0 || b.height === 0) continue;
      if (b.bottom > pb.bottom + 1 || b.top < pb.top - 1) out.issues.push(`clipped inside panel: <${el.tagName.toLowerCase()} id=${el.id} class=${el.className}> "${(el.textContent || '').trim().slice(0, 30)}" top ${Math.round(b.top)} bottom ${Math.round(b.bottom)} vs panel ${Math.round(pb.top)}-${Math.round(pb.bottom)}`);
      if (b.right > innerWidth + 1 || b.left < -1 || b.bottom > innerHeight + 1 || b.top < -1) out.issues.push(`outside viewport: ${el.tagName} ${el.id} ${el.className}`);
    }
  }
  // mute button overlapping panel buttons?
  const mute = document.getElementById('muteBtn').getBoundingClientRect();
  for (const el of document.querySelectorAll('.screen:not(.hidden) button')) {
    const b = el.getBoundingClientRect();
    if (b.width && !(b.right <= mute.left || b.left >= mute.right || b.bottom <= mute.top || b.top >= mute.bottom)) out.issues.push(`muteBtn overlaps ${el.id}`);
  }
  // text that overflows its own box (e.g. logo)
  for (const el of document.querySelectorAll('.screen:not(.hidden) .panel *, #hud *')) {
    if (!vis(el)) continue;
    if (el.scrollWidth > el.clientWidth + 2 && getComputedStyle(el).overflow !== 'visible' && el.clientWidth > 0) out.issues.push(`text overflow in ${el.tagName}#${el.id}.${el.className}`);
  }
  // elements actually hit-testable at their centre (not covered by something else)
  for (const el of document.querySelectorAll('.screen:not(.hidden) button, #hud:not(.hidden) button, #muteBtn')) {
    const b = el.getBoundingClientRect();
    if (!b.width) continue;
    const cx = b.left + b.width / 2;
    const cy = b.top + b.height / 2;
    const hit = document.elementFromPoint(cx, cy);
    if (cy > innerHeight || cx > innerWidth) out.issues.push(`button ${el.id} centre off-screen (${Math.round(cx)},${Math.round(cy)})`);
    else if (!hit || !(hit === el || el.contains(hit))) out.issues.push(`button ${el.id} centre covered by ${hit && (hit.id || hit.className || hit.tagName)}`);
  }
  return out;
}

(async () => {
  const log = [];
  const { srv, url } = await H.serve();
  const browser = await H.launch();
  const results = {};
  for (const [name, opts] of Object.entries(VIEWPORTS)) {
    const { ctx, page } = await H.openGame(browser, url, opts, log, name);
    // seed a best score so the stats line has real numbers
    await page.evaluate(() => { localStorage.setItem('sr2-best', '123456'); localStorage.setItem('sr2-coins', '98765'); });
    await page.reload();
    await page.waitForFunction(() => window.__game && document.getElementById('loading').classList.contains('hidden'));
    await page.waitForTimeout(800);
    await H.freeze(page);
    await H.advance(page, 2);
    await page.waitForTimeout(100);
    results[name] = { menu: await page.evaluate(layoutProbe) };
    await H.shot(page, `qa/layout_${name}_menu`);

    // start and show HUD with powers active
    await page.evaluate(() => {
      const g = window.__game; g.start();
      g.sim.score = 1234567; g.sim.coins = 4321;
      for (const p of ['magnet', 'multiplier', 'sneakers', 'board']) g.sim._activate(p);
      g.sim.graceT = 999; // survive
    });
    await H.advance(page, 30);
    await H.render(page, true);
    await page.waitForTimeout(150);
    await H.shot(page, `qa/layout_${name}_hud_start`); // guard right behind at run start
    await H.advance(page, 150);
    await H.render(page, true);
    await page.waitForTimeout(200);
    results[name].hud = await page.evaluate(layoutProbe);
    await H.shot(page, `qa/layout_${name}_hud`);

    // pause
    await page.evaluate(() => window.__game.pause());
    await page.waitForTimeout(300);
    results[name].pause = await page.evaluate(layoutProbe);
    await H.shot(page, `qa/layout_${name}_pause`);

    // countdown
    await page.evaluate(() => window.__game.resume());
    await H.advance(page, 3);
    await page.waitForTimeout(100);
    results[name].countdown = await page.evaluate(layoutProbe);
    await H.shot(page, `qa/layout_${name}_countdown`);

    // game over with new best + long numbers
    await page.evaluate(() => {
      const g = window.__game; g.state = 'playing'; g.ui.showHud();
      g.sim.graceT = 0; g.sim.power.board = 0; g.sim.score = 9876543; g.sim._die('overhead');
    });
    await H.advance(page, 100);
    await page.waitForTimeout(300);
    results[name].over = await page.evaluate(layoutProbe);
    await H.shot(page, `qa/layout_${name}_over`);
    await ctx.close();
  }
  for (const [name, r] of Object.entries(results)) {
    console.log(`\n=== ${name} (${r.menu.vw}x${r.menu.vh})`);
    for (const [scr, o] of Object.entries(r)) {
      console.log(`  ${scr}: panel=${JSON.stringify(o.boxes.panel || null)} scroll=${JSON.stringify(o.panelScroll || null)}`);
      for (const i of o.issues) console.log(`    ISSUE: ${i}`);
      if (scr === 'menu') console.log('    boxes', JSON.stringify(o.boxes));
    }
  }
  console.log('\nLOG:', log.length ? log.join('\n') : '(none)');
  await browser.close();
  srv.close();
})();
