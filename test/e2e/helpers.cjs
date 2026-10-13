// Shared helpers for the Playwright play-tests.
// Usage: node test/e2e/<script>.cjs  (screenshots go to $SHOTS or ./test/e2e/shots)
const http = require('http');
const fs = require('fs');
const path = require('path');

const pw = require('/opt/node22/lib/node_modules/playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const SHOTS = process.env.SHOTS || path.join(__dirname, 'shots');
fs.mkdirSync(SHOTS, { recursive: true });

const TYPES = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.png': 'image/png', '.svg': 'image/svg+xml',
};

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      let p = decodeURIComponent(req.url.split('?')[0]);
      if (p.endsWith('/')) p += 'index.html';
      const f = path.join(ROOT, p);
      if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
        res.writeHead(404);
        res.end('nf');
        return;
      }
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    srv.listen(0, '127.0.0.1', () => resolve({ srv, url: `http://127.0.0.1:${srv.address().port}/` }));
  });
}

const GL_ARGS = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'];

async function launch() {
  return pw.chromium.launch({ headless: true, args: GL_ARGS });
}

// Attach console/pageerror collectors to a page.
function collect(page, log, tag) {
  page.on('console', (m) => {
    const t = m.type();
    if (t === 'error' || t === 'warning' || t === 'warn') log.push(`[${tag}] console.${t}: ${m.text()}`);
  });
  page.on('pageerror', (e) => log.push(`[${tag}] pageerror: ${e.message}\n${e.stack || ''}`));
  page.on('requestfailed', (r) => log.push(`[${tag}] requestfailed: ${r.url()} ${r.failure() && r.failure().errorText}`));
  page.on('crash', () => log.push(`[${tag}] PAGE CRASH`));
}

async function openGame(browser, url, ctxOpts = {}, log = [], tag = 'page') {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  collect(page, log, tag);
  await page.goto(url);
  await page.waitForFunction(() => window.__game && document.getElementById('loading').classList.contains('hidden'));
  // let a few frames render
  await page.waitForTimeout(600);
  return { ctx, page };
}

// Freeze / unfreeze the game's own rAF loop. While frozen neither update nor
// render run from rAF (headless swiftshader is ~2 fps), and the test drives the
// game with advance(), which runs the real Game._update and renders once.
async function freeze(page, on = true) {
  await page.evaluate((on) => {
    const g = window.__game;
    if (!g.__origUpdate) {
      g.__origUpdate = g._update;
      g.__origRender = g.renderer.render.bind(g.renderer);
      g._update = function (dt) { if (!window.__frozen) g.__origUpdate.call(g, dt); };
      g.renderer.render = function (s, c) { if (!window.__frozen) g.__origRender(s, c); };
    }
    window.__frozen = on;
  }, on);
}

// Advance the game deterministically by n fixed steps of dt (runs the real _update).
async function advance(page, n, dt = 1 / 60) {
  return page.evaluate(({ n, dt }) => {
    const g = window.__game;
    const upd = g.__origUpdate || g._update;
    for (let i = 0; i < n; i++) upd.call(g, dt);
    (g.__origRender || g.renderer.render.bind(g.renderer))(g.scene, g.camera);
    return { state: g.state, s: g.sim.s, alive: g.sim.alive };
  }, { n, dt });
}

async function shot(page, name) {
  const p = path.join(SHOTS, name + '.png');
  await page.screenshot({ path: p });
  return p;
}

function sim(page) {
  return page.evaluate(() => {
    const s = window.__game.sim;
    return {
      state: window.__game.state, s: s.s, x: s.x, y: s.y, lane: s.lane, vy: s.vy, rollT: s.rollT,
      alive: s.alive, cause: s.deathCause, coins: s.coins, score: s.score, grounded: s.grounded,
      power: { ...s.power }, graceT: s.graceT, stumbleT: s.stumbleT,
    };
  });
}

module.exports = { pw, serve, launch, openGame, freeze, advance, shot, sim, collect, SHOTS, ROOT, GL_ARGS };
