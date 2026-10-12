// Takes apart a camera recording saved in the game with F4 (ironecho-trace-*.json or .json.gz): feeds the skeleton frames through the same
// PoseProcessor the game uses and prints what the camera saw (how often the player was missing, which body parts were seen) and what
// the detectors made of it (calibration, every strike with its time). Also the library for trace_test.mjs.
//
//   node Tests/Web/replay_trace.mjs ironecho-trace-1730000000000.json.gz [--json]
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const POSE_SRC = join(here, '..', '..', 'Tools', 'Build', 'Web', 'site', 'src', 'pose.js');

export async function loadPose() {
  return import(`data:text/javascript;base64,${Buffer.from(readFileSync(POSE_SRC, 'utf8')).toString('base64')}`);
}

export function readTrace(path) {
  const buf = readFileSync(path);
  const text = buf[0] === 0x1f && buf[1] === 0x8b ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
  const trace = JSON.parse(text);
  if (trace.format !== 'ironecho-trace') throw new Error('not an IRON ECHO trace');
  return trace;
}

const world = (w) => (w ? w.map(([x, y, z, v]) => ({ x, y, z, visibility: v })) : null);
const image = (i) => (i ? i.map(([x, y]) => ({ x, y })) : null);

const PUNCH_BITS = [[1, 'прямой левой'], [2, 'прямой правой'], [4, 'в корпус левой'], [8, 'в корпус правой'], [16, 'локоть левый'], [32, 'локоть правый'],
  [64, 'хук левой'], [128, 'хук правой'], [256, 'хук в корпус левой'], [512, 'хук в корпус правой'], [1024, 'апперкот левой'], [2048, 'апперкот правой']];
const KICK_BITS = [[1, 'нога средняя левой'], [2, 'нога средняя правой'], [4, 'нога низкая левой'], [8, 'нога низкая правой'], [16, 'колено левое'], [32, 'колено правое']];
export const decodeMasks = (punchMask, kickMask) => [
  ...PUNCH_BITS.filter(([b]) => punchMask & b).map(([, n]) => n),
  ...KICK_BITS.filter(([b]) => kickMask & b).map(([, n]) => n),
];

const GROUPS = { голова: [0], плечи: [11, 12], локти: [13, 14], кисти: [15, 16], бёдра: [23, 24], колени: [25, 26], стопы: [27, 28] };
const STATUS = { 3: 'нет человека', 4: 'плохо видно', 6: 'калибровка', 7: 'работает' };

// Feeds the recording through a fresh PoseProcessor. Returns { events, calibratedAt, calibration, report }.
export function replay(PoseProcessor, trace, opts = {}) {
  const proc = new PoseProcessor(() => {}, opts);
  const frames = [...trace.tape, ...trace.frames];
  const events = [];
  const statusCount = {};
  const vis = Object.fromEntries(Object.keys(GROUPS).map((g) => [g, { sum: 0, n: 0, seen: 0 }]));
  let calibratedAt = null;
  let seenFrames = 0;
  let prevT = null;
  let totalGap = 0;
  const feed = (t, w, i) => {
    proc.process(w, t, i);
    const r = proc.poll();
    if (calibratedAt === null && proc.cal) calibratedAt = t;
    statusCount[r.status] = (statusCount[r.status] || 0) + 1;
    if (r.punchMask || r.kickMask) events.push({ t, what: decodeMasks(r.punchMask, r.kickMask) });
  };
  for (const f of frames) {
    if (prevT !== null && f.t - prevT > 0.5) { // the recording skips the middle of a long session: the player "leaves" for a moment
      feed(prevT + 0.4, null, null);
      totalGap += f.t - prevT;
    }
    const w = world(f.w);
    if (w) {
      seenFrames++;
      for (const [g, idx] of Object.entries(GROUPS)) {
        const v = idx.reduce((a, k) => a + (w[k].visibility ?? 1), 0) / idx.length;
        vis[g].sum += v; vis[g].n++; if (v >= 0.5) vis[g].seen++;
      }
    }
    feed(f.t, w, image(f.i));
    prevT = f.t;
  }
  const spanT = frames.length > 1 ? frames[frames.length - 1].t - frames[0].t - totalGap : 0;
  const report = {
    frames: frames.length, seconds: +spanT.toFixed(1), fps: spanT > 0 ? +(frames.length / spanT).toFixed(1) : 0,
    playerSeen: frames.length ? +(seenFrames / frames.length).toFixed(3) : 0,
    visibility: Object.fromEntries(Object.entries(vis).map(([g, v]) => [g, v.n ? { mean: +(v.sum / v.n).toFixed(2), shareSeen: +(v.seen / v.n).toFixed(2) } : null])),
    status: Object.fromEntries(Object.entries(statusCount).map(([k, v]) => [STATUS[k] || k, v])),
  };
  return { proc, events, calibratedAt, report };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const file = process.argv[2];
  if (!file) { console.error('usage: node replay_trace.mjs <ironecho-trace-*.json[.gz]> [--json]'); process.exit(2); }
  const trace = readTrace(file);
  const { PoseProcessor } = await loadPose();
  const { events, calibratedAt, report, proc } = replay(PoseProcessor, trace);
  if (process.argv.includes('--json')) { console.log(JSON.stringify({ meta: trace.meta, report, calibratedAt, events }, null, 1)); process.exit(0); }
  const m = trace.meta || {};
  console.log(`игра ${m.game || '?'}, ${m.savedAt || ''}\nкамера ${JSON.stringify(m.camera)} видео ${JSON.stringify(m.video)}, детектор ${m.detector}, ${m.fps} к/с, ${m.inferMs} мс, свет ${JSON.stringify(m.light)}`);
  console.log(`вторая камера: ${m.second}/${m.secondState}${m.secondReason ? ` (${m.secondReason})` : ''}`);
  console.log(`\nкадров ${report.frames} за ${report.seconds} с (${report.fps} к/с); человек виден в ${(report.playerSeen * 100).toFixed(0)}% кадров`);
  console.log('видимость частей тела (средняя / доля кадров, где видно):');
  for (const [g, v] of Object.entries(report.visibility)) console.log(`  ${g.padEnd(7)} ${v ? `${v.mean.toFixed(2)} / ${(v.shareSeen * 100).toFixed(0)}%` : '-'}`);
  console.log(`состояния: ${JSON.stringify(report.status)}`);
  console.log(calibratedAt === null ? '\nКалибровка в записи НЕ завершилась (человек не выполнил шаги или его не было видно).'
    : `\nКалибровка завершена на ${calibratedAt.toFixed(1)} с. Личные пороги ударов: ${JSON.stringify(proc.cal.punchLimits)}`);
  console.log(`\nдетекторы заново на этой записи: ${events.length} срабатываний`);
  for (const e of events) console.log(`  ${e.t.toFixed(2).padStart(7)} с  ${e.what.join(' + ')}`);
  const recorded = trace.decisions || [];
  console.log(`\nигре в бою было отдано: ${recorded.length} срабатываний`);
  for (const d of recorded) console.log(`  ${d.t.toFixed(2).padStart(7)} с  ${decodeMasks(d.punch, d.kick).join(' + ')}`);
}
