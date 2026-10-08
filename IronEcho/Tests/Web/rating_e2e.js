// Rating in the real page: nickname, a rated bout, the table, leaving a bout, and the server code (the very file the website runs) answering
// through intercepted requests. In-memory store instead of the database, real WebAssembly core for the replay.
//
//   IRONECHO_STANDALONE=Build/Web/standalone NODE_PATH=<node_modules with playwright> node Tests/Web/rating_e2e.js
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const PROJECT = path.resolve(__dirname, '..', '..');
const ROOT = process.env.IRONECHO_STANDALONE || path.join(PROJECT, 'Build', 'Web', 'standalone');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.json': 'application/json' };
const PORT = 8890 + Math.floor(Math.random() * 60);
const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve() {
  return http.createServer((req, res) => {
    let p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    res.end(fs.readFileSync(p));
  }).listen(PORT);
}

const PLAYER = `(() => { let i = 0, reactAt = -1, defend = false, last = '', next = 60, seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return () => { i++; const app = globalThis.IRONECHO_APP; const s = app.core.snapshot(); const o = s.opponent; const p = s.player;
    const atk = o.stateName === 'Attack' ? o.stageName : '';
    if (atk === 'Windup' && last !== 'Windup') { reactAt = i + Math.round(24 * (0.85 + 0.3 * rnd())); defend = rnd() < 0.7; }
    last = atk; if (o.stateName !== 'Attack') reactAt = -1;
    const block = o.stateName === 'Attack' && reactAt > 0 && i >= reactAt && defend ? 1 : 0; let punchMask = 0;
    if (!block && i >= next && p.stamina > 30) { punchMask = rnd() < 0.7 ? 1 : 2; next = i + Math.round(60 * (0.8 + 0.8 * rnd())); }
    return { status: 7, lean: 0, block, punchMask }; }; })()`;

