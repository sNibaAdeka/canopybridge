// Does a robot run through itself? A scripted bout (every punch, block, slips, duck, steps, hits taken, a knockdown if it comes) is
// stepped at 60 Hz without drawing; on every step the body parts of both robots, approximated by capsules carried by their bones,
// are tested pair by pair (fist against the own head and chest, forearm against the chest, pauldron against the head, ...). The
// report is the deepest overlap of each pair and the moment it happened. The capsules are a little smaller than the armour, so a
// few millimetres of real contact (a glove resting on the guard) do not count: anything above the tolerance is a limb inside a body.
//
//   node Tests/Web/selfcheck.js [--seconds 40] [--tolerance 0.03]        (needs Build/Web/standalone and Playwright, as qa.js)
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PROJECT = path.resolve(__dirname, '..', '..');
const ROOT = process.env.IRONECHO_STANDALONE || path.join(PROJECT, 'Build', 'Web', 'standalone');
const arg = (name, def) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? Number(process.argv[i + 1]) : def; };
const SECONDS = arg('seconds', 40);
const TOLERANCE = arg('tolerance', 0.03);
const HELD = arg('held', 0.25);
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png' };
const PORT = 8890 + Math.floor(Math.random() * 100);

// Capsules in the rest pose (robot.py BONES; metres, robot faces +X, left = +Y): [name, bone, p0, p1, radius]
function parts() {
  const list = [
    ['head', 'head', [-0.012, 0, 1.80], [-0.012, 0, 1.87], 0.095],
    ['chest', 'spine_03', [0.015, -0.085, 1.48], [0.015, 0.085, 1.48], 0.125],
    ['belly', 'spine_01', [-0.012, 0, 1.12], [-0.012, 0, 1.28], 0.085],
    ['hips', 'pelvis', [0, -0.06, 0.99], [0, 0.06, 0.99], 0.095],
  ];
  for (const [side, s] of [['l', 1], ['r', -1]]) {
    list.push([`pauldron_${side}`, `upperarm_${side}`, [0, s * 0.262, 1.580], [0, s * 0.262, 1.580], 0.095]);
    list.push([`upperarm_${side}`, `upperarm_${side}`, [0, s * 0.262, 1.48], [0, s * 0.325, 1.26], 0.052]);
    list.push([`forearm_${side}`, `lowerarm_${side}`, [0, s * 0.345, 1.18], [0, s * 0.398, 0.93], 0.062]);
    list.push([`fist_${side}`, `hand_${side}`, [0, s * 0.415, 0.845], [0, s * 0.440, 0.720], 0.058]);
    list.push([`thigh_${side}`, `thigh_${side}`, [0, s * 0.122, 0.88], [0, s * 0.130, 0.58], 0.085]);
    list.push([`shin_${side}`, `calf_${side}`, [0, s * 0.132, 0.46], [0, s * 0.139, 0.16], 0.068]);
  }
  return list;
}
// pairs worth testing (neighbours on the skeleton always touch and are left out)
function pairs() {
  const out = [];
  for (const a of ['l', 'r']) {
    const b = a === 'l' ? 'r' : 'l';
    out.push([`fist_${a}`, 'head'], [`fist_${a}`, 'chest'], [`fist_${a}`, 'belly'], [`fist_${a}`, 'hips'], [`forearm_${a}`, 'head'], [`forearm_${a}`, 'chest'],
      [`forearm_${a}`, 'belly'], [`pauldron_${a}`, 'head'], [`fist_${a}`, `pauldron_${b}`], [`fist_${a}`, `upperarm_${b}`], [`fist_${a}`, `forearm_${b}`],
      [`forearm_${a}`, `upperarm_${b}`], [`fist_${a}`, `thigh_${a}`], [`fist_${a}`, `thigh_${b}`], [`upperarm_${a}`, 'head']);
  }
  out.push(['fist_l', 'fist_r'], ['forearm_l', 'forearm_r'], ['thigh_l', 'thigh_r'], ['shin_l', 'shin_r'], ['thigh_l', 'shin_r'], ['thigh_r', 'shin_l']);
  return out;
}

function serve() {
  return http.createServer((req, res) => {
    let p = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (p.endsWith(path.sep) || p.endsWith('/')) p = path.join(p, 'index.html');
    if (!p.startsWith(ROOT) || !fs.existsSync(p)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(p)] || 'application/octet-stream' });
    res.end(fs.readFileSync(p));
  }).listen(PORT);
}

