// Collection Mode and the accuracy evaluator, end to end without a browser: the cue runner (site/src/collect.js) schedules a whole condition,
// the synthetic fighter (pose_sim.mjs) performs each cued strike 0.3 s after "ДАВАЙ" (a human reaction), the frames go through the same chain
// as in the game (TraceRecorder in session mode -> PoseProcessor -> poll), the session file is written (gzip), read back and scored by
// Tools/Build/Eval/eval_camera.mjs. The synthetic body is clean, so the scores must be high; a few cues are deliberately left unperformed
// to prove that misses are counted as misses.
//
//   node Tests/Web/collect_eval_test.mjs
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', '..', 'Tools', 'Build', 'Web', 'site', 'src');
globalThis.setTimeout = () => 0;
const { Script, stream, calibration, rng } = await import(pathToFileURL(path.join(HERE, 'pose_sim.mjs')));
const { loadPose } = await import(pathToFileURL(path.join(HERE, 'replay_trace.mjs')));
const { CollectRunner, collectCues, collectBuildFile, collectIsStrike, collectText, collectJson } = await import(pathToFileURL(path.join(SRC, 'collect.js')));
const ev = await import(pathToFileURL(path.join(HERE, '..', '..', 'Tools', 'Build', 'Eval', 'eval_camera.mjs')));
const { PoseProcessor, TraceRecorder } = await loadPose();