(async () => {
  if (!fs.existsSync(path.join(ROOT, 'index.html'))) throw new Error(`no build at ${ROOT}`);
  const wasm = path.join(PROJECT, 'Build', 'Web', 'core', 'ironecho_core.wasm');
  const b64 = fs.readFileSync(wasm).toString('base64');
  globalThis.IRONECHO_CORE_WASM_B64 = b64;
  const SRC = path.join(PROJECT, 'Tools', 'Build', 'Web', 'site', 'src');
  const API = path.join(PROJECT, 'Tools', 'Build', 'Web', 'api');
  const { loadCore } = await import(pathToFileURL(path.join(SRC, 'core.js')));
  const { ratingCoreId } = await import(pathToFileURL(path.join(SRC, 'rating.js')));
  const { createRatingApi } = await import(pathToFileURL(path.join(API, 'rating_api.mjs')));
  const { MemoryStore } = await import(pathToFileURL(path.join(API, 'rating_store.mjs')));
  let clock = Date.now();
  const api = createRatingApi({ store: new MemoryStore(), coreIds: new Set([ratingCoreId(b64)]), now: () => clock, loadCore: async () => loadCore() });
  const calls = [];

  const server = serve();
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, x-player-id, x-player-secret', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
  const open = async () => {
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const page = await ctx.newPage();
    page.errors = [];
    page.on('pageerror', (e) => page.errors.push(e.message));
    await page.addInitScript(() => { globalThis.IRONECHO_FORCE_NICK_PROMPT = true; }); // automated browsers are normally not asked for a nickname
    await page.route('**/api/ratings**', async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: CORS }); return; }
      const u = new URL(req.url());
      const body = req.postDataBuffer() || Buffer.alloc(0);
      const out = await api({ method: req.method(), query: Object.fromEntries(u.searchParams), headers: req.headers(), body });
      calls.push(`${req.method()} ${u.searchParams.get('op') || 'board'} -> ${out.status} ${out.json.error || out.json.result || 'ok'}`);
      await route.fulfill({ status: out.status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(out.json) });
    });
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => globalThis.IRONECHO_APP && globalThis.IRONECHO_APP.loaded, null, { timeout: 240000 });
    await page.click('[data-group="quality"] button[data-value="low"]');
    await page.evaluate(() => { globalThis.IRONECHO_APP.frozen = true; }); // no idle rendering: the test steps the game itself
    return page;
  };

  try {
    const A = await open();
    check('the menu offers a nickname field and the table', await A.isVisible('#nick') && await A.isVisible('#to-rating'));
    check('without a nickname the page says so', /Без ника/.test(await A.textContent('#nick-note')));
    // pressing the ring button without a nickname asks for one (once)
    await A.click(`[data-group="mode"] button[data-value="short"]`);
    await A.click(`[data-group="level"] button[data-value="0"]`);
    await A.click('#start');
    check('"В РИНГ" without a nickname first asks for one', await A.evaluate(() => globalThis.IRONECHO_APP.state === 'menu' && document.querySelector('#profile').classList.contains('flash')));

    await A.fill('#nick', 'x');
    await A.click('#nick-ok');
    check('a too short nickname is refused', /3–16/.test(await A.textContent('#nick-note')));
    await A.fill('#nick', 'Адёка');
    await A.click('#nick-ok');
    await A.waitForFunction(() => /Ник твой/.test(document.querySelector('#nick-note').textContent), null, { timeout: 15000 });
    check('a free nickname is taken', true, await A.textContent('#nick-note'));

    const B = await open();
    await B.fill('#nick', 'Aдёка'); // Latin A
    await B.click('#nick-ok');
    await B.waitForFunction(() => /занят/.test(document.querySelector('#nick-note').textContent), null, { timeout: 15000 })
      .catch(async (e) => { console.log('B note:', await B.textContent('#nick-note'), '| calls:', calls.join(' | '), '| errors:', B.errors.join(' | ')); throw e; });
    check('the same nickname (even with look-alike letters) is refused to another player', true, await B.textContent('#nick-note'));
    await B.context().close();

    // a rated bout against Easy, played to the end
    await A.click('#start');
    const r = await A.evaluate((src) => {
      const app = globalThis.IRONECHO_APP; const fn = eval(src);
      const rated = !!app.rated;
      for (let k = 0; k < 200 && app.state !== 'results'; k++) app.debugAdvance(5, fn);
      const m = app.core.snapshot().match;
      return { rated, state: app.state, phase: m.phaseName, rows: app.rated ? 0 : -1 };
    }, PLAYER);
    check('the bout is recorded for rating and reaches the results', r.rated && r.state === 'results' && r.phase === 'MatchOver', JSON.stringify(r));
    await A.waitForFunction(() => /место/.test(document.querySelector('#res-rating').textContent), null, { timeout: 60000 });
    const line = await A.textContent('#res-rating');
    check('the result card shows the rating, the change and the place', /Рейтинг/.test(line) && /[+-]?\d/.test(line) && /место 1 из 1/.test(line), line);

    await A.click('#res-menu');
    await A.click('#to-rating');
    await A.waitForFunction(() => document.querySelectorAll('#rt-table tbody tr').length === 1, null, { timeout: 15000 });
    const row = await A.textContent('#rt-table tbody tr');
    check('the table lists the player', /Адёка/.test(row) && await A.evaluate(() => document.querySelector('#rt-table tr.me') !== null), row);
    check('the player\'s own line is under the table', /Ты: Адёка/.test(await A.textContent('#rt-me')), await A.textContent('#rt-me'));
    await A.click('[data-group="ladder"] button[data-value="camera"]');
    await A.waitForFunction(() => /Пока никого/.test(document.querySelector('#rt-table').textContent), null, { timeout: 15000 });
    check('the camera table is separate and empty', true);
    check('the profile code can be taken', await A.evaluate(() => globalThis.IRONECHO_APP.rating.exportCode().split('.').length >= 3));
    await A.click('#rt-back');

    // leaving a bout half way is a loss
    clock += 20000;
    const before = await A.evaluate(async () => (await globalThis.IRONECHO_APP.rating.board('keys', 5)).me.rating);
    await A.click('#start');
    await A.evaluate(() => { const app = globalThis.IRONECHO_APP; app.debugAdvance(6); });
    const marker = await A.evaluate(() => localStorage.getItem('ironecho.pending'));
    check('after the first bell the bout is marked as begun (a closed tab still costs the loss)', !!marker && JSON.parse(marker).level === 0, marker);
    clock += 20000;
    await A.click('#pause-btn');
    await A.click('#to-menu');
    await A.waitForFunction(() => /оставлен/.test(document.querySelector('#nick-note').textContent), null, { timeout: 15000 });
    const after = await A.evaluate(async () => (await globalThis.IRONECHO_APP.rating.board('keys', 5)).me.rating);
    check('leaving a bout is rated as a loss', after < before, `${before} -> ${after}; ${await A.textContent('#nick-note')}`);
    check('the marker is cleared', await A.evaluate(() => localStorage.getItem('ironecho.pending') === null));

    // closing the tab: the next start settles it
    clock += 20000;
    await A.click('#start');
    await A.evaluate(() => { globalThis.IRONECHO_APP.debugAdvance(6); });
    const A2 = await (async () => {
      const state = await A.context().storageState();
      await A.close();
      const ctx = await browser.newContext({ viewport: { width: 960, height: 540 }, storageState: state });
      const page = await ctx.newPage();
      page.errors = [];
      page.on('pageerror', (e) => page.errors.push(e.message));
      await page.route('**/api/ratings**', async (route) => {
        const req = route.request();
        if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: CORS }); return; }
        const u = new URL(req.url());
        const out = await api({ method: req.method(), query: Object.fromEntries(u.searchParams), headers: req.headers(), body: req.postDataBuffer() || Buffer.alloc(0) });
        calls.push(`${req.method()} ${u.searchParams.get('op') || 'board'} -> ${out.status} ${out.json.error || out.json.result || 'ok'}`);
        await route.fulfill({ status: out.status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(out.json) });
      });
      clock += 20000;
      await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
      await page.waitForFunction(() => globalThis.IRONECHO_APP && globalThis.IRONECHO_APP.loaded, null, { timeout: 240000 });
      await page.evaluate(() => { globalThis.IRONECHO_APP.frozen = true; });
      return page;
    })();
    await A2.waitForFunction(() => /Прошлый бой был оставлен/.test(document.querySelector('#nick-note').textContent), null, { timeout: 20000 });
    check('a bout abandoned by closing the tab is settled as a loss at the next start', true, await A2.textContent('#nick-note'));
    check('the nickname is remembered', (await A2.inputValue('#nick')) === 'Адёка');
    check('no page errors', !A2.errors.length, A2.errors.slice(0, 3).join(' | '));
    console.log('      server calls:', calls.join(' | '));
  } finally {
    await browser.close();
    server.close();
  }
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('rating QA crashed:', e); process.exit(2); });
