// IRON ECHO release QA for the browser game (the same build is /play on the website and the Windows app).
//
//   node Tests/Web/qa.js [--only flows,ui,camera,offline,soak]
//
// Needs Playwright with Chromium (NODE_PATH pointing at a node_modules that has `playwright`) and a built
// Build/Web/standalone (Tools/Build/Web/build_web.py site). IRONECHO_STANDALONE overrides the folder;
// IRONECHO_SYNTHETIC=<json> enables the camera test (Tools/Build/Web/check/synthetic_session.py writes it).
// Exit code 0 only when every check passes. Rendering runs on SwiftShader, so it is slow but deterministic.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PROJECT = path.resolve(__dirname, '..', '..');
const ROOT = process.env.IRONECHO_STANDALONE || path.join(PROJECT, 'Build', 'Web', 'standalone');
const SYNTHETIC = process.env.IRONECHO_SYNTHETIC || '';
const only = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean);
const want = (name) => !only.length || only.includes(name);

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.glb': 'model/gltf-binary', '.woff2': 'font/woff2', '.json': 'application/json' };
function serve(port) {
  return http.createServer((req, res) => {
    if (req.url === '/__synthetic.json' && SYNTHETIC) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(fs.readFileSync(SYNTHETIC)); return; }
    let p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (!p.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
    if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
    if (!fs.existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    res.end(fs.readFileSync(p));
  }).listen(port);
}

const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok: !!ok }); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`); };

async function open(browser, { width = 960, height = 540, blockExternal = true } = {}) {
  const page = await browser.newPage({ viewport: { width, height } });
  page.errors = [];
  page.external = [];
  page.on('pageerror', (e) => page.errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') page.errors.push(m.text()); });
  if (blockExternal) {
    await page.route('**/*', (r) => {
      const u = r.request().url();
      if (/^(http:\/\/(localhost|127\.0\.0\.1)|data:|blob:)/.test(u)) return r.continue();
      page.external.push(u);
      return r.abort();
    });
  }
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => globalThis.IRONECHO_APP && globalThis.IRONECHO_APP.loaded, null, { timeout: 240000 });
  await page.click('[data-group="quality"] button[data-value="low"]');
  return page;
}

// a scripted player: jabs and crosses on a rhythm, blocks most telegraphed punches after a human reaction time
const PLAYER = `(() => { let i = 0, reactAt = -1, defend = false, last = '', next = 60, seed = 12345;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  return () => { i++; const app = globalThis.IRONECHO_APP; const s = app.core.snapshot(); const o = s.opponent; const p = s.player;
    const atk = o.stateName === 'Attack' ? o.stageName : '';
    if (atk === 'Windup' && last !== 'Windup') { reactAt = i + Math.round(24 * (0.85 + 0.3 * rnd())); defend = rnd() < 0.7; }
    last = atk; if (o.stateName !== 'Attack') reactAt = -1;
    const block = o.stateName === 'Attack' && reactAt > 0 && i >= reactAt && defend ? 1 : 0; let punchMask = 0;
    if (!block && i >= next && p.stamina > 30) { punchMask = rnd() < 0.7 ? 1 : 2; next = i + Math.round(60 * (0.8 + 0.8 * rnd())); }
    return { status: 7, lean: 0, block, punchMask }; }; })()`;

async function flows(browser) {
  const page = await open(browser);
  for (const [mode, level] of [['bout', 0], ['bout', 1], ['bout', 2], ['short', 1]]) {
    await page.evaluate(() => { const a = globalThis.IRONECHO_APP; if (a.state !== 'menu') document.querySelector('#res-menu').click(); });
    await page.click(`[data-group="mode"] button[data-value="${mode}"]`);
    await page.click(`[data-group="level"] button[data-value="${level}"]`);
    await page.click('#start');
    const r = await page.evaluate((src) => {
      const app = globalThis.IRONECHO_APP; const fn = eval(src);
      for (let k = 0; k < 200 && app.state !== 'results'; k++) app.debugAdvance(5, fn);
      const m = app.core.snapshot().match;
      return { state: app.state, phase: m.phaseName, round: m.round, results: !document.querySelector('#results').hidden };
    }, PLAYER);
    check(`full ${mode} bout on level ${level} reaches the results screen`, r.state === 'results' && r.phase === 'MatchOver' && r.results, `round ${r.round}`);
  }
  await page.click('#rematch');
  check('rematch starts a new bout', await page.evaluate(() => globalThis.IRONECHO_APP.state === 'playing' && document.querySelector('#results').hidden));
  await page.evaluate(() => globalThis.IRONECHO_APP.debugAdvance(6));
  await page.evaluate(() => { globalThis.IRONECHO_APP.frozen = false; });
  const tick = () => page.evaluate(() => globalThis.IRONECHO_APP.core.snapshot().match.tick);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const t1 = await tick();
  await page.waitForTimeout(1200);
  const t2 = await tick();
  const paused = await page.evaluate(() => ({ s: globalThis.IRONECHO_APP.state, ph: globalThis.IRONECHO_APP.core.snapshot().match.phaseName }));
  check('Esc pauses: the rules stop ticking behind the pause panel', paused.s === 'paused' && t1 === t2, `${JSON.stringify(paused)} tick ${t1}->${t2}`);
  await page.click('#resume');
  await page.waitForTimeout(2500);
  const resumed = await page.evaluate(() => globalThis.IRONECHO_APP.core.snapshot().match.phaseName);
  check('resume returns to the fight (via the ready check and countdown)', ['Countdown', 'Fighting'].includes(resumed), resumed);
  await page.click('#pause-btn');
  await page.click('#restart');
  await page.keyboard.press('Escape'); // straight after the start, while the core still waits for the player
  await page.waitForTimeout(300);
  const w1 = await tick();
  await page.waitForTimeout(1500);
  const w2 = await tick();
  check('pause right after the start also freezes the bout', w1 === w2, `tick ${w1}->${w2}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => { const a = globalThis.IRONECHO_APP; a.debugAdvance(6); a.frozen = false; return a.core.snapshot().match.phaseName; });
  check('... and resuming continues into the fight', ['Countdown', 'Fighting'].includes(after), after);
  await page.click('#pause-btn');
  await page.click('#to-menu');
  await page.click('[data-group="mode"] button[data-value="training"]');
  await page.click('#start');
  const t = await page.evaluate(() => { const a = globalThis.IRONECHO_APP; let i = 0; a.debugAdvance(60, () => ({ status: 7, lean: 0, block: 0, punchMask: ++i % 40 === 0 ? 1 : 0 }));
    return { phase: a.core.snapshot().match.phaseName, landed: a.core.snapshot().player.landed }; });
  check('training: the heavy bag takes punches', t.phase === 'Training' && t.landed > 10, `landed ${t.landed}`);
  check('flows: no page errors', !page.errors.length, page.errors.slice(0, 3).join(' | '));
  await page.close();
}

