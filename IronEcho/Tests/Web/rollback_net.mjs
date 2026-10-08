// Rollback netcode, deterministic proof without a browser: two real rules cores (WebAssembly, separate instances) are driven by
// NetRollback through a simulated network (latency, jitter, asymmetric links, a late start of one side, slow frames) and must end up
// in exactly the state of a reference run that feeds the same inputs in order, with no network at all.
//
//   node Tests/Web/rollback_net.mjs        (needs Build/Web/core/ironecho_core.wasm: python Tools/Build/Web/build_web.py core)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJECT = path.resolve(HERE, '..', '..');
const SRC = path.join(PROJECT, 'Tools', 'Build', 'Web', 'site', 'src');
const WASM = process.env.IRONECHO_CORE_WASM || path.join(PROJECT, 'Build', 'Web', 'core', 'ironecho_core.wasm');
if (!fs.existsSync(WASM)) { console.error(`no core at ${WASM}; run: python Tools/Build/Web/build_web.py core`); process.exit(2); }
globalThis.IRONECHO_CORE_WASM_B64 = fs.readFileSync(WASM).toString('base64');
const { loadCore } = await import(pathToFileURL(path.join(SRC, 'core.js')));
const { NetRollback, netChooseRollbackDelay } = await import(pathToFileURL(path.join(SRC, 'net.js')));

