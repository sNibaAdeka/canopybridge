// Second camera, end to end with real browser pages and a local PeerJS broker (no internet needed):
//   1. webcam + one phone: the game opens a room and shows the QR/link, the "phone" page (site/phone.template.html) calls it
//      over WebRTC, the game runs pose tracking on both streams and fuses them; the phone leaving is noticed;
//   2. two phones instead of the webcam: slot 1 is the main camera, slot 2 the second one.
// The browsers use Chromium's fake camera (a moving test pattern: no person, so the check is the transport, the frame
// loop and the plumbing; the fusion maths is checked by Tools/Build/Web/check/check_fusion.mjs).
//
//   IRONECHO_STANDALONE=Build/Web/standalone NODE_PATH=<node_modules with playwright, peer> node Tests/Web/camera2_e2e.js
const { chromium } = require('playwright');
const { PeerServer } = require('peer');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PROJECT = path.resolve(__dirname, '..', '..');
const ROOT = process.env.IRONECHO_STANDALONE || path.join(PROJECT, 'Build', 'Web', 'standalone');
const PHONE_TEMPLATE = path.join(PROJECT, 'Tools', 'Build', 'Web', 'site', 'phone.template.html');
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.json': 'application/json', '.task': 'application/octet-stream' };
const PORT = 8730 + Math.floor(Math.random() * 60);
const BROKER = PORT + 100;

const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function serve() {
  return http.createServer((req, res) => {
    const url = req.url.split('?')[0];
    if (url === '/phone/' || url === '/phone') { // the phone page, as the public site serves it
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(fs.readFileSync(PHONE_TEMPLATE, 'utf8').replace('@@PEERJS@@', '/vendor/peerjs/peerjs.min.js'));
      return;
    }
    let p = path.join(ROOT, decodeURIComponent(url));
    if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    res.end(fs.readFileSync(p));
  }).listen(PORT);
}

const NET_INIT = (b) => { globalThis.IRONECHO_NET = { host: '127.0.0.1', port: b, path: '/', secure: false }; };

async function openGame(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1000, height: 560 } });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' || process.env.IRONECHO_DEBUG) console.log(`  [game ${m.type()}] ${m.text().slice(0, 300)}`); });
  await page.addInitScript(NET_INIT, BROKER);
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => globalThis.IRONECHO_APP && globalThis.IRONECHO_APP.loaded, null, { timeout: 240000 });
  await page.evaluate((origin) => { globalThis.IRONECHO_DEPS.phonePage = `${origin}/phone/`; }, `http://127.0.0.1:${PORT}`);
  await page.click('[data-group="quality"] button[data-value="low"]');
  return page;
}

async function phonePage(browser, url) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  await page.addInitScript(NET_INIT, BROKER);
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.click('#go');
  await page.waitForFunction(() => document.querySelector('#st').classList.contains('ok'), null, { timeout: 90000 });
  return page;
}

const camState = (g) => g.evaluate(() => {
  const c = globalThis.IRONECHO_APP.cameraInput;
  if (!c) return null;
  const taps = Object.fromEntries(Object.entries(c.taps).map(([k, t]) => [k, { fps: t.fps, active: t.active, infer: t.inferMs, total: t.total }]));
  const f = c.fusion;
  return { second: c.second, streams: Object.keys(c.streams), taps, fusion: f ? { a: f.a.length, b: f.b.length, aliveA: f.aliveA, aliveB: f.aliveB, mode: f.info.mode } : null,
    quality: c.quality };
});

async function startCamera(g, second) {
  await g.click('[data-group="control"] button[data-value="camera"]');
  await g.click(`[data-group="camera2"] button[data-value="${second}"]`);
  await g.click('#start');
  await g.waitForSelector('#cam-link', { timeout: 180000 });
  await g.waitForFunction(() => document.querySelector('#cam-link .pp-ph small').textContent.includes('cam='), null, { timeout: 60000 });
  return g.textContent('#cam-link .pp-ph small');
}