(async () => {
  if (!fs.existsSync(path.join(ROOT, 'index.html'))) throw new Error(`no build at ${ROOT}`);
  const server = serve();
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  try {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    page.setDefaultTimeout(240000);
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => globalThis.IRONECHO_APP && globalThis.IRONECHO_APP.loaded);
    await page.evaluate(() => { try { localStorage.setItem('ironecho.tutorial', 'done'); } catch { /* ignore */ } });
    await page.$eval('[data-group="level"] button[data-value="1"]', (b) => b.click());
    await page.click('#start');
    const report = await page.evaluate(({ partList, pairList, seconds, tolerance }) => {
      const app = globalThis.IRONECHO_APP;
      app.debugNoRender = true;
      const V3 = app.rigs.player.headWorld().constructor;
      const seg = (p1, q1, p2, q2) => { // closest distance between two segments
        const d1 = q1.clone().sub(p1); const d2 = q2.clone().sub(p2); const r = p1.clone().sub(p2);
        const a = d1.dot(d1); const e = d2.dot(d2); const f = d2.dot(r);
        let s = 0; let t = 0;
        if (a <= 1e-9 && e <= 1e-9) return r.length();
        if (a <= 1e-9) t = Math.min(1, Math.max(0, f / e));
        else {
          const c = d1.dot(r);
          if (e <= 1e-9) s = Math.min(1, Math.max(0, -c / a));
          else {
            const b = d1.dot(d2); const den = a * e - b * b;
            s = den > 1e-9 ? Math.min(1, Math.max(0, (b * f - c * e) / den)) : 0;
            t = (b * s + f) / e;
            if (t < 0) { t = 0; s = Math.min(1, Math.max(0, -c / a)); } else if (t > 1) { t = 1; s = Math.min(1, Math.max(0, (b - c) / a)); }
          }
        }
        return p1.clone().addScaledVector(d1, s).distanceTo(p2.clone().addScaledVector(d2, t));
      };
      // a player who uses everything, in a loop of 4.5 s
      const plan = [[10, { punchMask: 1 }], [40, { punchMask: 2 }], [75, { punchMask: 64 }], [110, { punchMask: 128 }], [145, { punchMask: 1024 }],
        [180, { punchMask: 2048 }], [215, { punchMask: 4 }], [240, { punchMask: 8 }]];
      let i = 0;
      const input = () => {
        const k = i++ % 270;
        const out = { status: 7, lean: 0, block: 0, duck: 0, punchMask: 0, kickMask: 0, moveForward: 0, moveSide: 0, confidence: 1 };
        for (const [at, what] of plan) if (k === at) Object.assign(out, what);
        if (k >= 20 && k < 34) out.block = 1;
        if (k >= 90 && k < 104) out.lean = -1;
        if (k >= 125 && k < 139) out.lean = 1;
        if (k >= 160 && k < 174) out.duck = 1;
        if (k >= 250 && k < 262) out.block = 1;
        out.moveForward = app.core.snapshot().match.gap > 1.4 ? 1 : (k > 200 && k < 215 ? -1 : 0);
        out.moveSide = k > 60 && k < 72 ? 1 : 0;
        return out;
      };
      const worst = {};
      const held = {}; // seconds each pair spent deeper than the tolerance
      app.debugAdvance(7.5, input); // intro and countdown
      const n = Math.round(seconds * 60);
      for (let f = 0; f < n; f++) {
        app.debugAdvance(1 / 60, input);
        const snap = app.core.snapshot();
        if (snap.match.phaseName === 'MatchOver') break;
        for (const who of ['player', 'opponent']) {
          const rig = app.rigs[who];
          const st = snap[who];
          if (st.stateName === 'KnockedDown' || st.stateName === 'KnockedOut') continue; // lying on the canvas: limp limbs are allowed to rest on the body
          const world = {};
          for (const [name, bone, p0, p1, r] of partList) world[name] = [rig.worldPoint(bone, new V3(...p0)), rig.worldPoint(bone, new V3(...p1)), r];
          for (const [a, b] of pairList) {
            const A = world[a]; const B = world[b];
            const depth = A[2] + B[2] - seg(A[0], A[1], B[0], B[1]);
            const key = `${who}: ${a} in ${b}`;
            if (depth > tolerance) held[key] = (held[key] || 0) + 1 / 60;
            if (depth > (worst[key] ? worst[key].depth : 0)) {
              worst[key] = { depth, t: +(f / 60).toFixed(2), pose: app.anim[who].lastPose ? JSON.stringify(app.anim[who].lastPose, (k2, v) => (typeof v === 'number' ? +v.toFixed(3) : v)) : '', state: `${st.stateName}/${st.stageName} kind ${st.kind} hand ${st.hand} block ${st.blocking > 0.5 ? 1 : 0} dodge ${st.dodge} duck ${st.ducking > 0.5 ? 1 : 0}` };
            }
          }
        }
      }
      for (const [key, w] of Object.entries(worst)) w.held = held[key] || 0;
      return worst;
    }, { partList: parts(), pairList: pairs(), seconds: SECONDS, tolerance: TOLERANCE });
    const rows = Object.entries(report).sort((a, b) => b[1].depth - a[1].depth);
    let bad = 0;
    for (const [key, w] of rows) {
      // a limb inside the body is a fault when the eye can see it: deeper than the tolerance for longer than HELD seconds in the bout
      const over = w.depth > TOLERANCE && w.held > HELD;
      if (over) bad++;
      if (over && process.argv.includes('--poses')) console.log(`      pose ${w.pose}`);
      if (over || process.argv.includes('--all')) console.log(`${over ? 'FAIL' : 'ok  '}  ${key}: ${(w.depth * 100).toFixed(1)} cm at ${w.t} s, ${w.held.toFixed(2)} s over the tolerance (${w.state})`);
    }
    if (errors.length) { console.log('page errors:', errors.slice(0, 3).join(' | ')); bad++; }
    console.log(`\n${rows.length} overlapping pairs seen, ${bad} deeper than ${(TOLERANCE * 100).toFixed(0)} cm for more than ${HELD} s`);
    process.exitCode = bad ? 1 : 0;
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error('selfcheck crashed:', e); process.exit(2); });
