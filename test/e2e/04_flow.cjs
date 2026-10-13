// Pause / resume / countdown / visibility / mute persistence / death flow / restarts.
const H = require('./helpers.cjs');

const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  -- ' + detail : ''}`);
}
const ui = (page) => page.evaluate(() => {
  const vis = (id) => !document.getElementById(id).classList.contains('hidden');
  return {
    state: window.__game.state, menu: vis('menu'), pause: vis('pauseScreen'), over: vis('over'), hud: vis('hud'),
    countdown: vis('countdown') ? document.getElementById('countdown').textContent : null,
    s: window.__game.sim.s,
  };
});

(async () => {
  const log = [];
  const { srv, url } = await H.serve();
  const browser = await H.launch();
  const desk = { viewport: { width: 1280, height: 720 } };

  // =============== pause / resume
  {
    const { ctx, page } = await H.openGame(browser, url, desk, log, 'pause');
    await H.freeze(page);
    await page.keyboard.press('Enter');
    await H.advance(page, 60);
    await page.keyboard.press('p');
    let u = await ui(page);
    check('P pauses', u.state === 'paused' && u.pause && u.hud, JSON.stringify(u));
    const s0 = u.s;
    await H.advance(page, 120);
    u = await ui(page);
    check('sim frozen while paused', u.s === s0, `s ${s0} -> ${u.s}`);
    await page.keyboard.press('ArrowLeft');
    check('input ignored while paused', (await H.sim(page)).lane === 1);
    await page.keyboard.press('p');
    u = await ui(page);
    check('P again resumes into countdown "3"', u.state === 'countdown' && u.countdown === '3' && !u.pause, JSON.stringify(u));
    const seen = new Set([u.countdown]);
    for (let i = 0; i < 40; i++) {
      await H.advance(page, 5);
      const v = await ui(page);
      if (v.countdown) seen.add(v.countdown);
      if (v.state === 'playing') break;
      if (v.s !== s0) { check('sim frozen during countdown', false, `s moved ${s0}->${v.s}`); break; }
    }
    u = await ui(page);
    check('countdown shows 3,2,1 then plays', [...seen].join(',') === '3,2,1' && u.state === 'playing' && u.countdown === null, `seen=${[...seen]} ${JSON.stringify(u)}`);
    // input during countdown
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    u = await ui(page);
    check('Escape pauses then resumes (toggle)', u.state === 'countdown', JSON.stringify(u));
    await page.keyboard.press('ArrowLeft');
    check('lane input ignored during countdown', (await H.sim(page)).lane === 1);
    // pause during countdown
    await H.advance(page, 30);
    await page.keyboard.press('p');
    u = await ui(page);
    check('pause during countdown -> paused, countdown hidden', u.state === 'paused' && u.pause && u.countdown === null, JSON.stringify(u));
    // resume via button, then Enter
    await page.click('#resumeBtn');
    u = await ui(page);
    check('RESUME button -> countdown 3', u.state === 'countdown' && u.countdown === '3', JSON.stringify(u));
    await page.keyboard.press('p');
    await page.keyboard.press('Enter');
    u = await ui(page);
    check('Enter while paused resumes', u.state === 'countdown', JSON.stringify(u));
    await H.advance(page, 200);
    // pause button
    await page.click('#pauseBtn');
    u = await ui(page);
    check('pause button pauses', u.state === 'paused' && u.pause, JSON.stringify(u));
    await H.shot(page, 'qa/flow_paused');
    // MAIN MENU from pause
    await page.click('#quitBtn');
    u = await ui(page);
    check('MAIN MENU from pause -> menu', u.state === 'menu' && u.menu && !u.hud && !u.pause, JSON.stringify(u));
    // visibility change
    await page.keyboard.press('Enter');
    await H.advance(page, 30);
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    u = await ui(page);
    check('tab hidden auto-pauses', u.state === 'paused' && u.pause, JSON.stringify(u));
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
      document.dispatchEvent(new Event('visibilitychange'));
    });
    u = await ui(page);
    check('tab visible again stays paused (user resumes)', u.state === 'paused', JSON.stringify(u));
    await page.keyboard.press('p');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      document.dispatchEvent(new Event('visibilitychange'));
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    });
    u = await ui(page);
    check('tab hidden during countdown pauses', u.state === 'paused', JSON.stringify(u));
    await page.keyboard.press('p');
    await H.advance(page, 200);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    u = await ui(page);
    check('window blur pauses', u.state === 'paused', JSON.stringify(u));
    // hidden on menu / over: nothing happens
    await page.click('#quitBtn');
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    u = await ui(page);
    check('blur on menu keeps menu', u.state === 'menu' && u.menu, JSON.stringify(u));
    await ctx.close();
  }

  // =============== mute
  {
    const { ctx, page } = await H.openGame(browser, url, desk, log, 'mute');
    await H.freeze(page);
    const m = () => page.evaluate(() => ({
      cls: document.getElementById('muteBtn').classList.contains('off'),
      ls: localStorage.getItem('sr2-muted'), audio: window.__game.audio.muted,
      label: document.getElementById('muteBtn').getAttribute('aria-label'), state: window.__game.state,
      gain: window.__game.audio.master ? window.__game.audio.master.gain.value : null,
    }));
    let v = await m();
    check('initially unmuted', !v.cls && !v.audio, JSON.stringify(v));
    await page.keyboard.press('m');
    v = await m();
    check('M mutes (class, aria, storage)', v.cls && v.audio && v.ls === '1' && v.label === 'Unmute', JSON.stringify(v));
    await page.reload();
    await page.waitForFunction(() => window.__game);
    await H.freeze(page);
    v = await m();
    check('mute persists across reload', v.cls && v.audio, JSON.stringify(v));
    await page.click('#muteBtn');
    v = await m();
    check('mute button unmutes, does not start game', !v.cls && !v.audio && v.ls === '0' && v.state === 'menu', JSON.stringify(v));
    const focus = await page.evaluate(() => document.activeElement && document.activeElement.id);
    check('mute button blurred after click', !focus, `active=${focus}`);
    await page.keyboard.press('Enter');
    await H.advance(page, 30);
    await page.click('#muteBtn');
    v = await m();
    const u = await ui(page);
    check('mute button during play mutes without pausing', v.cls && u.state === 'playing', JSON.stringify({ ...v, ...u }));
    await page.reload();
    await page.waitForFunction(() => window.__game);
    v = await m();
    check('muted state persists after reload (2)', v.cls && v.audio, JSON.stringify(v));
    // when muted and audio unlocked later the master gain must be 0
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    v = await m();
    check('muted at load -> master gain 0 after unlock', v.gain === 0, JSON.stringify(v));
    await page.keyboard.press('m');
    await page.waitForTimeout(300);
    v = await m();
    check('unmute after muted load restores gain', v.gain > 0.1, JSON.stringify(v));
    await ctx.close();
  }

  // =============== death flow, NEW BEST, persistence, buttons, restarts & leaks
  {
    const { ctx, page } = await H.openGame(browser, url, desk, log, 'death');
    await page.evaluate(() => localStorage.clear());
    await page.reload();
    await page.waitForFunction(() => window.__game);
    await H.freeze(page);
    await page.evaluate(() => {
      const g = window.__game;
      window.__over = 0;
      const o = g._gameOver.bind(g);
      g._gameOver = function () { window.__over++; return o(); };
      window.__states = [];
    });
    const runUntilDeath = (opts = {}) => page.evaluate((opts) => {
      const g = window.__game;
      const upd = g.__origUpdate;
      const states = [];
      let n = 0;
      while (g.state !== 'over' && n++ < 60 * 300) {
        if (opts.dodge === false) { /* stand still */ }
        upd.call(g, 1 / 60);
        if (states[states.length - 1] !== g.state) states.push(g.state);
      }
      // a few more frames on the over screen
      for (let i = 0; i < 120; i++) upd.call(g, 1 / 60);
      g.__origRender(g.scene, g.camera);
      const t = (id) => document.getElementById(id).textContent;
      return {
        states, frames: n, cause: g.sim.deathCause, score: Math.floor(g.sim.score), coins: g.sim.coins, dist: Math.floor(g.sim.s),
        ui: { cause: t('overCause'), score: t('overScore'), coins: t('overCoins'), dist: t('overDist'), best: t('overBest'), newBest: !document.getElementById('newBest').classList.contains('hidden') },
        overCalls: window.__over, best: g.best, lsBest: localStorage.getItem('sr2-best'), bank: localStorage.getItem('sr2-coins'),
      };
    }, opts);
    await page.keyboard.press('Enter');
    let r = await runUntilDeath();
    await H.shot(page, 'qa/flow_over_1');
    console.log(JSON.stringify(r));
    check('death: playing -> dying -> over', r.states.join(',') === 'playing,dying,over', r.states.join(','));
    check('game over fired exactly once', r.overCalls === 1, `calls=${r.overCalls}`);
    check('cause text shown', r.ui.cause.length > 5, `${r.cause}: "${r.ui.cause}"`);
    check('score/coins/distance/best shown correctly', r.ui.score === r.score.toLocaleString() && r.ui.coins === r.coins.toLocaleString() && r.ui.dist === `${r.dist.toLocaleString()} m` && r.ui.best === r.score.toLocaleString(), JSON.stringify(r.ui));
    check('NEW BEST on first game', r.ui.newBest, '');
    check('best saved to storage', Number(r.lsBest) === r.score, `ls=${r.lsBest}`);
    const best1 = r.score;
    const bank1 = Number(r.bank);
    check('coins banked', bank1 === r.coins, `bank=${r.bank}`);
    // Enter immediately after over is ignored (<0.6s), later restarts
    await page.evaluate(() => { window.__game.overAt = window.__game.time; });
    await page.keyboard.press('Enter');
    let u = await ui(page);
    check('Enter right after game over ignored', u.state === 'over', u.state);
    await H.advance(page, 60);
    // second game: die quickly to get a lower score -> no NEW BEST
    await page.click('#againBtn');
    u = await ui(page);
    check('PLAY AGAIN starts a run', u.state === 'playing' && u.hud && !u.over, JSON.stringify(u));
    await H.advance(page, 5);
    await page.evaluate(() => window.__game.sim._die('hurdle'));
    r = await runUntilDeath();
    await H.shot(page, 'qa/flow_over_2_lower');
    check('lower score: no NEW BEST, best unchanged', !r.ui.newBest && r.ui.best === best1.toLocaleString() && r.best === best1, JSON.stringify(r.ui));
    check('hurdle cause text', r.ui.cause.includes('barrier'), r.ui.cause);
    check('game over fired once per death', r.overCalls === 2, `calls=${r.overCalls}`);
    // MAIN MENU shows new best + bank
    await page.click('#menuBtn');
    const menu = await page.evaluate(() => ({ best: document.getElementById('bestMenu').textContent, bank: document.getElementById('bankMenu').textContent, state: window.__game.state }));
    check('MAIN MENU shows best and bank', menu.state === 'menu' && menu.best === best1.toLocaleString(), JSON.stringify(menu));
    // reload: best persists
    await page.reload();
    await page.waitForFunction(() => window.__game);
    const menu2 = await page.evaluate(() => ({ best: document.getElementById('bestMenu').textContent, bank: document.getElementById('bankMenu').textContent }));
    check('best + bank persist after reload', menu2.best === best1.toLocaleString(), JSON.stringify(menu2));
    // cause texts for every cause
    await H.freeze(page);
    await page.evaluate(() => {
      const g = window.__game;
      window.__over = 0;
      const o = g._gameOver.bind(g);
      g._gameOver = function () { window.__over++; return o(); };
    });
    for (const cause of ['train', 'overhead', 'caught']) {
      await page.evaluate(() => window.__game.start());
      await H.advance(page, 3);
      await page.evaluate((c) => window.__game.sim._die(c), cause);
      r = await runUntilDeath();
      check(`cause text for ${cause}`, r.ui.cause.length > 5, r.ui.cause);
    }
    // what happens if the player is caught: real double stumble
    await page.evaluate(() => window.__game.start());
    await H.advance(page, 3);
    await page.evaluate(() => { const s = window.__game.sim; s._stumble(); s.stumbleCool = 0; s._stumble(); });
    r = await runUntilDeath();
    await H.shot(page, 'qa/flow_over_caught');
    check('double stumble -> caught', r.cause === 'caught', r.cause);

    // =============== restart leak check
    const info = () => page.evaluate(() => {
      const g = window.__game; const i = g.renderer.info;
      return { geos: i.memory.geometries, tex: i.memory.textures, children: g.scene.children.length, views: g.views.size, pool: g.coinPool.length, flying: g.flying.length, progs: (i.programs || []).length, heap: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1e6) : null };
    });
    const samples = [];
    for (let k = 0; k < 14; k++) {
      await page.evaluate(() => window.__game.start());
      // run ~25s of game time with invulnerability, picking up power-ups along the way
      await page.evaluate(() => {
        const g = window.__game; const upd = g.__origUpdate;
        for (let i = 0; i < 60 * 25; i++) { g.sim.graceT = 5; upd.call(g, 1 / 60); }
        if (Math.random() < 0.5) g.sim._activate('jetpack');
        g.sim._activate('board');
        for (let i = 0; i < 60 * 3; i++) upd.call(g, 1 / 60);
        g.sim.graceT = 0; g.sim.power.board = 0; g.sim.power.jetpack = 0; g.sim._die('train');
        for (let i = 0; i < 200; i++) upd.call(g, 1 / 60);
        g.__origRender(g.scene, g.camera);
      });
      samples.push(await info());
      if (k % 3 === 0) { await page.click('#menuBtn'); await H.advance(page, 2); }
    }
    console.log('restart samples', samples.map((s) => JSON.stringify(s)).join('\n'));
    const first = samples[1]; const last = samples[samples.length - 1];
    check('geometries bounded across restarts', last.geos <= first.geos + 5, `${first.geos} -> ${last.geos}`);
    check('textures bounded across restarts', last.tex <= first.tex + 2, `${first.tex} -> ${last.tex}`);
    check('scene children bounded across restarts', last.children <= first.children + 40, `${first.children} -> ${last.children}`);
    check('coin pool bounded', last.pool < 400, `pool=${last.pool}`);
    await ctx.close();
  }

  console.log('\nSUMMARY', results.filter((r) => !r.ok).length, 'failures of', results.length);
  console.log('LOG:', log.length ? log.join('\n') : '(none)');
  await browser.close();
  srv.close();
})();
