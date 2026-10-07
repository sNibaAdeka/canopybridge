// IRON ECHO release QA for the browser game (the same build is /play on the website and the Windows app).
//
//   node Tests/Web/qa.js [--only flows,ui,ring,camera,offline,animation,soak]
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
  const resumed = await page.evaluate(() => { const a = globalThis.IRONECHO_APP; a.debugAdvance(1.5); a.frozen = false; return a.core.snapshot().match.phaseName; });
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
    const msgs = []; let k = 0; let calibrated = false; let fought = false; let peakLean = 0; let stepIn = 0; let peakBlock = 0;
    const feed = () => { const f = frames[Math.min(k, frames.length - 1)]; k++;
      cam.proc.process(f.w ? f.w.map(([x, y, z, visibility]) => ({ x, y, z, visibility })) : null, f.t); return cam.poll(); };
    while (k < frames.length) {
      app.debugAdvance(0.5, feed);
      const m = document.querySelector('#cam .cam-msg b')?.textContent || '';
      if (m && msgs[msgs.length - 1] !== m) msgs.push(m);
      calibrated = calibrated || !!cam.proc.cal;
      fought = fought || app.core.snapshot().match.phaseName === 'Fighting';
      peakLean = Math.max(peakLean, cam.proc.leanForward);
      if (cam.proc.cal) peakBlock = Math.max(peakBlock, cam.proc.blockPersonal);
      if (cam.proc.leanForward > 0.55) stepIn = Math.max(stepIn, app.core.snapshot().player.speedForward);
    }
    const s = app.core.snapshot();
    return { msgs, calibrated, fought, detected: cam.proc.punches.length, thrown: s.player.thrown, landed: s.player.landed, peakLean, stepIn, peakBlock,
      kicksDetected: cam.proc.kicks.map((x) => x[1] + x[2]).join(','), kicksThrown: s.player.kicksThrown, personal: !!(cam.proc.cal && cam.proc.cal.blockPose) };
  });
  check('camera: calibration completes with on-screen steps', r.calibrated && r.msgs.length >= 3, r.msgs.join(' → '));
  check('camera: the bout starts after calibration', r.fought);
  check('camera: body punches reach the opponent', r.thrown >= 20 && r.landed > 0, `detected ${r.detected}, thrown ${r.thrown}, landed ${r.landed}`);
  check('camera: the personal block pose is calibrated and read back', r.personal && r.peakBlock > 0.85, `peak ${r.peakBlock.toFixed(2)}`);
  check('camera: four leg kicks are detected (mid and low, both legs) and thrown', r.kicksDetected === '0mid,1mid,0low,1low' && r.kicksThrown >= 4, `${r.kicksDetected}; thrown ${r.kicksThrown}`);
  check('camera: leaning toward the screen steps the robot in', r.peakLean >= 0.55 && r.stepIn > 0.3, `lean ${r.peakLean.toFixed(2)}, speed ${r.stepIn.toFixed(2)} m/s`);
  check('camera: no page errors', !page.errors.length, page.errors.slice(0, 3).join(' | '));
  await page.close();
}

