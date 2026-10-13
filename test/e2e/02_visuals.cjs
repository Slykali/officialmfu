// Visual correctness: builds controlled scenes through __game.sim internals and
// screenshots them from the game camera and from debug cameras.
const H = require('./helpers.cjs');

// Installed in the page: helpers to build a scene.
function installTools() {
  const g = window.__game;
  window.__T = {
    clear() {
      const s = g.sim;
      for (const arr of [s.trains, s.barriers, s.coinItems, s.powers]) {
        for (const it of arr) s.removed.push(it);
        arr.length = 0;
      }
      s.gen.cursor = 1e9; // stop the generator
      g._syncAdded();
    },
    add(it) {
      const s = g.sim;
      it.id = it.id || 100000 + Math.floor(Math.random() * 1e6);
      if (it.kind === 'train') {
        Object.assign(it, { len: it.cars * 14, moving: !!it.moving, k: it.moving ? 0.55 : 0, R: it.moving ? 75 : 0, livery: it.livery ?? 1, ramp: !!it.ramp });
        s.trains.push(it);
      } else if (it.kind === 'coin') s.coinItems.push(it);
      else if (it.kind === 'power') { it.y = it.y ?? 1.2; s.powers.push(it); } else s.barriers.push(it);
      s.added.push(it);
      g._syncAdded();
      return it;
    },
    // render from an arbitrary debug camera
    debugCam(pos, look) {
      const THREE = g.camera.constructor; // PerspectiveCamera class
      const cam = new THREE(50, g.camera.aspect, 0.1, 400);
      cam.position.set(...pos);
      cam.lookAt(...look);
      (g.__origRender || g.renderer.render.bind(g.renderer))(g.scene, cam);
    },
    noGuard() { g.guardGap = 30; g.runStart = -100; },
    info() {
      const i = g.renderer.info;
      return { calls: i.render.calls, tris: i.render.triangles, geos: i.memory.geometries, tex: i.memory.textures, children: g.scene.children.length };
    },
  };
}

