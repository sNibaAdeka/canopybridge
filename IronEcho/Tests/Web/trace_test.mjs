// The camera recording (F4) and its replay, without a browser: a synthetic fighter is run through the same chain the game uses
// (TraceRecorder -> PoseProcessor -> poll), the recording is written as gzip JSON, read back and replayed through a fresh PoseProcessor.
// The replay has to calibrate exactly like the game did and give the same strikes (the file keeps millimetres, so a borderline frame may
// differ: a small tolerance, not bit equality).
//
//   node Tests/Web/trace_test.mjs
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadPose, readTrace, replay, decodeMasks } from './replay_trace.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const { Script, stream, calibration, rng } = await import(pathToFileURL(path.join(HERE, 'pose_sim.mjs')));
globalThis.setTimeout = () => 0;
const { PoseProcessor, TraceRecorder } = await loadPose();

const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`); };

// calibration, then 70 s of strikes (longer than the 25 s ring, so the tape and the ring really are two pieces)
const { script, end } = calibration(new Script(), { punches: true });
const r = rng(4242);
const kinds = [];
for (let i = 0; i < 14; i++) kinds.push('punch', 'elbow', 'knee', 'hook', 'upper', 'kick');
let t = end + 1;
for (const [i, kind] of kinds.entries()) {
  const side = i % 2;
  if (kind === 'punch') script.punch(t, side, { up: 0.13 });
  if (kind === 'elbow') script.elbow(t, side, { up: 0.13 });
  if (kind === 'knee') script.knee(t, side, { up: 0.16 });
  if (kind === 'hook') script.hook(t, side, { up: 0.2 });
  if (kind === 'upper') script.uppercut(t, side, { up: 0.2 });
  if (kind === 'kick') script.kick(t, side, { up: 0.18 });
  t += 0.8 + r() * 0.3;
}
script.idle(t, 1.0);
script.fidget(0.03);

// the game's own chain
const rec = new TraceRecorder(25);
const proc = new PoseProcessor(() => {}, {});
let frames = 0;
let lastT = 0;
let nextPoll = 0;
for (const fr of stream(script, { fps: 45, seed: 7 })) {
  frames++;
  lastT = fr.t;
  rec.add(fr.t, fr.world, fr.image);
  proc.process(fr.world, fr.t, fr.image);
  if (proc.cal) rec.calibrated(fr.t);
  if (fr.t >= nextPoll) { // the game polls ~60 times a second
    nextPoll = fr.t + 1 / 60;
    const p = proc.poll();
    if (p.punchMask || p.kickMask) rec.note(fr.t, p.punchMask, p.kickMask);
  }
}
check('the synthetic session calibrated and struck', !!proc.cal && proc.punches.length > 10, `${frames} frames, ${lastT.toFixed(0)} s, ${proc.punches.length} punches, ${proc.kicks.length} kicks`);
check('the ring holds the last 25 s and no more', rec.frames.length > 100 && rec.frames[rec.frames.length - 1].t - rec.frames[0].t <= 25.01, `${rec.frames.length} frames`);
check('the tape holds the start of the session and closed after calibration', rec.tape.length > 50 && !rec.tapeOpen && rec.tape[rec.tape.length - 1].t < lastT - 30, `${rec.tape.length} frames, ends at ${rec.tape[rec.tape.length - 1].t.toFixed(1)} s`);

const trace = rec.build({ game: 'test' });
const dir = mkdtempSync(path.join(tmpdir(), 'ie-trace-'));
const file = path.join(dir, 'trace.json.gz');
writeFileSync(file, gzipSync(JSON.stringify(trace)));
const back = readTrace(file);
check('the file round-trips (gzip JSON)', back.format === 'ironecho-trace' && back.tape.length === trace.tape.length && back.frames.length === trace.frames.length, `tape ${back.tape.length} + ring ${back.frames.length} frames`);
const times = [...back.tape, ...back.frames].map((f) => f.t);
check('times only go forward', times.every((x, i) => i === 0 || x > times[i - 1]));
check('no picture data, only landmark numbers', Object.keys(back.tape[0]).sort().join() === 'i,t,w' && back.tape[0].w.length === 33 && back.tape[0].w[0].length === 4);

const out = replay(PoseProcessor, back);
check('the replay calibrates', out.calibratedAt !== null && !!out.proc.cal, `at ${out.calibratedAt === null ? '-' : out.calibratedAt.toFixed(1)} s`);
const lim = (p) => (p.cal.punchLimits || []).map((l) => (l ? +l.extVel.toFixed(2) : null));
check('with the same personal limits as the game', JSON.stringify(lim(out.proc)) === JSON.stringify(lim(proc)) || out.proc.cal.punchLimits.every((l, k) => !l || !proc.cal.punchLimits[k] || Math.abs(l.extVel - proc.cal.punchLimits[k].extVel) < 0.15),
  `${JSON.stringify(lim(out.proc))} vs ${JSON.stringify(lim(proc))}`);

// the strikes the game was told in the last 25 s are found again at the same moments, with the same names
const t0 = [...rec.tape, ...rec.frames][0].t;
const gameSide = back.decisions.map((d) => ({ t: d.t, what: decodeMasks(d.punch, d.kick).join('+') }));
let matched = 0;
for (const g of gameSide) if (out.events.some((e) => Math.abs(e.t - g.t) < 0.08 && e.what.join('+') === g.what)) matched++;
check('the replay gives the strikes the game was told', gameSide.length > 8 && matched >= gameSide.length * 0.9, `${matched}/${gameSide.length} found again`);
check('and nothing else in that window', out.events.filter((e) => e.t >= (back.decisions[0] ? back.decisions[0].t - 0.05 : 0)).length <= gameSide.length + 2, `${out.events.length} replay events in all`);
check('the report counts what the camera saw', out.report.playerSeen > 0.95 && out.report.visibility['кисти'] && out.report.visibility['кисти'].mean > 0.8 && out.report.fps > 30, JSON.stringify({ seen: out.report.playerSeen, fps: out.report.fps }));
console.log(`      file: ${(gzipSync(JSON.stringify(trace)).length / 1024).toFixed(0)} KB gzip, ${(JSON.stringify(trace).length / 1024).toFixed(0)} KB raw`);
check('the file stays small enough to send (< 2.5 MB gzip)', gzipSync(JSON.stringify(trace)).length < 2.5e6);

// an empty recorder still builds
const empty = new TraceRecorder(25).build({});
check('an empty recording builds', empty.frames.length === 0 && empty.tape.length === 0 && empty.seconds === 0);

rmSync(dir, { recursive: true, force: true });
const failed = results.filter((x) => !x).length;
console.log(`${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