(async () => {
  if (!fs.existsSync(path.join(ROOT, 'index.html'))) throw new Error(`no build at ${ROOT}`);
  const broker = PeerServer({ port: BROKER, host: '127.0.0.1', path: '/', allow_discovery: false });
  const server = serve();
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    // ---- 1. webcam + one phone
    const game = await openGame(browser);
    check('the second-camera menu is offered with the webcam mode', await (async () => {
      await game.click('[data-group="control"] button[data-value="camera"]');
      return game.isVisible('[data-group="camera2"]');
    })());
    const link = await startCamera(game, 'phone');
    check('the game shows a pairing link with a room code and slot 1', /\/phone\/\?cam=[A-Z2-9]{6}&slot=1$/.test(link.trim()), link.trim());
    check('the pairing panel has a QR code', await game.isVisible('#cam-link .pp-qr img'));
    // with a second camera chosen the fight waits (calibration has not begun) until the phone is found and matched
    const held = await game.evaluate(() => { const app = globalThis.IRONECHO_APP; const r = app.debugAdvance(4, () => app.currentInput()); return { phase: r.phase, status: app.currentInput().status, hold: app.cameraInput.hold }; });
    check('the fight waits for the second camera (no countdown, calibration not started)', held.hold === true && held.status === 6 && held.phase === 'WaitingForPlayer', JSON.stringify(held));
    const phone1 = await phonePage(browser, link.trim());
    check('the phone page reports it is on air', true, (await phone1.textContent('#st')).replace(/\s+/g, ' ').slice(0, 80));
    await game.waitForFunction(() => { const c = globalThis.IRONECHO_APP.cameraInput; return c && c.taps[1] && c.taps[1].total >= 4; }, null, { timeout: 240000 })
      .catch(async (e) => { console.log('  state at timeout:', JSON.stringify(await camState(game)), game.errors); throw e; });
    let st = await camState(game);
    check('the game decodes the phone video and runs pose detection on it', st.taps[1].active && st.taps[1].total >= 4, `${st.taps[1].total} frames, ${st.taps[1].infer.toFixed(0)} ms/frame (software rendering here)`);
    await game.waitForFunction(() => { const f = globalThis.IRONECHO_APP.cameraInput.fusion; return f && f.a.length >= 4 && f.b.length >= 4; }, null, { timeout: 240000 });
    st = await camState(game);
    check('both streams feed the fusion', st.fusion && st.fusion.a >= 4 && st.fusion.b >= 4 && st.fusion.aliveB, JSON.stringify(st.fusion));
    check('the phone preview box exists', await game.isVisible('#cam2'));
    const modes = await game.evaluate(() => { const c = globalThis.IRONECHO_APP.cameraInput; return { main: c.detector && c.detector.mode, phone: c.taps[1] && c.taps[1].detector && c.taps[1].detector.mode, delegate: c.detector && c.detector.delegate }; });
    check('pose detection runs in Web Workers (off the render thread), one per camera', modes.main === 'worker' && modes.phone === 'worker', JSON.stringify(modes));
    // nobody stands in front of the fake cameras, so the two views never match: the fight stays held until the player skips the phone
    check('the fight is still held (the cameras have not matched)', await game.evaluate(() => globalThis.IRONECHO_APP.cameraInput.hold === true));
    await game.evaluate(() => { document.querySelector('#cam-link .pp-close').click(); });
    check('"play without the second camera" releases the fight', await game.evaluate(() => globalThis.IRONECHO_APP.cameraInput.hold === false));
    // the phone leaves
    await phone1.close();
    await game.waitForFunction(() => Object.keys(globalThis.IRONECHO_APP.cameraInput.streams).length === 0, null, { timeout: 60000 });
    st = await camState(game);
    check('the game notices the phone leaving and goes on with the webcam', st.streams.length === 0 && !st.taps[1]);
    // it comes back (same link): reconnects into the same slot
    const phone1b = await phonePage(browser, link.trim());
    await game.waitForFunction(() => { const c = globalThis.IRONECHO_APP.cameraInput; return c && c.taps[1] && c.taps[1].total >= 3; }, null, { timeout: 240000 });
    check('the phone can come back with the same link', true);
    check('no page errors (game, phone)', !game.errors.length && !phone1b.errors.length, [...game.errors, ...phone1b.errors].join(' | '));
    await game.context().close();
    await phone1b.context().close();

    // ---- 2. two phones, no webcam
    const game2 = await openGame(browser);
    const links = await (async () => {
      await game2.click('[data-group="control"] button[data-value="camera"]');
      await game2.click('[data-group="camera2"] button[data-value="phones"]');
      await game2.click('#start');
      await game2.waitForSelector('#cam-link', { timeout: 180000 });
      await game2.waitForFunction(() => [...document.querySelectorAll('#cam-link .pp-ph small')].every((s) => s.textContent.includes('cam=')), null, { timeout: 60000 });
      return game2.$$eval('#cam-link .pp-ph small', (els) => els.map((e) => e.textContent.trim()));
    })();
    check('two pairing links, slots 1 and 2', links.length === 2 && links[0].endsWith('slot=1') && links[1].endsWith('slot=2'), links.join(' '));
    const pA = await phonePage(browser, links[0]);
    const pB = await phonePage(browser, links[1]);
    await game2.waitForFunction(() => { const c = globalThis.IRONECHO_APP.cameraInput; return c && c.taps[1] && c.taps[2] && c.taps[1].total >= 3 && c.taps[2].total >= 3; }, null, { timeout: 400000 });
    st = await camState(game2);
    check('two phones both decoded and detected', st.second === 'phones' && st.taps[1].total >= 3 && st.taps[2].total >= 3, JSON.stringify(st.taps));
    await game2.waitForFunction(() => { const f = globalThis.IRONECHO_APP.cameraInput.fusion; return f && f.a.length >= 3 && f.b.length >= 3; }, null, { timeout: 240000 });
    st = await camState(game2);
    check('phone 1 is the main camera, phone 2 the second', st.fusion.a >= 3 && st.fusion.b >= 3, JSON.stringify(st.fusion));
    check('the panel confirms both', (await game2.textContent('#cam-link')).includes('подключён'));
    check('no page errors (two phones)', !game2.errors.length && !pA.errors.length && !pB.errors.length, [...game2.errors, ...pA.errors, ...pB.errors].join(' | '));
  } finally {
    await browser.close();
    server.close();
    broker.close && broker.close();
  }
  const failed = results.filter((r) => !r).length;
  console.log(`${results.length - failed}/${results.length} checks passed`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