async function ui(browser) {
  const page = await open(browser, { width: 1280, height: 720 });
  check('menu fits a 1280x720 window without scrolling', await page.evaluate(() => { const m = document.querySelector('#menu'); return m.scrollHeight <= m.clientHeight + 2; }));
  check('favicon present', await page.evaluate(() => (document.querySelector('link[rel=icon]')?.href || '').startsWith('data:image/png')));
  check('Easy is the default opponent', await page.evaluate(() => document.querySelector('[data-group="level"] button.sel')?.dataset.value === '0'));
  await page.keyboard.press('Enter');
  await page.waitForSelector('#hud:not([hidden])');
  check('Enter starts the bout', true);
  await page.evaluate(() => { const a = globalThis.IRONECHO_APP; a.debugAdvance(5); a.frozen = false; });
  await page.evaluate(() => window.dispatchEvent(new Event('blur')));
  check('losing window focus pauses', await page.evaluate(() => globalThis.IRONECHO_APP.state === 'paused'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.click('#to-menu');
  const shadows = async () => page.evaluate(() => { let n = 0; globalThis.IRONECHO_APP.lights.traverse((o) => { if (o.isSpotLight && o.castShadow) n++; }); return n; });
  await page.click('[data-group="quality"] button[data-value="high"]');
  const hi = await shadows();
  await page.click('[data-group="quality"] button[data-value="low"]');
  const lo = await shadows();
  check('graphics quality switches live', hi === 2 && lo === 0, `${hi}/${lo}`);
  await page.click('[data-group="mode"] button[data-value="short"]');
  await page.keyboard.press('Enter');
  await page.evaluate(() => { const a = globalThis.IRONECHO_APP; for (let k = 0; k < 120 && a.state !== 'results'; k++) a.debugAdvance(5); a.frozen = false; });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  check('Enter on the results screen = rematch', await page.evaluate(() => globalThis.IRONECHO_APP.state === 'playing'));
  await page.evaluate(() => { const a = globalThis.IRONECHO_APP; for (let k = 0; k < 120 && a.state !== 'results'; k++) a.debugAdvance(5); a.frozen = false; });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('Esc on the results screen = menu', await page.isVisible('#menu'));
  for (const [w, h] of [[390, 844], [844, 390]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(200);
    check(`no horizontal page scroll at ${w}x${h}`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  }
  check('ui: no page errors', !page.errors.length, page.errors.slice(0, 3).join(' | '));
  await page.close();
}

async function camera(browser) {
  if (!SYNTHETIC) { console.log('SKIP  camera (set IRONECHO_SYNTHETIC)'); return; }
  const page = await open(browser);
  await page.click('[data-group="control"] button[data-value="camera"]');
  await page.click('#start');
  await page.waitForFunction(() => globalThis.IRONECHO_APP.cameraInput && globalThis.IRONECHO_APP.cameraInput.active, null, { timeout: 300000 });
  const r = await page.evaluate(async () => {
    const app = globalThis.IRONECHO_APP; const cam = app.cameraInput;
    cam.active = false; // the synthetic body replaces the video from here, through the same processor and UI
    const frames = await (await fetch('/__synthetic.json')).json();
    cam.proc = new cam.proc.constructor((a, b, c) => cam._say(a, b, c));
    const msgs = []; let k = 0; let calibrated = false; let fought = false;
    const feed = () => { const f = frames[Math.min(k, frames.length - 1)]; k++;
      cam.proc.process(f.w ? f.w.map(([x, y, z, visibility]) => ({ x, y, z, visibility })) : null, f.t); return cam.poll(); };
    while (k < frames.length) {
      app.debugAdvance(0.5, feed);
      const m = document.querySelector('#cam .cam-msg b')?.textContent || '';
      if (m && msgs[msgs.length - 1] !== m) msgs.push(m);
      calibrated = calibrated || !!cam.proc.cal;
      fought = fought || app.core.snapshot().match.phaseName === 'Fighting';
    }
    const s = app.core.snapshot();
    return { msgs, calibrated, fought, detected: cam.proc.punches.length, thrown: s.player.thrown, landed: s.player.landed };
  });
  check('camera: calibration completes with on-screen steps', r.calibrated && r.msgs.length >= 3, r.msgs.join(' → '));
  check('camera: the bout starts after calibration', r.fought);
  check('camera: body punches reach the opponent', r.thrown >= 20 && r.landed > 0, `detected ${r.detected}, thrown ${r.thrown}, landed ${r.landed}`);
  check('camera: no page errors', !page.errors.length, page.errors.slice(0, 3).join(' | '));
  await page.close();
}

async function offline(browser) {
  const page = await open(browser);
  await page.click('[data-group="control"] button[data-value="camera"]');
  await page.click('#start');
  await page.waitForFunction(() => globalThis.IRONECHO_APP.cameraInput && globalThis.IRONECHO_APP.cameraInput.active, null, { timeout: 300000 });
  check('offline: game and camera model load with every external request blocked', !page.external.length, page.external.slice(0, 3).join(' '));
  check('offline: fonts are local', await page.evaluate(() => document.fonts.check('700 20px "Barlow Condensed"')));
  check('offline: no page errors', !page.errors.length, page.errors.slice(0, 3).join(' | '));
  await page.close();
}

async function soak(browser) {
  const page = await open(browser, { width: 640, height: 360 });
  await page.click('#start');
  const samples = [];
  for (let b = 0; b < 3; b++) {
    samples.push(await page.evaluate(() => {
      const app = globalThis.IRONECHO_APP; let i = 0;
      for (let k = 0; k < 200 && app.state !== 'results'; k++) app.debugAdvance(5, () => ({ status: 7, lean: 0, block: 0, punchMask: ++i % 30 === 0 ? 1 : 0 }));
      let objects = 0; app.scene.traverse(() => objects++);
      return { geometries: app.renderer.info.memory.geometries, textures: app.renderer.info.memory.textures, objects };
    }));
    await page.click('#rematch');
  }
  const [a, , c] = samples;
  check('soak: three bouts in a row leak no scene objects, geometries or textures',
    c.objects === a.objects && c.textures === a.textures && c.geometries <= a.geometries + 2, JSON.stringify(samples));
  await page.close();
}

const PORT = 8790 + Math.floor(Math.random() * 100);
(async () => {
  if (!fs.existsSync(path.join(ROOT, 'index.html'))) throw new Error(`no build at ${ROOT}: run Tools/Build/Web/build_web.py site`);
  const server = serve(PORT);
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  try {
    if (want('flows')) await flows(browser);
    if (want('ui')) await ui(browser);
    if (want('camera')) await camera(browser);
    if (want('offline')) await offline(browser);
    if (want('soak')) await soak(browser);
  } finally {
    await browser.close();
    server.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('QA crashed:', e); process.exit(2); });
