// Phone as the camera, end to end through the real desktop launcher (native build of Tools/Build/Desktop/launcher):
// a "phone" page opens the HTTPS pairing link with a camera, streams frames, the game pairs from the QR panel and
// receives them. With IRONECHO_FAKE_VIDEO=<y4m of a person> it also checks that MediaPipe finds the person.
//
//   python Tools/Build/Desktop/build_desktop.py          # Build/Desktop/ironecho-linux (or set IRONECHO_LAUNCHER)
//   node Tests/Web/phone_e2e.js                          # NODE_PATH with playwright
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PROJECT = path.resolve(__dirname, '..', '..');
const LAUNCHER = process.env.IRONECHO_LAUNCHER || path.join(PROJECT, 'Build', 'Desktop', `ironecho-${process.platform}`);
const VIDEO = process.env.IRONECHO_FAKE_VIDEO || '';
const GAME_PORT = 8890 + Math.floor(Math.random() * 50);
const PHONE_PORT = GAME_PORT + 50;

const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`); };

(async () => {
  if (!fs.existsSync(LAUNCHER)) throw new Error(`no launcher at ${LAUNCHER}: run Tools/Build/Desktop/build_desktop.py`);
  const server = spawn(LAUNCHER, ['--serve', `127.0.0.1:${GAME_PORT}`, '--phone-addr', `127.0.0.1:${PHONE_PORT}`], { stdio: 'ignore' });
  const args = ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist',
    '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'];
  if (VIDEO) args.push(`--use-file-for-fake-video-capture=${VIDEO}`);
  const browser = await chromium.launch({ args });
  try {
    await new Promise((r) => setTimeout(r, 800));
    const game = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    const errors = [];
    game.on('pageerror', (e) => errors.push(e.message));
    await game.goto(`http://127.0.0.1:${GAME_PORT}/`);
    await game.waitForFunction(() => globalThis.IRONECHO_APP && globalThis.IRONECHO_APP.loaded, null, { timeout: 240000 });
    check('the app offers the phone camera', await game.isVisible('[data-group="control"] button[data-value="phone"]'));
    await game.click('[data-group="quality"] button[data-value="low"]');
    await game.click('[data-group="control"] button[data-value="phone"]');
    await game.click('#start');
    await game.waitForSelector('#phone-pair', { timeout: 120000 });
    const urls = await game.textContent('#phone-pair small');
    check('pairing panel shows a QR code and the link', await game.isVisible('#phone-pair .pp-qr img') && /https:\/\/.+\/phone\?k=[0-9a-f]+/.test(urls), urls);
    const key = /k=([0-9a-f]+)/.exec(urls)[1];
    const phone = await (await browser.newContext({ ignoreHTTPSErrors: true, viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
    await phone.goto(`https://127.0.0.1:${PHONE_PORT}/phone?k=${key}`);
    await phone.click('#start');
    await phone.waitForFunction(() => document.querySelector('#status').classList.contains('ok'), null, { timeout: 90000 });
    check('the phone page streams to the computer', true, (await phone.textContent('#status')).replace(/\s+/g, ' '));
    await game.waitForFunction(() => { const c = globalThis.IRONECHO_APP.cameraInput; return c && c.active && !document.querySelector('#phone-pair'); }, null, { timeout: 240000 });
    check('the game pairs and runs pose tracking on the phone frames', true);
    if (VIDEO) {
      await game.waitForFunction(() => globalThis.IRONECHO_APP.cameraInput.proc.confidence > 0.3, null, { timeout: 240000 });
      check('MediaPipe finds the person in the phone stream', true);
    }
    const bad = await phone.evaluate(async () => (await fetch('/phone/frame?k=wrong', { method: 'POST', body: new Blob(['x']) })).status);
    check('frames with a wrong key are refused', bad === 403, String(bad));
    check('no page errors', !errors.length, errors.join(' | '));
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
  process.exit(results.every(Boolean) ? 0 : 1);
})().catch((e) => { console.error('phone QA crashed:', e); process.exit(2); });
