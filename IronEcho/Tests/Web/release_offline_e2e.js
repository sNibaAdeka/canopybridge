// The published site with every outside host blocked (1.11): the landing page, «Камера и данные», the game and the camera (Chromium's fake
// webcam) load from the site alone — three.js, MediaPipe, the pose model, PeerJS and the fonts come from /play/vendor.
// Run after build_web.py release:  NODE_PATH=<playwright> node Tests/Web/release_offline_e2e.js [screenshots dir]
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = process.env.IRONECHO_RELEASE || path.join(__dirname, '..', '..', 'Tools', 'Build', 'Web', 'release');
const OUT = process.argv[2] || '';
const PORT = 8890 + Math.floor(Math.random() * 100);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png', '.mp4': 'video/mp4',
  '.css': 'text/css', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.json': 'application/json' };
let pass = 0;
let fail = 0;
const check = (name, ok, info = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`); };

const server = http.createServer((req, res) => {
  let p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  res.end(fs.readFileSync(p));
});

(async () => {
  if (!fs.existsSync(path.join(ROOT, 'play', 'index.html'))) throw new Error(`no release at ${ROOT}: run build_web.py release`);
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, permissions: ['camera'] });
  ctx.setDefaultTimeout(240000);
  const outside = [];
  const local = new Set();
  const errors = [];
  await ctx.route('**/*', (r) => {
    const u = new URL(r.request().url());
    if (u.hostname === 'localhost') { local.add(u.pathname); return r.continue(); }
    outside.push(u.href.slice(0, 100));
    return r.abort();
  });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text().slice(0, 160)}`); });
  const shot = (n, full = false) => (OUT ? page.screenshot({ path: path.join(OUT, `${n}.png`), fullPage: full }) : null);

  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForTimeout(1500);
  check('landing: its fonts come from the site', await page.evaluate(() => document.fonts.check('800 26px "Barlow Condensed"')));
  check('landing: links «Камера и данные»', await page.evaluate(() => !!document.querySelector('footer a[href="privacy/"]')));
  await shot('01_landing');

  await page.goto(`http://localhost:${PORT}/privacy/`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const priv = await page.evaluate(() => ({ wide: document.documentElement.scrollWidth, h1: document.querySelector('h1').textContent, text: document.body.textContent }));
  check('privacy page: says the video stays in the browser, fits a phone', priv.wide <= 390 && /Видео с камеры никуда не уходит/.test(priv.text) && !/@@/.test(priv.text), `${priv.wide}px`);
  await shot('02_privacy_phone');
  await page.setViewportSize({ width: 1280, height: 720 });

  await page.goto(`http://localhost:${PORT}/play/`);
  await page.waitForFunction(() => globalThis.IRONECHO_APP && globalThis.IRONECHO_APP.loaded, null, { timeout: 240000 });
  const menu = await page.evaluate(() => ({ privacy: (() => { const a = document.querySelector('#privacy-link'); return a && !a.hidden ? a.getAttribute('href') : null; })(),
    ver: document.querySelector('.ver').textContent, stance: !!document.querySelector('[data-group="stance"] button[data-value="southpaw"]') }));
  check('game: the menu links the privacy page and offers the southpaw stance', menu.privacy === '../privacy/' && menu.stance, JSON.stringify(menu));
  // 1.11: the menu fetches the camera's files into the cache in the background, before «В ринг» is pressed
  await page.waitForTimeout(2500);
  const pre = Date.now();
  while (Date.now() - pre < 120000 && ![...local].some((p) => p === '/play/vendor/pose_landmarker_full.task')) await page.waitForTimeout(500);
  check('menu: the pose model and MediaPipe are fetched in the background before the camera is asked for',
    [...local].includes('/play/vendor/pose_landmarker_full.task') && [...local].some((p) => p.startsWith('/play/vendor/mediapipe/wasm/')) && await page.evaluate(() => !globalThis.IRONECHO_APP.cameraInput));
  await page.evaluate(() => { localStorage.setItem('ironecho.tutorial', 'done'); });
  await page.click('#start-cam');
  const t0 = Date.now();
  await page.waitForFunction(() => { const c = globalThis.IRONECHO_APP.cameraInput; return c && c.active && c.fps > 0; }, null, { timeout: 240000 });
  const cam = await page.evaluate(() => { const c = globalThis.IRONECHO_APP.cameraInput; return { model: c.model, detector: c.detector ? `${c.detector.mode}/${c.detector.delegate}` : '-' }; });
  check('game: the camera starts and the pose model runs', cam.model === 'full' && cam.detector !== '-', `${((Date.now() - t0) / 1000).toFixed(0)} s, ${cam.detector}`);
  await shot('03_camera');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('game: the pause offers «Перенастроить камеру» with the camera on', await page.evaluate(() => !document.querySelector('#pause').hidden && !document.querySelector('#recal').hidden));
  await shot('04_pause');

  for (const need of ['/play/vendor/mediapipe/', '/play/vendor/pose_landmarker_full.task', '/play/vendor/three/', '/play/vendor/fonts/']) {
    check(`served by the site: ${need}`, [...local].some((p) => p.startsWith(need)));
  }
  check('no request to any other host', !outside.length, outside.slice(0, 4).join(' | '));
  check('no page errors', !errors.length, errors.slice(0, 3).join(' | '));
  await browser.close();
  server.close();
  console.log(`\n${pass}/${pass + fail} checks passed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAILED', e.message); server.close(); process.exit(1); });