const results = [];
const check = (name, ok, info = '') => { results.push(!!ok); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${info ? `  (${info})` : ''}`); };

// ---- scripted human-like input for (slot, frame): a deterministic function, the same on every machine
function rng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
function scripted(slot, f) {
  const r = rng(f * 7919 + slot * 104729 + 17);
  const t = f / 60;
  const punch = r() < 0.07 ? [1, 2, 4, 8][(r() * 4) | 0] : 0;
  const kick = r() < 0.02 ? [1, 2, 4, 8][(r() * 4) | 0] : 0;
  const block = Math.sin(t * (slot ? 1.3 : 0.9) + slot) > 0.55 ? 1 : 0;
  const lean = Math.round(Math.sin(t * 2.1 + slot * 2) * 40) / 100;
  const fwd = Math.sin(t * 0.6 + slot) > 0.2 ? 1 : (Math.sin(t * 0.6 + slot) < -0.6 ? -1 : 0);
  return [7, 1, lean, 0, block, punch, kick, fwd, Math.round(Math.cos(t * 0.5) * 50) / 100, 0];
}
const NEUTRAL = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

// ---- a pair of rooms joined by a simulated, ordered, reliable network
class Net {
  constructor(lat01, lat10, jitter, seed) { this.now = 0; this.q = []; this.lat = [lat01, lat10]; this.jitter = jitter; this.r = rng(seed); this.last = [0, 0]; this.sent = 0; }
}
class FakeRoom {
  constructor(net, side) { this.net = net; this.side = side; this.handlers = {}; this.rtt = 0; this.peer = null; }
  on(name, fn) { this.handlers[name] = fn; return this; }
  send(msg) {
    const n = this.net;
    const at = Math.max(n.last[this.side], n.now + (n.lat[this.side] + n.r() * n.jitter) / 1000);
    n.last[this.side] = at;
    n.sent++;
    n.q.push({ at, to: this.peer, msg: JSON.parse(JSON.stringify(msg)) });
  }
}
function deliver(net) {
  net.q.sort((a, b) => a.at - b.at);
  while (net.q.length && net.q[0].at <= net.now) { const e = net.q.shift(); e.to.handlers.message && e.to.handlers.message(e.msg); }
}

const SEED = 4242;
async function freshCore() { const c = await loadCore(); c.init({ mode: 2, level: 1, seed: SEED, rounds: 0, roundSeconds: 0 }); return c; }
const words = (c) => Array.from(c.stateWords());
const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);

async function reference(frames, D) {
  const c = await freshCore();
  const matchEvents = [];
  const combat = new Set();
  for (let f = 0; f < frames; f++) {
    c.versusStep(f < D ? NEUTRAL : scripted(0, f - D), f < D ? NEUTRAL : scripted(1, f - D));
    const ev = c.drainEvents();
    for (const e of ev.match) matchEvents.push(`${e.typeName}:${e.phaseName}:${e.tick}`);
    for (const e of ev.combat) combat.add(`${e.type}|${e.actor}|${e.attackId}|${e.tick}`);
  }
  return { state: words(c), matchEvents, combat, snapshot: c.snapshot() };
}

// The sample() of the pages returns the input for the frame the engine asks about: here the scripted one for (slot, frame - D).
// (An input made at frame f is applied at f + D, so the reference above feeds scripted(slot, f - D) at frame f.)
async function scenario(name, { frames, D, lat01, lat10, jitter, lateStart = 0, slowEvery = 0, seed = 1, rtt }) {
  const net = new Net(lat01, lat10, jitter, seed);
  const rooms = [new FakeRoom(net, 0), new FakeRoom(net, 1)];
  rooms[0].peer = rooms[1];
  rooms[1].peer = rooms[0];
  rooms[0].rtt = rooms[1].rtt = rtt ?? lat01 + lat10;
  const cores = [await freshCore(), await freshCore()];
  const events = [{ combat: [], match: [] }, { combat: [], match: [] }];
  const locks = [0, 1].map((slot) => new NetRollback({ core: cores[slot], room: rooms[slot], slot, delay: D, sample: (f) => scripted(slot, f - D), onDesync: (f) => { locks[slot].bad = f; if (process.env.DBG) console.log('DESYNC', slot, f, 'own', locks[slot].hashes.get(f), 'remote', locks[slot].remoteHashes.get(f), 'hashFrom', locks[slot].hashFrom, 'remoteNext', locks[slot].remoteNext, 'frame', locks[slot].frame, 'rollTo', locks[slot].rollTo, new Error().stack.split('\n').slice(2,5).join(' <- ')); } }));
  let tick = 0;
  let worstAhead = 0;
  while (locks[0].frame < frames || locks[1].frame < frames) {
    tick++;
    net.now += 1 / 60;
    deliver(net);
    for (let s = 0; s < 2; s++) {
      if (locks[s].frame >= frames) continue;
      if (s === 1 && tick < lateStart) continue; // the guest starts later (loading the arena)
      const dt = slowEvery && tick % slowEvery === 0 ? 3 / 60 : 1 / 60; // an occasional slow frame: three frames of time at once
      locks[s].update(dt);
      const e = locks[s].takeEvents();
      events[s].combat.push(...e.combat);
      events[s].match.push(...e.match);
    }
    worstAhead = Math.max(worstAhead, Math.abs(locks[0].frame - locks[1].frame));
    if (tick > frames * 8) break;
  }
  // settle: let the last messages arrive and replay what they change (the peers do not advance any more)
  for (let k = 0; k < 40; k++) { net.now += 0.05; deliver(net); }
  for (const l of locks) { l._rollback(); l._settle(); }
  for (let s = 0; s < 2; s++) { const e = locks[s].takeEvents(); events[s].combat.push(...e.combat); events[s].match.push(...e.match); }
  if (process.env.DBG) console.log('hashes A', [...locks[0].hashes], 'B', [...locks[1].hashes], 'remoteA', [...locks[0].remoteHashes], 'remoteB', [...locks[1].remoteHashes], 'hashFrom', locks[0].hashFrom, locks[1].hashFrom, 'frames', locks[0].frame, locks[1].frame);
  const ref = await reference(frames, D);
  const stateA = words(cores[0]);
  const stateB = words(cores[1]);
  const matchOf = (s) => events[s].match.map((e) => `${e.typeName}:${e.phaseName}:${e.tick}`);
  const rb = locks.map((l) => l.rollbacks);
  const depth = locks.map((l) => (l.rollbacks ? (l.rolledFrames / l.rollbacks).toFixed(1) : '0'));
  const snapA = cores[0].snapshot();
  check(`${name}: both machines end in the very state of the no-network reference`, same(stateA, ref.state) && same(stateB, ref.state),
    `${frames} frames, thrown ${snapA.player.thrown}/${snapA.opponent.thrown}, landed ${snapA.player.landed}/${snapA.opponent.landed}`);
  check(`${name}: no desync reported, hashes compared`, !locks[0].bad && !locks[1].bad && !locks[0].desynced && !locks[1].desynced, `bad ${locks[0].bad}/${locks[1].bad}, hashes ${locks[0].hashes.size}/${locks[1].hashes.size}, remote ${locks[0].remoteHashes.size}/${locks[1].remoteHashes.size}`);
  check(`${name}: match events (rounds, knockdowns, end) reach each side exactly once and equal the reference`,
    JSON.stringify(matchOf(0)) === JSON.stringify(ref.matchEvents) && JSON.stringify(matchOf(1)) === JSON.stringify(ref.matchEvents), `${ref.matchEvents.length} events`);
  const covered = (s) => [...ref.combat].filter((k) => events[s].combat.some((e) => `${e.type}|${e.actor}|${e.attackId}|${e.tick}` === k)).length;
  check(`${name}: every real combat event was shown on both sides`, covered(0) === ref.combat.size && covered(1) === ref.combat.size, `${ref.combat.size} events, extra shown ${events[0].combat.length - ref.combat.size}/${events[1].combat.length - ref.combat.size}`);
  console.log(`      rollbacks ${rb[0]}/${rb[1]}, mean depth ${depth[0]}/${depth[1]} frames, deepest ${locks[0].deepest}/${locks[1].deepest}, clock gap max ${worstAhead} frames, messages ${net.sent}`);
  return { locks, ref };
}

console.log('--- rollback netcode on two real cores through a simulated network');
await scenario('no latency', { frames: 1500, D: 2, lat01: 0, lat10: 0, jitter: 0, rtt: 0 });
await scenario('good link 40 ms round trip', { frames: 2400, D: 2, lat01: 20, lat10: 20, jitter: 4, rtt: 40, seed: 3 });
await scenario('normal link 110 ms with jitter', { frames: 2400, D: 2, lat01: 55, lat10: 55, jitter: 30, rtt: 110, seed: 5 });
await scenario('bad link 260 ms with heavy jitter', { frames: 2400, D: 4, lat01: 130, lat10: 130, jitter: 80, rtt: 260, seed: 9 });
await scenario('asymmetric 15 ms / 120 ms', { frames: 2400, D: 3, lat01: 15, lat10: 120, jitter: 20, rtt: 135, seed: 11 });
await scenario('guest starts 40 frames late', { frames: 2400, D: 2, lat01: 40, lat10: 40, jitter: 10, lateStart: 40, rtt: 80, seed: 13 });
await scenario('slow frames on both sides', { frames: 2400, D: 2, lat01: 50, lat10: 50, jitter: 10, slowEvery: 37, rtt: 100, seed: 17 });

// ---- how fast a punch answers: frames from the key press to the first tick of the attack
async function responseFrames(D, rtt) {
  const net = new Net(rtt / 2, rtt / 2, 0, 1);
  const rooms = [new FakeRoom(net, 0), new FakeRoom(net, 1)];
  rooms[0].peer = rooms[1]; rooms[1].peer = rooms[0];
  rooms[0].rtt = rooms[1].rtt = rtt;
  const cores = [await freshCore(), await freshCore()];
  const PRESS = 700;
  const sample = (slot) => (f) => { const g = f - D; return g === PRESS && slot === 0 ? [7, 1, 0, 0, 0, 1, 0, 0, 0, 0] : [7, 1, 0, 0, 0, 0, 0, 0, 0, 0]; };
  const locks = [0, 1].map((slot) => new NetRollback({ core: cores[slot], room: rooms[slot], slot, delay: D, sample: sample(slot) }));
  let seen = -1;
  for (let tick = 0; tick < 1200 && seen < 0; tick++) {
    net.now += 1 / 60; deliver(net);
    for (const l of locks) l.update(1 / 60);
    if (seen < 0 && cores[0].snapshot().player.thrown > 0) seen = locks[0].frame;
  }
  return seen < 0 ? -1 : seen - 1 - PRESS; // frames between the press (as sampled) and the frame that started the attack
}
console.log('--- own punch: frames from the press to the attack starting (60 frames = 1 s)');
for (const [rtt, label] of [[0, 'local'], [40, '40 ms'], [100, '100 ms'], [200, '200 ms']]) {
  const D = netChooseRollbackDelay(rtt);
  const fr = await responseFrames(D, rtt);
  const old = Math.max(5, Math.min(15, Math.round(rtt / 2 / (1000 / 60)) + 3));
  console.log(`      ${label}: rollback ${fr} frames (${Math.round((fr * 1000) / 60)} ms)   was with lockstep: ${old} frames (${Math.round((old * 1000) / 60)} ms)`);
  check(`own punch answers within ${D + 1} frames at ${label}`, fr >= 0 && fr <= D + 1, `${fr}`);
}

console.log(`\n${results.filter(Boolean).length}/${results.length} checks passed`);
process.exit(results.every(Boolean) ? 0 : 1);