// Footwork and precision through the real page: keys -> core -> robots on the canvas.
async function ring(browser) {
  const page = await open(browser, { width: 1280, height: 720 });
  await page.click('[data-group="level"] button[data-value="1"]');
  await page.click('#start');
  // keys map to the InputFrame footwork / body-shot fields
  const keys = {};
  for (const [k, field, want] of [['w', 'moveForward', 1], ['s', 'moveForward', -1], ['d', 'moveSide', 1], ['a', 'moveSide', -1]]) {
    await page.keyboard.down(k);
    keys[k] = await page.evaluate((f) => globalThis.IRONECHO_APP.input.poll()[f], field) === want;
    await page.keyboard.up(k);
  }
  await page.keyboard.down('Shift');
  await page.keyboard.press('j');
  await page.keyboard.up('Shift');
  keys.bodyJab = await page.evaluate(() => globalThis.IRONECHO_APP.input.poll().punchMask) === 4;
  await page.keyboard.press('q');
  check('ring: W/S/A/D move, Q/E slip, Shift+J/K go to the body', Object.values(keys).every(Boolean), JSON.stringify(keys));

  const r = await page.evaluate(() => {
    const app = globalThis.IRONECHO_APP;
    const quiet = (extra = {}) => () => ({ status: 7, lean: 0, block: 1, punchMask: 0, ...extra });
    for (let k = 0; k < 40 && app.core.snapshot().match.phaseName !== 'Fighting'; k++) app.debugAdvance(0.5, quiet());
    const s0 = app.core.snapshot();
    app.debugAdvance(1.0, quiet({ moveForward: -1 }));
    const s1 = app.core.snapshot();
    const walked = Math.hypot(s1.player.x - s0.player.x, s1.player.y - s0.player.y);
    const theta0 = app.debugAdvance(0.01, quiet()).theta;
    app.debugAdvance(1.5, quiet({ moveSide: 1 }));
    const theta1 = app.debugAdvance(0.01, quiet()).theta;
    const s = app.core.snapshot();
    // the robots stand where the core says and face each other
    const P = app.holders.player.face.position;
    const O = app.holders.opponent.face.position;
    const off = Math.max(Math.hypot(P.x - s.player.x, P.z + s.player.y), Math.hypot(O.x - s.opponent.x, O.z + s.opponent.y));
    const face = Math.abs(Math.cos(app.holders.player.face.rotation.y) - s.player.faceX);
    return { fighting: s.match.phaseName === 'Fighting', walked, gapBack: s1.match.gap, turn: Math.abs(theta1 - theta0), off, face,
      steps: app.anim.player.steps, inRing: Math.abs(s.player.x) < 2.61 && Math.abs(s.player.y) < 2.61 };
  });
  check('ring: the bout runs', r.fighting);
  check('ring: the player walks back and the bot follows', r.walked > 0.5 && r.gapBack < 2.0, `walked ${r.walked.toFixed(2)} m, gap ${r.gapBack.toFixed(2)}`);
  check('ring: circling turns the fight line', r.turn > 0.25, `${r.turn.toFixed(2)} rad`);
  check('ring: robots stand where the core puts them and face each other', r.off < 0.01 && r.face < 0.01 && r.inRing, `off ${r.off.toFixed(4)} m`);
  check('ring: the feet step while walking', r.steps > 6, `${r.steps} steps`);
  await page.screenshot({ path: path.join(PROJECT, 'Build', 'Web', 'qa_ring.png') });
  check('ring: no page errors', !page.errors.length, page.errors.slice(0, 3).join(' | '));
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

// Animation continuity: a scripted 30 s bout (punches, blocks, steps, kicks, hits taken) with every 1/60 s step measured:
// no robot may teleport (knock-back), no limb may roll through 180 degrees about its length in one frame, no elbow, knee or
// foot may jump half a metre between frames. (Rendering is skipped: the bones are posed by the animator, not by drawing.)
async function animation(browser) {
  const page = await open(browser, { width: 640, height: 360 });
  await page.click('[data-group="level"] button[data-value="1"]');
  await page.click('#start');
  const m = await page.evaluate(() => {
    const app = globalThis.IRONECHO_APP;
    app.renderer.render = () => {};
    const names = ['lowerarm_l', 'lowerarm_r', 'calf_l', 'calf_r', 'foot_l', 'foot_r'];
    const rollNames = ['upperarm_l', 'lowerarm_l', 'upperarm_r', 'lowerarm_r', 'thigh_l', 'calf_l', 'thigh_r', 'calf_r'];
    const V3 = app.camera.position.constructor;
    const Q4 = app.camera.quaternion.constructor;
    const v = new V3();
    const q = new Q4();
    const prev = {};
    const out = { steps: 0, rootPops: 0, rolls: 0, limbJumps: 0, bigLimbJumps: 0, worstRoll: 0, worstJump: 0, worstRoot: 0 };
    const script = (k) => {
      const t = k / 60;
      const s = { status: 7, lean: 0, leanForward: 0, block: 0, punchMask: 0, kickMask: 0, moveForward: 0, moveSide: 0 };
      const ph = Math.floor(t / 1.5) % 6;
      if (ph === 0 && k % 22 === 0) s.punchMask = (k / 22) % 2 ? 2 : 1;
      if (ph === 1) s.block = 1;
      if (ph === 2) { s.moveForward = 1; s.moveSide = 0.5; }
      if (ph === 3 && k % 40 === 0) s.kickMask = [1, 2, 4, 8][(k / 40) % 4];
      if (ph === 4) { s.moveForward = -1; s.lean = Math.sin(t * 6) * 0.8; }
      if (ph === 5) { if (k % 18 === 0) s.punchMask = [1, 2, 4, 8][(k / 18) % 4]; s.moveSide = -0.6; }
      return s;
    };
    for (let k = 0; k < 1800; k++) {
      const info = app.debugAdvance(1 / 60, () => script(k));
      app.scene.updateMatrixWorld(true);
      for (const key of ['player', 'opponent']) {
        const rig = app.rigs[key];
        rig.root.getWorldPosition(v);
        const root = v.clone();
        const cur = { root, pos: {}, rot: {} };
        for (const n of names) { rig.bones[n].getWorldPosition(v); cur.pos[n] = v.clone().sub(root); }
        for (const n of rollNames) { rig.bones[n].getWorldQuaternion(q); cur.rot[n] = q.clone(); }
        const p = prev[key];
        if (p) {
          const dr = cur.root.distanceTo(p.root);
          out.worstRoot = Math.max(out.worstRoot, dr);
          if (dr > 0.10) out.rootPops++;
          let bad = false;
          let big = false;
          for (const n of names) { const d = cur.pos[n].distanceTo(p.pos[n]); out.worstJump = Math.max(out.worstJump, d); if (d > 0.22) bad = true; if (d > 0.5) big = true; }
          if (bad) out.limbJumps++;
          if (big) out.bigLimbJumps++;
          let roll = false;
          for (const n of rollNames) {
            const ang = 2 * Math.acos(Math.min(1, Math.abs(cur.rot[n].dot(p.rot[n])))) * 180 / Math.PI;
            out.worstRoll = Math.max(out.worstRoll, ang);
            if (ang > 120) roll = true;
          }
          if (roll) out.rolls++;
        }
        prev[key] = cur;
      }
      out.steps++;
      if (info.phase === 'MatchOver') break;
    }
    return out;
  });
  check('animation: no robot teleports (knock-back is drawn as a slide)', m.rootPops === 0, `${m.steps} steps, worst root step ${m.worstRoot.toFixed(3)} m`);
  check('animation: no limb rolls through 180 degrees in one frame', m.rolls === 0, `worst ${m.worstRoll.toFixed(0)} deg`);
  check('animation: no elbow, knee or foot jumps half a metre in one frame', m.bigLimbJumps === 0, `worst ${m.worstJump.toFixed(2)} m; ${m.limbJumps} steps above 0.22 m`);
  check('animation: very few limb jumps over 0.22 m', m.limbJumps <= 12, `${m.limbJumps}`);
  check('animation: no page errors', !page.errors.length, page.errors.slice(0, 3).join(' | '));
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
  // the first bout may create one-off resources lazily (an effect texture at the first knockdown): a leak is growth from
  // one bout to the next, so the second and third are compared
  const [, b, c] = samples;
  check('soak: three bouts in a row leak no scene objects, geometries or textures',
    c.objects === b.objects && c.textures === b.textures && c.geometries <= b.geometries + 2, JSON.stringify(samples));
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
    if (want('ring')) await ring(browser);
    if (want('camera')) await camera(browser);
    if (want('offline')) await offline(browser);
    if (want('animation')) await animation(browser);
    if (want('soak')) await soak(browser);
  } finally {
    await browser.close();
    server.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error('QA crashed:', e); process.exit(2); });
