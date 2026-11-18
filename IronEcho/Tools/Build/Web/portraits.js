// The website's opponent cards (1.12): the game itself photographs its six ladder opponents — the same robots, paint and stance as in
// the ring (main.js renderPortraits) — and the pictures land in Tools/Build/Web/public/foes/<rung>.jpg, which the landing page shows.
// Run after build_web.py site, whenever a robot, a livery or the light changes:
//   NODE_PATH=<playwright> node Tools/Build/Web/portraits.js [Build/Web/standalone]
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '..', '..', '..', 'Build', 'Web', 'standalone'));
const OUT = path.join(__dirname, 'public', 'foes');
const PORT = 8990 + Math.floor(Math.random() * 100);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.jpg': 'image/jpeg', '.png': 'image/png',
  '.css': 'text/css', '.wasm': 'application/wasm', '.woff2': 'font/woff2', '.json': 'application/json' };

const server = http.createServer((req, res) => {
  let p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
  if (!p.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (fs.existsSync(p) && fs.statSync(p).isDirectory()) p = path.join(p, 'index.html');
  if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
  res.end(fs.readFileSync(p));
});

(async () => {
  if (!fs.existsSync(path.join(ROOT, 'index.html'))) throw new Error(`no build at ${ROOT}: run build_web.py site`);
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 });
  ctx.setDefaultTimeout(300000);
  await ctx.route('**/*', (r) => (new URL(r.request().url()).hostname === 'localhost' ? r.continue() : r.abort()));
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('page error:', e.message));
  await page.addInitScript(() => { try { localStorage.setItem('ironecho.settings', JSON.stringify({ quality: 'high', ladderDefault: 1, level: -1 })); } catch { /* ignore */ } });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForFunction(() => globalThis.IRONECHO_APP && globalThis.IRONECHO_APP.loaded, null, { timeout: 300000 });
  const shots = await page.evaluate(() => {
    const a = globalThis.IRONECHO_APP;
    a.frozen = true; // no adaptive resolution from here on: the pictures are taken at the full pixel ratio
    a.renderer.setPixelRatio(2);
    a.renderer.setSize(window.innerWidth, window.innerHeight, false);
    a.debugAdvance(0.5);
    return a.renderPortraits(340, 425, 0.88);
  });
  if (!shots || shots.length !== 6) throw new Error('the game returned no portraits');
  fs.mkdirSync(OUT, { recursive: true });
  shots.forEach((url, i) => {
    const file = path.join(OUT, `${i + 1}.jpg`);
    fs.writeFileSync(file, Buffer.from(url.split(',')[1], 'base64'));
    console.log(`${path.relative(process.cwd(), file)}  ${Math.round(fs.statSync(file).size / 1024)} KB`);
  });
  await browser.close();
  server.close();
})().catch((e) => { console.error('FAILED', e.message); server.close(); process.exit(1); });