const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`); };

// ---- the runner alone
{
  const r = rng(11);
  const cues = collectCues(r, { legs: true });
  const strikes = cues.filter((c) => collectIsStrike(c.kind));
  check('one condition asks ~130 cues, both sides of every strike', cues.length >= 120 && cues.length <= 150 && ['straight', 'hook', 'upper', 'elbow', 'knee', 'kick']
    .every((k) => strikes.some((c) => c.kind === k && c.side === 'L') && strikes.some((c) => c.kind === k && c.side === 'R')), `${cues.length} cues`);
  check('without legs in view there are no knee or kick cues', !collectCues(rng(11), { legs: false }).some((c) => c.kind === 'knee' || c.kind === 'kick'));
  check('every cue has a Russian instruction', cues.every((c) => collectText(c).length > 3), collectText(cues.find((c) => c.kind === 'hook')));

  const run = new CollectRunner(cues.slice(0, 12), { rand: rng(3) });
  let t = 0;
  const seen = [];
  let invisibleOnce = true;
  while (!run.finished && t < 200) {
    const visible = !(invisibleOnce && run.phase === 'prep' && run.cue && run.cue.kind === 'block');
    const v = run.tick(t, visible);
    if (v.phase === 'go' && seen[seen.length - 1] !== v.cue) seen.push(v.cue);
    if (run.phase === 'go' && run.cue && run.cue.status === 'invisible') invisibleOnce = false;
    t += 1 / 30;
  }
  const out = run.results();
  const rests = [];
  for (let i = 1; i < out.length; i++) if (out[i].t !== null && out[i - 1].t !== null) rests.push(out[i].t - out[i - 1].t - out[i - 1].dur);
  check('the runner goes through every cue and finishes', run.finished && out.filter((c) => c.status === 'ok').length === 12, `${out.length} recorded in ${t.toFixed(0)} s`);
  check('a cue asked while the player was not visible is asked again (once)', out.some((c) => c.status === 'invisible') && out.filter((c) => c.kind === 'block' && c.status === 'ok').length === 5);
  check('rests between cues: instruction + random 1.4-2.0 s', rests.every((x) => x > 1.4 + 0.9 - 0.05 && x < 2.0 + 0.9 + 0.1), `${Math.min(...rests).toFixed(2)}–${Math.max(...rests).toFixed(2)} s`);

  const r2 = new CollectRunner(cues.slice(0, 8), { rand: rng(5) });
  let t2 = 0;
  while (r2.phase !== 'go') t2 += 0.05, r2.tick(t2);
  r2.redo();
  r2.pause();
  r2.tick(t2 + 50);
  check('pause holds the runner', r2.phase === 'paused');
  r2.resume(t2 + 50);
  let guard = 0;
  while (!r2.finished && guard++ < 5000) { t2 += 1 / 30; r2.tick(t2 + 50); }
  const o2 = r2.results();
  check('redo and pause: the interrupted cue is marked and asked again', o2.filter((c) => c.status === 'redo').length >= 1 && o2.filter((c) => c.status === 'ok').length === 8);
}

// ---- a whole condition performed by the synthetic fighter
const { script, end } = calibration(new Script(), { punches: true });
const cues = collectCues(rng(42), { legs: true });
const runner = new CollectRunner(cues, { rand: rng(7) });
const skipped = new Set();
let t = end + 2;
let k = 0;
while (!runner.finished && t < end + 900) {
  const v = runner.tick(t, true);
  if (v.phase === 'go' && v.cue && v.cue.t === t) {
    const c = v.cue;
    const at = t + 0.3;
    const side = c.side === 'R' ? 1 : 0;
    k++;
    // every 25th strike is left out on purpose: those must come out as misses
    if (collectIsStrike(c.kind) && k % 25 === 0) skipped.add(c);
    else if (c.kind === 'straight') script.punch(at, side, { up: 0.13, body: c.target === 'body' });
    else if (c.kind === 'hook') script.hook(at, side, { up: 0.2, body: c.target === 'body' });
    else if (c.kind === 'upper') script.uppercut(at, side, { up: 0.2 });
    else if (c.kind === 'elbow') script.elbow(at, side, { up: 0.13 });
    else if (c.kind === 'knee') script.knee(at, side, { up: 0.16 });
    else if (c.kind === 'kick') script.kick(at, side, { up: 0.18, low: c.target === 'low' });
    else if (c.kind === 'duck') script.duck(at, 1.0, 0.28);
    else if (c.kind === 'block') script.block(at, (c.hold || 2) + 0.1);
    else if (c.kind === 'slip') script.slip(at, (c.hold || 1) + 0.2, side ? 0.2 : -0.2);
    else if (c.kind === 'lean') script.leanForward(at, 1.3, 0.18); // a real lean toward the screen is 15-20 cm
  }
  t += 1 / 60;
}
script.idle(t, 1);
script.fidget(0.03);
check('the synthetic condition completes', runner.finished, `${(t - end).toFixed(0)} s after calibration, ${skipped.size} strikes left out`);

const rec = new TraceRecorder(25);
rec.beginSession(1200);
const proc = new PoseProcessor(() => {}, {});
let nextPoll = 0;
for (const fr of stream(script, { fps: 30, seed: 9 })) {
  rec.add(fr.t, fr.world, fr.image);
  proc.process(fr.world, fr.t, fr.image);
  if (fr.t >= nextPoll) { nextPoll = fr.t + 1 / 60; const p = proc.poll(); if (p.punchMask || p.kickMask) rec.note(fr.t, p.punchMask, p.kickMask); }
}
const session = rec.endSession();
const file = collectBuildFile({ version: 'test', consentAt: 'now', participant: { id: 'p_test' }, session, cues: runner.results(),
  condition: { id: 'A', title: 'test' }, device: { ua: 'node' } });
const dir = mkdtempSync(path.join(tmpdir(), 'ie-collect-'));
const fpath = path.join(dir, 'ironecho-session-p_test-A.json.gz');
const text = collectJson(file);
const roundTrip = JSON.parse(text);
check('the page\'s piecewise JSON is valid and equals the object (also with no frames)', Object.keys(file).every((k) => JSON.stringify(roundTrip[k]) === JSON.stringify(file[k])) && Object.keys(roundTrip).length === Object.keys(file).length
  && JSON.parse(collectJson({ ...file, frames: [] })).frames.length === 0 && JSON.parse(collectJson({ ...file, frames: [] })).cues.length === file.cues.length);
const gz = gzipSync(text);
writeFileSync(fpath, gz);
check('a session file is small enough to send (< 12 MB gzip for one condition)', gz.length < 12e6, `${(gz.length / 1e6).toFixed(1)} MB, ${file.frames.length} frames, ${(session.seconds / 60).toFixed(1)} min`);
check('frames are kept at about 30 a second', file.frames.length / session.seconds > 25 && file.frames.length / session.seconds < 32, `${(file.frames.length / session.seconds).toFixed(1)} fps`);
check('the live detectors\' decisions are in the file', file.gameEvents.length > 50, `${file.gameEvents.length}`);

const evalResults = await ev.evaluateFiles(ev.listSessionFiles([dir]));
const r0 = evalResults[0].eval;
check('the evaluator calibrates from the file', r0.calibratedAt !== null, `at ${r0.calibratedAt === null ? '-' : r0.calibratedAt.toFixed(1)} s`);
const agg = ev.aggregate(evalResults);
const row = (kind) => agg.table.find((x) => x.kind === kind && x.cond === 'all');
const floors = { straight: 0.85, hook: 0.8, upper: 0.8, elbow: 0.8, knee: 0.8, kick: 0.75, block: 0.85, slip: 0.85, duck: 0.85, lean: 0.75 };
for (const [kind, floor] of Object.entries(floors)) {
  const x = row(kind);
  check(`${kind}: scored on the clean synthetic body`, x && x.hit >= floor, x ? `hit ${(x.hit * 100).toFixed(0)}%, kind-only ${(x.kindOnly * 100).toFixed(0)}%, wrong ${(x.wrong * 100).toFixed(0)}%, miss ${(x.miss * 100).toFixed(0)}% of ${x.n}, delay ${x.delayMs} ms, from onset ${x.fromOnsetMs} ms` : 'no row');
}
const leftOut = r0.scored.filter((s) => skipped.has(runner.done.find((c) => c.t !== undefined && Math.abs((c.t - session.t0) - s.t) < 1e-3)));
check('strikes that were not performed are counted as misses', leftOut.length === skipped.size && leftOut.every((s) => s.result === 'MISS'), `${leftOut.filter((s) => s.result === 'MISS').length}/${skipped.size}`);
check('false positives in the quiet blocks are counted (≤ 1 a minute here)', agg.fpPerQuietMinute !== null && agg.fpPerQuietMinute <= 1, `${agg.fpQuiet} in ${agg.quietSeconds.toFixed(0)} s`);
const md = ev.markdown(agg, evalResults, { date: '2026-01-01', version: 'test' });
check('the markdown report has a row per strike and the file list', md.includes('| hook | all |') && md.includes('ironecho-session-p_test-A.json.gz'));
const again = ev.aggregate(await ev.evaluateFiles(ev.listSessionFiles([dir])));
check('the evaluation is deterministic', JSON.stringify(again) === JSON.stringify(agg));

rmSync(dir, { recursive: true, force: true });
const failed = results.filter((x) => !x).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
