// Online duel, end to end with two real browser pages and a local PeerJS broker (no internet needed):
// room code -> join by link -> lockstep bout -> both machines hold the same state -> pause / rematch -> disconnect.
//
//   IRONECHO_STANDALONE=Build/Web/standalone NODE_PATH=<node_modules with playwright, peer> node Tests/Web/online_e2e.js
const { chromium } = require('playwright');
const { PeerServer } = require('peer');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PROJECT = path.resolve(__dirname, '..', '..');
const ROOT = process.env.IRONECHO_STANDALONE || path.join(PROJECT, 'Build', 'Web', 'standalone');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.json': 'application/json' };
const PORT = 8830 + Math.floor(Math.random() * 60);
const BROKER = PORT + 100;

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

async function open(browser, url) {
  const ctx = await browser.newContext({ viewport: { width: 800, height: 450 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.addInitScript((b) => { globalThis.IRONECHO_NET = { host: '127.0.0.1', port: b, path: '/', secure: false }; }, BROKER);
  await page.goto(url);
  await page.waitForFunction(() => globalThis.IRONECHO_APP && globalThis.IRONECHO_APP.loaded, null, { timeout: 240000 });
  if (await page.isVisible('[data-group="quality"] button[data-value="low"]')) await page.click('[data-group="quality"] button[data-value="low"]');
  return page;
}

// scripted inputs: [status, confidence, lean, leanForward, block, punchMask, kickMask, moveForward, moveSide, ctl]
const SCRIPT = `(() => { globalThis.IRONECHO_APP.testInput = (slot) => { const a = globalThis.__qa || {}; const out = a.next && a.next[slot] ? a.next[slot] : null;
  if (a.next) a.next[slot] = null; return out || [7, 1, 0, 0, 0, 0, 0, 0, 0, 0]; }; globalThis.__qa = { next: [null, null] }; })()`;

async function pump(pages, seconds, perStep = 0.05) {
  // interleave the two pages so their messages flow between the steps
  const steps = Math.round(seconds / perStep);
  for (let i = 0; i < steps; i++) {
    for (const p of pages) await p.evaluate((s) => globalThis.IRONECHO_APP.debugAdvance(s, () => ({ status: 7, lean: 0, block: 0, punchMask: 0 })), perStep);
    await sleep(8);
  }
}

const snap = (p) => p.evaluate(() => { const a = globalThis.IRONECHO_APP; const s = a.core.snapshot();
  return { phase: s.match.phaseName, mode: s.match.mode, frame: a.versus && a.versus.lock.frame, broken: a.versus && a.versus.broken,
    pThrown: s.player.thrown, oThrown: s.opponent.thrown, pHealth: s.player.health, oHealth: s.opponent.health, px: s.player.x, ox: s.opponent.x, slot: a.versus && a.versus.slot,
    hashes: a.versus ? [...a.versus.lock.hashes.entries()] : [] }; });
const queue = (p, slot, input) => p.evaluate(([s, i]) => { globalThis.__qa.next[s] = i; }, [slot, input]);

(async () => {
  if (!fs.existsSync(path.join(ROOT, 'index.html'))) throw new Error(`no build at ${ROOT}`);
  const broker = PeerServer({ port: BROKER, host: '127.0.0.1', path: '/', allow_discovery: false });
  const server = serve();
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const host = await open(browser, `http://127.0.0.1:${PORT}/`);
    await host.click('#to-online');
    await host.click('#on-create');
    await host.waitForFunction(() => !document.querySelector('#on-code').hidden && document.querySelector('#on-code-text').textContent.length === 6, null, { timeout: 30000 });
    const code = await host.textContent('#on-code-text');
    const link = await host.textContent('#on-link');
    check('host gets a 6-character room code and a link', /^[A-Z2-9]{6}$/.test(code) && link.includes(`?room=${code}`), `${code}`);

    const wrong = await open(browser, `http://127.0.0.1:${PORT}/`);
    await wrong.click('#to-online');
    await wrong.fill('#on-input', 'ZZZZZZ');
    await wrong.click('#on-join');
    await wrong.waitForFunction(() => /не найдена|не отвечает/.test(document.querySelector('#on-status').textContent), null, { timeout: 30000 });
    check('a wrong code says the room does not exist', true, await wrong.textContent('#on-status'));
    await wrong.context().close();

    const guest = await open(browser, `http://127.0.0.1:${PORT}/?room=${code}`);
    await host.waitForFunction(() => globalThis.IRONECHO_APP.versus && globalThis.IRONECHO_APP.versus.started, null, { timeout: 60000 });
    await guest.waitForFunction(() => globalThis.IRONECHO_APP.versus && globalThis.IRONECHO_APP.versus.started, null, { timeout: 60000 });
    for (const p of [host, guest]) await p.evaluate(SCRIPT);
    check('the guest joins by link and both start the duel (host slot 0, guest slot 1)', (await snap(host)).slot === 0 && (await snap(guest)).slot === 1);

    // both ready -> countdown -> fight
    for (let k = 0; k < 120; k++) {
      await pump([host, guest], 0.25);
      const [a, b] = [await snap(host), await snap(guest)];
      if (a.phase === 'Fighting' && b.phase === 'Fighting') break;
    }
    let a = await snap(host);
    let b = await snap(guest);
    check('both machines reach the fight', a.phase === 'Fighting' && b.phase === 'Fighting' && a.mode === 2 && b.mode === 2, `${a.phase}/${b.phase}`);

    // the host throws a jab and a kick, the guest a cross and a body shot
    await queue(host, 0, [7, 1, 0, 0, 0, 1, 0, 0, 0, 0]);
    await queue(guest, 1, [7, 1, 0, 0, 0, 2, 0, 0, 0, 0]);
    await pump([host, guest], 1.0);
    await queue(host, 0, [7, 1, 0, 0, 0, 0, 2, 0, 0, 0]);
    await queue(guest, 1, [7, 1, 0, 0, 0, 4, 0, 0, 0, 0]);
    await pump([host, guest], 2.0);
    a = await snap(host);
    b = await snap(guest);
    check('each human acts on both machines (host fighter throws 2, guest fighter throws 2 everywhere)', a.pThrown === 2 && b.pThrown === 2 && a.oThrown === 2 && b.oThrown === 2, `${a.pThrown}/${a.oThrown} ${b.pThrown}/${b.oThrown}`);

    // movement of the guest is mirrored in the host's world
    await queue(guest, 1, [7, 1, 0, 0, 0, 0, 0, 1, 0, 0]);
    for (let i = 0; i < 6; i++) { await queue(guest, 1, [7, 1, 0, 0, 0, 0, 0, -1, 1, 0]); await pump([host, guest], 0.3); }
    a = await snap(host);
    b = await snap(guest);
    check('both machines hold the very same positions and health', a.px === b.px && a.ox === b.ox && a.pHealth === b.pHealth && a.oHealth === b.oHealth, `${a.ox} vs ${b.ox}`);

    await pump([host, guest], 4.5);
    a = await snap(host);
    b = await snap(guest);
    const common = a.hashes.filter(([f, v]) => b.hashes.some(([g, w]) => g === f && w === v)).length;
    const differ = a.hashes.filter(([f, v]) => b.hashes.some(([g, w]) => g === f && w !== v)).length;
    check('the state hashes of the two machines agree, no desync flagged', !a.broken && !b.broken && differ === 0 && common >= 1, `${common} equal, ${differ} different, frame ${a.frame}/${b.frame}`);

    // pause by the guest pauses both; resume needs both ready
    await guest.evaluate(() => globalThis.IRONECHO_APP.versus.ctl |= 1);
    await pump([host, guest], 0.5);
    a = await snap(host);
    b = await snap(guest);
    check('a pause asked by either player pauses both', a.phase === 'Paused' && b.phase === 'Paused', `${a.phase}/${b.phase}`);
    await host.evaluate(() => globalThis.IRONECHO_APP.versus.ctl |= 2);
    for (let k = 0; k < 60; k++) { await pump([host, guest], 0.25); if ((await snap(host)).phase !== 'Paused') break; }
    a = await snap(host);
    check('the bout resumes through the ready check and a countdown', a.phase === 'Countdown' || a.phase === 'Fighting', a.phase);

    // rematch from the host
    await host.evaluate(() => globalThis.IRONECHO_APP.versus.ctl |= 4);
    await pump([host, guest], 0.5);
    a = await snap(host);
    b = await snap(guest);
    check('a rematch restarts both machines identically', a.phase === b.phase && a.pHealth === 100 && b.oHealth === 100 && a.pThrown === 0 && b.oThrown === 0, `${a.phase}/${b.phase}`);

    // disconnect: the guest leaves, the host is told
    await guest.context().close();
    await host.waitForFunction(() => !globalThis.IRONECHO_APP.versus || document.querySelector('#hud-banner, .banner') !== null, null, { timeout: 30000 }).catch(() => {});
    await sleep(3500);
    check('when the opponent disconnects the host is returned to the menu', await host.evaluate(() => !globalThis.IRONECHO_APP.versus && !document.querySelector('#menu').hidden));
    check('no page errors', !host.errors.length, host.errors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    server.close();
    broker.close && broker.close();
  }
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('online QA crashed:', e); process.exit(2); });
