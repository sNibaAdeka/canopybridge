// The tutorial (site/src/tutorial.js) on the real rules core: scripted key presses pass every step in training mode, a touch player gets
// no footwork step, skip / next work, and the results-screen tip picks the right advice. Run: node Tests/Web/tutorial_test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..', '..');
const SRC = path.join(PROJECT, 'Tools', 'Build', 'Web', 'site', 'src');
const WASM = process.env.IRONECHO_CORE_WASM || path.join(PROJECT, 'Build', 'Web', 'core', 'ironecho_core.wasm');
if (!fs.existsSync(WASM)) { console.error(`no core at ${WASM}; run: python Tools/Build/Web/build_web.py core`); process.exit(2); }
globalThis.IRONECHO_CORE_WASM_B64 = fs.readFileSync(WASM).toString('base64');
const imp = (f) => import(pathToFileURL(path.join(SRC, f)));
const { loadCore } = await imp('core.js');
const { Tutorial, TUTORIAL_STEPS, resultTip } = await imp('tutorial.js');

let pass = 0;
let fail = 0;
const check = (name, ok, info = '') => { if (ok) pass++; else fail++; console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`); };

// a player who reads the card and does what it says, with a human pause between tries
const ACT = {
  jab: (k) => ({ punchMask: k % 40 === 0 ? 1 : 0 }),
  cross: (k) => ({ punchMask: k % 40 === 0 ? 2 : 0 }),
  block: () => ({ block: 1 }),
  slip: (k) => ({ lean: k % 50 < 25 ? -1 : 0 }),
  hook: (k) => ({ punchMask: k % 50 === 0 ? 64 : 0 }),
  step: (k) => ({ moveForward: k % 120 < 60 ? -1 : 1 }),
};
async function run(control, { stopAt = 60 * 90 } = {}) {
  const core = await loadCore();
  core.init({ mode: 1, level: 0, seed: 7, rounds: 0, roundSeconds: 0 });
  let done = 0;
  const passed = [];
  const t = new Tutorial({ control, onDone: () => done++, onStep: (i) => passed.push(t.steps[i].id) });
  let k = 0;
  let stepK = 0;
  let last = t.step;
  for (; k < stopAt && !t.finished; k++) {
    if (t.step !== last) { last = t.step; stepK = 0; }
    const act = (t.step && ACT[t.step.id]) ? ACT[t.step.id](stepK++) : {};
    core.frame(1 / 60, { status: 7, lean: 0, block: 0, punchMask: 0, kickMask: 0, moveForward: 0, moveSide: 0, confidence: 1, ...act });
    const snap = core.snapshot();
    for (const e of core.drainEvents().combat) t.onCombat(e);
    if (snap.match.phaseName === 'Training') t.update(1 / 60, snap);
  }
  return { t, done, passed, seconds: k / 60, phase: core.snapshot().match.phaseName };
}

console.log('--- keys: every step on the real core');
const keys = await run('keys');
check('the bout is in the training phase', keys.phase === 'Training', keys.phase);
check('all six steps pass in order', keys.passed.join(',') === 'jab,cross,block,slip,hook,step', keys.passed.join(','));
check('the tutorial reports done once', keys.done === 1 && keys.t.outcome === 'done');
check('it takes under a minute of scripted play', keys.seconds < 60, `${keys.seconds.toFixed(1)} s`);

console.log('--- touch and camera');
const touch = new Tutorial({ control: 'touch' });
check('touch has no footwork step (the pad has no move keys)', touch.steps.length === TUTORIAL_STEPS.length - 1 && !touch.steps.some((s) => s.id === 'step'));
const cam = new Tutorial({ control: 'camera' });
check('camera gets every step with body hints', cam.steps.length === TUTORIAL_STEPS.length && /руку/.test(cam.step.camera));
const touchRun = await run('touch');
check('touch: the five steps pass on the real core', touchRun.done === 1 && touchRun.passed.length === 5, touchRun.passed.join(','));

console.log('--- skip and next');
let skipped = -1;
const s1 = new Tutorial({ control: 'keys', onSkip: (i) => { skipped = i; } });
s1.onCombat({ typeName: 'AttackStarted', actor: 0, kind: 0, hand: 0 });
s1.onCombat({ typeName: 'AttackStarted', actor: 1, kind: 0, hand: 0 }); // the opponent's jab is not the player's
check('a jab by the other fighter does not count', s1.count === 1);
s1.skip();
check('skip ends it at the current step', s1.finished && s1.outcome === 'skipped' && skipped === 0);
s1.onCombat({ typeName: 'AttackStarted', actor: 0, kind: 0, hand: 0 });
check('nothing counts after skip', s1.index === 0);
let doneN = 0;
const s2 = new Tutorial({ control: 'keys', onDone: () => doneN++ });
for (let i = 0; i < TUTORIAL_STEPS.length; i++) s2.next();
check('"Дальше" on every step finishes it', s2.finished && s2.outcome === 'done' && doneN === 1);
const s3 = new Tutorial({ control: 'keys' });
s3.onCombat({ typeName: 'AttackStarted', actor: 0, kind: 4, hand: 0 });
check('a hook does not pass the jab step', s3.index === 0 && s3.count === 0);

console.log('--- the tip on the results screen');
const base = { thrown: 30, landed: 12, blocksMade: 5, dodgesMade: 3 };
const foe = { blocksMade: 2 };
const taken = (o) => ({ straight: 0, hook: 0, upper: 0, body: 0, kick: 0, elbow: 0, knee: 0, ...o });
check('lost to hooks: duck or block', /нырок|ныряй|Нырок/i.test(resultTip({ taken: taken({ hook: 6, straight: 2 }) }, base, foe, { won: false })));
check('lost to uppercuts: slip', /уклон/i.test(resultTip({ taken: taken({ upper: 4 }) }, base, foe, { won: false })));
check('countered often: timing', /встречн/i.test(resultTip({ taken: taken({ straight: 5 }), counters: 3 }, base, foe, { won: false })));
check('many whiffs: step in (keys)', /W/.test(resultTip({ taken: taken({}), whiffs: 6 }, base, foe, { won: false })));
check('many whiffs: lean in (camera words, no keys)', !/\(W\)/.test(resultTip({ taken: taken({}), whiffs: 6 }, base, foe, { won: false, camera: true })));
check('gassed: pace', /паузы/.test(resultTip({ taken: taken({}), gassed: 1 }, base, foe, { won: false })));
check('no defence: block and slip', /Пробел/.test(resultTip({ taken: taken({ straight: 12 }) }, { ...base, blocksMade: 1, dodgesMade: 1 }, foe, { won: false })));
check('poor accuracy', /Точность/.test(resultTip({ taken: taken({ straight: 3 }) }, { ...base, landed: 4 }, foe, { won: false })));
check('a win below Hard: a stronger opponent', /сильнее/.test(resultTip({ taken: taken({}) }, base, foe, { won: true, level: 0 })));
check('a win over Hard: rating and online', /рейтинг/.test(resultTip({ taken: taken({}) }, base, foe, { won: true, level: 2 })));
check('an opponent who blocks a lot: uppercut / body', /апперкот/i.test(resultTip({ taken: taken({ straight: 2 }) }, base, { blocksMade: 9 }, { won: false })));
check('a tip always exists', resultTip({}, { thrown: 0, landed: 0 }, {}, {}).length > 10);

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