(async () => {
  const log = [];
  const { srv, url } = await H.serve();
  const browser = await H.launch();
  const { ctx, page } = await H.openGame(browser, url, { viewport: { width: 1280, height: 720 } }, log, 'vis');
  await H.freeze(page);
  await page.evaluate(installTools);
  const snap = async (name) => { await page.waitForTimeout(150); return H.shot(page, 'qa/vis_' + name); };

  // ---------- A: clean run, runner visible, no guard, objects ahead
  await page.evaluate(() => { window.__game.start(); });
  await H.advance(page, 130); // past the guard intro
  await page.evaluate(() => {
    const g = window.__game; const s = g.sim.s;
    __T.clear(); __T.noGuard();
    __T.add({ kind: 'train', lane: 0, s: s + 22, cars: 2, livery: 0 });
    __T.add({ kind: 'train', lane: 2, s: s + 26, cars: 1, ramp: true, livery: 3 });
    __T.add({ kind: 'hurdle', lane: 1, s: s + 12 });
    __T.add({ kind: 'overhead', lane: 1, s: s + 24 });
    for (let k = 0; k < 4; k++) __T.add({ kind: 'coin', lane: 1, s: s + 5 + k * 2.4, y: 1.0 });
    __T.add({ kind: 'power', lane: 0, s: s + 9, type: 'jetpack' });
  });
  await H.advance(page, 1);
  await snap('A_run_objects');
  // debug: side view of the ramp + train (from +x side, slightly above)
  await page.evaluate(() => { const s = window.__game.sim.s; __T.debugCam([14, 4, -(s + 22)], [2.5, 2, -(s + 26)]); });
  await snap('A_debug_side_ramp');
  // debug: close front view of the static train in lane 0 and the hurdle/overhead
  await page.evaluate(() => { const s = window.__game.sim.s; __T.debugCam([-1.5, 2.2, -(s + 8)], [-1, 1.6, -(s + 22)]); });
  await snap('A_debug_front_train');
  await page.evaluate(() => { const s = window.__game.sim.s; __T.debugCam([1.5, 1.4, -(s + 6)], [0, 1.0, -(s + 12)]); });
  await snap('A_debug_hurdle_close');
  await page.evaluate(() => { const s = window.__game.sim.s; __T.debugCam([1.8, 1.0, -(s + 18)], [0, 2.0, -(s + 24)]); });
  await snap('A_debug_overhead_close');
  // ramp from the runner's lane low angle
  await page.evaluate(() => { const s = window.__game.sim.s; __T.debugCam([2.5, 1.5, -(s + 6)], [2.5, 2, -(s + 26)]); });
  await snap('A_debug_ramp_front');
  // behind/above the train, look back toward the player: rear end texture
  await page.evaluate(() => { const s = window.__game.sim.s; __T.debugCam([-2.5, 6, -(s + 70)], [-2.5, 2, -(s + 40)]); });
  await snap('A_debug_train_rear');
  // runner close-up from the front
  await page.evaluate(() => { const g = window.__game; const s = g.sim.s; __T.debugCam([1.2, 1.4, -(s + 3.5)], [0, 1.0, -s]); });
  await snap('A_debug_runner_front');

  // ---------- B: jump over the hurdle (mid air), roll under the overhead
  // hurdle is at s0+12: jump when it is ~4 ahead
  await page.evaluate(() => { const g = window.__game; window.__s0 = g.sim.s; });
  await page.evaluate(() => { const g = window.__game; while (g.sim.s < window.__s0 + 8) g.__origUpdate.call(g, 1 / 60); g.sim.jump(); });
  await H.advance(page, 16);
  await snap('B_jump_midair');
  // overhead at s0+24: roll when ~4 ahead
  await page.evaluate(() => { const g = window.__game; while (g.sim.s < window.__s0 + 19.5) g.__origUpdate.call(g, 1 / 60); g.sim.down(); });
  await H.advance(page, 16);
  await snap('B_roll');
  console.log('after jump/roll', JSON.stringify(await H.sim(page)));
  await H.advance(page, 30);
  console.log('after passing overhead', JSON.stringify(await H.sim(page)));

  // ---------- C: on a train roof with coins on it (use a ramp)
  await page.evaluate(() => { window.__game.start(); });
  await H.advance(page, 130);
  await page.evaluate(() => {
    const g = window.__game; const s = g.sim.s;
    __T.clear(); __T.noGuard();
    g.sim.lane = 1; g.sim.x = 0;
    __T.add({ kind: 'train', lane: 1, s: s + 12, cars: 3, ramp: true, livery: 2 });
    __T.add({ kind: 'train', lane: 0, s: s + 20, cars: 2, livery: 1 });
    __T.add({ kind: 'train', lane: 2, s: s + 30, cars: 2, livery: 0, moving: true });
    for (let k = 0; k < 20; k++) {
      const cs = s + 4 + k * 2.4;
      const surf = window.__game.sim._surface(0, cs);
      __T.add({ kind: 'coin', lane: 1, s: cs, y: surf + 1.0 });
    }
  });
  await H.advance(page, 22);
  await snap('C_up_ramp');
  await H.advance(page, 30);
  await snap('C_on_roof');
  console.log('on roof', JSON.stringify(await H.sim(page)));

  // ---------- D: jetpack flight with sky coins
  await page.evaluate(() => { window.__game.start(); });
  await H.advance(page, 130);
  await page.evaluate(() => {
    const g = window.__game; const s = g.sim.s;
    __T.clear(); __T.noGuard();
    g.sim.gen = new g.sim.gen.constructor(7); g.sim.gen.cursor = s + 40; // natural level ahead
    g.sim._activate('jetpack');
  });
  await H.advance(page, 120);
  await snap('D_jetpack');
  console.log('jetpack', JSON.stringify(await H.sim(page)));
  // jetpack ending -> landing
  await page.evaluate(() => { window.__game.sim.power.jetpack = 0.05; });
  await H.advance(page, 20);
  await snap('D_jetpack_falling');
  await H.advance(page, 60);
  await snap('D_after_landing');
  console.log('after jetpack', JSON.stringify(await H.sim(page)));

  // ---------- E: hoverboard
  await page.evaluate(() => { window.__game.start(); });
  await H.advance(page, 130);
  await page.evaluate(() => {
    const g = window.__game; const s = g.sim.s;
    __T.clear(); __T.noGuard();
    g.sim.graceT = 0; g.sim.y = 0;
    g.sim._activate('board');
    __T.add({ kind: 'hurdle', lane: g.sim.lane, s: s + 14 });
  });
  await H.advance(page, 30);
  await snap('E_hoverboard');
  await page.evaluate(() => { const g = window.__game; const s = g.sim.s; __T.debugCam([2.2, 1.2, -(s - 2.5)], [g.sim.x, 0.7, -s]); });
  await snap('E_debug_board_side');
  await H.advance(page, 30);
  await snap('E_board_smash');
  console.log('board smash', JSON.stringify(await H.sim(page)));

  // ---------- F: guard at run start, stumble
  await page.evaluate(() => { window.__game.start(); });
  await H.advance(page, 40);
  await snap('F_guard_start');
  // stumble against a train side
  await page.evaluate(() => {
    const g = window.__game; const s = g.sim.s;
    __T.clear();
    __T.add({ kind: 'train', lane: 0, s: s + 2, cars: 2, livery: 1 });
  });
  await H.advance(page, 20);
  await page.evaluate(() => { window.__game.sim.left(); });
  await H.advance(page, 20);
  await snap('F_stumble_guard');
  console.log('stumble', JSON.stringify(await H.sim(page)));

  // ---------- G: power-up sprites on the track, all five
  await page.evaluate(() => { window.__game.start(); });
  await H.advance(page, 130);
  await page.evaluate(() => {
    const g = window.__game; const s = g.sim.s;
    __T.clear(); __T.noGuard();
    const types = ['magnet', 'multiplier', 'sneakers', 'jetpack', 'board'];
    types.forEach((t, i) => __T.add({ kind: 'power', lane: i % 3, s: s + 8 + i * 3, type: t }));
  });
  await H.advance(page, 1);
  await snap('G_powerups');

  // ---------- H: moving train approaching in the player's lane, then crash
  await page.evaluate(() => {
    const g = window.__game; const s = g.sim.s;
    __T.clear(); __T.noGuard();
    __T.add({ kind: 'train', lane: g.sim.lane, s: s + 45, cars: 2, moving: true, livery: 4 });
  });
  await H.advance(page, 20);
  await snap('H_moving_train');
  await H.advance(page, 60);
  await snap('H_moving_train_close');
  let st = await H.advance(page, 100);
  await snap('H_crash_dying');
  console.log('moving crash', JSON.stringify(await H.sim(page)), st);

  console.log('info', JSON.stringify(await page.evaluate(() => __T.info())));
  console.log('\nLOG:', log.length ? log.join('\n') : '(none)');
  await browser.close();
  srv.close();
})();
