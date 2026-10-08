// Online duel: two browsers, no game server.
//  - Rooms: a six-character code. The free public PeerJS broker only introduces the two browsers; after that the data
//    channel (WebRTC) goes browser to browser. Behind a strict corporate NAT (no TURN relay here) it can fail.
//  - Play: deterministic, with rollback. Both machines run the very same rules core (WebAssembly, bit-identical everywhere)
//    and exchange only their inputs, 60 times a second. Your own input is applied after 2-4 frames (33-67 ms), the opponent's
//    is guessed (his last input without the one-shot punches) until the real one arrives; when the guess was wrong the
//    machine rewinds to that frame and replays up to now with the real input (NetRollback). So a punch starts at once instead
//    of after the network delay. The older fixed-delay lockstep (NetLockstep, 5-15 frames) stays for a core build without
//    save/load. Every two seconds the machines compare a hash of the whole state; a mismatch ends the bout with a message.
const NET_DEPS = globalThis.IRONECHO_DEPS || {};
const NET_PEERJS_URL = NET_DEPS.peerjs || 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
const NET_ID_PREFIX = 'ironecho-duel-';
const NET_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const NET_FRAME = 1 / 60; // one lockstep frame = two 120 Hz core ticks
const NET_HASH_EVERY = 120;
// An input as both machines must see it: JSON turns -0 into 0 and NaN / Infinity into null on the way over, which would give the
// two cores different bits for the same input (a false "desync"). Whatever is sampled is cleaned first, then sent and used.
const netCleanInput = (d) => { const o = new Array(10); for (let i = 0; i < 10; i++) { const v = Number(d[i]); o[i] = Number.isFinite(v) && v !== 0 ? v : 0; } return o; };
const NET_NEUTRAL = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; // status 0 (not ready): what both sides assume before the first frame

function netLoadPeerJS() {
  if (globalThis.Peer) return Promise.resolve(globalThis.Peer);
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = NET_PEERJS_URL;
    s.onload = () => (globalThis.Peer ? resolve(globalThis.Peer) : reject(new Error('PeerJS не загрузился')));
    s.onerror = () => reject(new Error('не удалось загрузить сетевую библиотеку (нет интернета?)'));
    document.head.appendChild(s);
  });
}

function netRoomCode() {
  const bytes = new Uint8Array(6);
  (globalThis.crypto || { getRandomValues: (a) => a.map(() => Math.floor(Math.random() * 256)) }).getRandomValues(bytes);
  return Array.from(bytes, (b) => NET_ALPHABET[b % NET_ALPHABET.length]).join('');
}

function netPeerOptions() {
  return {
    debug: 0,
    config: { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }, { urls: 'stun:global.stun.twilio.com:3478' }] },
    ...(globalThis.IRONECHO_NET || {}), // tests and self-hosted brokers: { host, port, path, secure }
  };
}

export const NET_NORMALIZE_CODE = (text) => String(text || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);

// One connection to the other player (host or guest). Events: open, message(msg), close, error(text).
export class NetRoom {
  constructor() {
    this.handlers = {};
    this.peer = null;
    this.conn = null;
    this.code = '';
    this.role = '';
    this.rtt = 0;
    this.closed = false;
  }

  on(name, fn) { this.handlers[name] = fn; return this; }
  _emit(name, arg) { if (this.handlers[name]) this.handlers[name](arg); }

  // Live video of the players (a camera picture the opponent sees next to the fight). Rides on the same PeerJS connection as the
  // inputs, as a separate WebRTC media stream: the lockstep never waits for it. Sending is optional, receiving is automatic.
  _listenCalls(peer) {
    peer.on('call', (call) => {
      if (!call.metadata || call.metadata.kind !== 'video') { try { call.close(); } catch { /* ignore */ } return; }
      call.answer(); // we send nothing back on this call (our own video goes out on our call)
      let seen = null;
      call.on('stream', (stream) => { if (seen === stream.id) return; seen = stream.id; this._emit('video', stream); });
      call.on('close', () => this._emit('videoEnd'));
      call.on('error', () => this._emit('videoEnd'));
    });
  }

  sendVideo(stream) {
    if (!this.peer || !this.conn || !this.conn.peer || !stream) return false;
    this.stopVideo();
    const call = this.peer.call(this.conn.peer, stream, { metadata: { kind: 'video' } });
    this.outCall = call;
    // a thin picture, not the fight's bandwidth: the video must never be what makes the ping jump
    const tune = setInterval(() => {
      const pc = call.peerConnection;
      if (!pc || this.outCall !== call) { if (this.outCall !== call) clearInterval(tune); return; }
      const state = pc.iceConnectionState;
      if (state !== 'connected' && state !== 'completed') return;
      clearInterval(tune);
      try {
        for (const sender of pc.getSenders()) {
          if (!sender.track || sender.track.kind !== 'video') continue;
          const p = sender.getParameters();
          if (!p.encodings || !p.encodings.length) p.encodings = [{}];
          p.encodings[0].maxBitrate = 450000;
          p.encodings[0].maxFramerate = 24;
          p.degradationPreference = 'maintain-framerate';
          sender.setParameters(p).catch(() => {});
        }
      } catch { /* optional */ }
    }, 400);
    setTimeout(() => clearInterval(tune), 20000);
    return true;
  }

  stopVideo() {
    if (this.outCall) { const c = this.outCall; this.outCall = null; try { c.close(); } catch { /* ignore */ } }
  }

  async host() {
    const Peer = await netLoadPeerJS();
    this.role = 'host';
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = netRoomCode();
      const peer = new Peer(NET_ID_PREFIX + code, netPeerOptions());
      try {
        await new Promise((resolve, reject) => {
          peer.on('open', resolve);
          peer.on('error', (err) => reject(err));
          setTimeout(() => reject(new Error('timeout')), 15000);
        });
      } catch (err) {
        peer.destroy();
        if (err && err.type === 'unavailable-id') continue;
        throw new Error(err && err.type === 'network' || (err && err.message === 'timeout') ? 'нет связи с сетевым посредником (проверь интернет)' : String(err && err.message || err));
      }
      this.peer = peer;
      this.code = code;
      this._listenCalls(peer);
      peer.on('connection', (conn) => {
        if (this.conn) { conn.on('open', () => { conn.send({ t: 'full' }); conn.close(); }); return; } // one opponent only
        this._attach(conn);
      });
      peer.on('error', (err) => this._emit('error', `сеть: ${err.type || err.message || err}`));
      peer.on('disconnected', () => { try { peer.reconnect(); } catch { /* the room stays open without the broker */ } });
      return code;
    }
    throw new Error('не удалось занять код комнаты, попробуй ещё раз');
  }

  async join(rawCode) {
    const code = NET_NORMALIZE_CODE(rawCode);
    if (code.length !== 6) throw new Error('код комнаты — 6 символов');
    const Peer = await netLoadPeerJS();
    this.role = 'guest';
    this.code = code;
    const peer = new Peer(undefined, netPeerOptions());
    await new Promise((resolve, reject) => {
      peer.on('open', resolve);
      peer.on('error', (err) => reject(new Error(err.type === 'network' ? 'нет связи с сетевым посредником (проверь интернет)' : String(err.type || err.message))));
      setTimeout(() => reject(new Error('нет связи с сетевым посредником (проверь интернет)')), 15000);
    });
    this.peer = peer;
    this._listenCalls(peer);
    peer.on('error', (err) => {
      if (err.type === 'peer-unavailable') this._emit('error', 'комната не найдена: проверь код');
      else this._emit('error', `сеть: ${err.type || err.message || err}`);
    });
    const conn = peer.connect(NET_ID_PREFIX + code, { reliable: true, serialization: 'json' });
    this._attach(conn);
    setTimeout(() => { if (!this.opened && !this.closed) this._emit('error', 'комната не отвечает: код неверный или соперник не в сети'); }, 15000);
    return code;
  }

  _attach(conn) {
    this.conn = conn;
    conn.on('open', () => {
      this.opened = true;
      this._emit('open');
    });
    conn.on('data', (msg) => {
      if (!msg || typeof msg !== 'object') return;
      if (msg.t === 'ping') { this.send({ t: 'pong', n: msg.n, ts: msg.ts }); return; }
      if (msg.t === 'pong') { this._pong(msg); return; }
      if (msg.t === 'full') { this._emit('error', 'в комнате уже есть соперник'); return; }
      this._emit('message', msg);
    });
    conn.on('close', () => { if (!this.closed) { this.closed = true; this._emit('close'); } });
    conn.on('error', (err) => this._emit('error', `соединение: ${err.type || err.message || err}`));
  }

  send(msg) {
    if (this.conn && this.conn.open) this.conn.send(msg);
  }

  // Ping (ms): median of a few round trips, used to pick the input delay.
  measure(count = 7) {
    this.samples = [];
    return new Promise((resolve) => {
      let n = 0;
      const next = () => {
        if (n >= count) {
          const s = [...this.samples].sort((a, b) => a - b);
          this.rtt = s.length ? s[s.length >> 1] : 100;
          resolve(this.rtt);
          return;
        }
        this.send({ t: 'ping', n: n++, ts: performance.now() });
        setTimeout(next, 90);
      };
      next();
      setTimeout(() => { if (!this.rtt && this.samples.length === 0) resolve(100); }, 4000);
    });
  }

  _pong(msg) {
    const rtt = performance.now() - msg.ts;
    if (msg.n < 0) this.rtt = this.rtt ? this.rtt * 0.8 + rtt * 0.2 : rtt; // a live ping during the fight: keeps the clock sync honest
    else if (this.samples) this.samples.push(rtt);
  }

  // One ping a second for the whole fight (the lobby measurement is only a first guess).
  startPings() {
    if (this.pinger) return;
    this.pinger = setInterval(() => this.send({ t: 'ping', n: -1, ts: performance.now() }), 1000);
  }

  close() {
    this.closed = true;
    if (this.pinger) { clearInterval(this.pinger); this.pinger = null; }
    this.stopVideo();
    try { if (this.conn) this.conn.close(); } catch { /* ignore */ }
    try { if (this.peer) this.peer.destroy(); } catch { /* ignore */ }
  }
}

// The lockstep engine. `sample()` returns this machine's input as 10 numbers
// [status, confidence, lean, leanForward, block, punchMask, kickMask, moveForward, moveSide, ctl];
// ctl bits: 1 pause, 2 resume, 4 rematch.
export class NetLockstep {
  constructor({ core, room, slot, delay, sample, onDesync }) {
    this.core = core;
    this.room = room;
    this.slot = slot;
    this.delay = delay;
    this.sample = sample;
    this.onDesync = onDesync || (() => {});
    this.inputs = [new Map(), new Map()];
    this.frame = 0;
    this.localNext = delay;
    this.acc = 0;
    this.stalled = 0;
    this.desynced = false;
    this.hashes = new Map();
    this.remoteHashes = new Map();
    for (let f = 0; f < delay; f++) { this.inputs[0].set(f, NET_NEUTRAL); this.inputs[1].set(f, NET_NEUTRAL); }
    this.room.on('message', (msg) => this.receive(msg));
  }

  receive(msg) {
    if (msg.t === 'in') {
      this.inputs[1 - this.slot].set(msg.f, msg.d);
    } else if (msg.t === 'h') {
      this.remoteHashes.set(msg.f, msg.v);
      this._compare(msg.f);
    }
  }

  _compare(f) {
    if (this.hashes.has(f) && this.remoteHashes.has(f) && this.hashes.get(f) !== this.remoteHashes.get(f) && !this.desynced) {
      this.desynced = true;
      this.onDesync(f);
    }
  }

  _stateHash() {
    const view = this.core.stateWords();
    let h = 0x811c9dc5;
    for (let i = 0; i < view.length; i++) h = Math.imul(h ^ view[i], 16777619) >>> 0;
    return h;
  }

  get ping() { return this.room.rtt; }

  // Advance by real time; returns how many lockstep frames ran (0..3).
  update(dt) {
    this.acc = Math.min(this.acc + dt, NET_FRAME * 4);
    let ran = 0;
    while (this.acc >= NET_FRAME && ran < 3) {
      if (!this._advance()) break;
      this.acc -= NET_FRAME;
      ran++;
    }
    return ran;
  }

  _advance() {
    const f = this.frame;
    while (this.localNext <= f + this.delay) {
      const d = netCleanInput(this.sample(this.localNext));
      this.inputs[this.slot].set(this.localNext, d);
      this.room.send({ t: 'in', f: this.localNext, d });
      this.localNext++;
    }
    const a = this.inputs[0].get(f);
    const b = this.inputs[1].get(f);
    if (!a || !b) {
      this.stalled++;
      return false;
    }
    this.stalled = 0;
    this.core.versusStep(a, b);
    this.inputs[0].delete(f - 4);
    this.inputs[1].delete(f - 4);
    if (f % NET_HASH_EVERY === NET_HASH_EVERY - 1) {
      const v = this._stateHash();
      this.hashes.set(f, v);
      this.room.send({ t: 'h', f, v });
      this._compare(f);
      for (const k of [...this.hashes.keys()]) if (k < f - NET_HASH_EVERY * 3) { this.hashes.delete(k); this.remoteHashes.delete(k); }
    }
    this.frame++;
    return true;
  }
}

// Input delay (frames) of the plain lockstep from the round-trip time: half of it plus a margin for jitter.
export function netChooseDelay(rttMs) {
  return Math.max(5, Math.min(15, Math.round(rttMs / 2 / (NET_FRAME * 1000)) + 3));
}

// Own-input delay (frames) with rollback: a little over half of the one-way time is hidden by the delay, the rest by the guess.
// 2 frames (33 ms) on a good connection, 4 (67 ms) on a bad one.
export function netChooseRollbackDelay(rttMs) {
  return Math.max(2, Math.min(4, Math.round((rttMs / 2 / (NET_FRAME * 1000)) * 0.6)));
}

const NET_WINDOW = 8;      // frames the machine may play on a guess of the opponent's input before it waits for him
const NET_SLOTS = 32;      // saved states (a ring; the window is far smaller)
const NET_SYNC_DEAD = 1.5; // frames of lead over the opponent's clock that are tolerated before the clock is slowed a little
const sameInput = (a, b) => { for (let i = 0; i < 10; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return false; return true; };

// Deterministic rollback engine. Same surface as NetLockstep (update, frame, stalled, delay, hashes, ping) plus takeEvents().
//  - frame = the next lockstep frame to simulate (2 core ticks). Frames < remoteNext have both real inputs.
//  - Every frame is saved before it is simulated; when a real remote input differs from the guess used for its frame, the engine
//    loads the save of that frame and simulates again up to the present with the best inputs known.
//  - Combat events are handed out once (key = type, actor, attack, tick) the moment they are first produced; match events (phase
//    changes, round and match end) only when their frame has both real inputs, so a wrong guess never ends a round on screen.
//  - The clock of the side that runs ahead of the other one slows by up to 6 %, so the guesses stay short.
export class NetRollback {
  constructor({ core, room, slot, delay, sample, onDesync }) {
    this.core = core;
    this.room = room;
    this.slot = slot;
    this.delay = delay;
    this.sample = sample;
    this.onDesync = onDesync || (() => {});
    this.inputs = [new Map(), new Map()];
    this.used = new Map();          // frame -> { remote: the array simulated, guessed: bool }
    this.frame = 0;
    this.localNext = delay;
    this.remoteNext = delay;
    this.acc = 0;
    this.rate = 1;
    this.adv = null;
    this.stalled = 0;
    this.desynced = false;
    this.rollTo = null;
    this.rollbacks = 0;
    this.rolledFrames = 0;
    this.deepest = 0;
    this.hashes = new Map();
    this.remoteHashes = new Map();
    this.hashFrom = 0;
    this.seen = new Map();          // combat event key -> frame it came from
    this.matchByFrame = new Map();
    this.out = { combat: [], match: [] };
    for (let f = 0; f < delay; f++) { this.inputs[0].set(f, NET_NEUTRAL); this.inputs[1].set(f, NET_NEUTRAL); }
    this.room.on('message', (msg) => this.receive(msg));
  }

  get ping() { return this.room.rtt; }

  receive(msg) {
    if (msg.t === 'in') {
      const remote = 1 - this.slot;
      if (msg.f < this.remoteNext) return;
      this.inputs[remote].set(msg.f, msg.d);
      while (this.inputs[remote].has(this.remoteNext)) this.remoteNext++;
      const u = this.used.get(msg.f);
      if (u && u.guessed && !sameInput(u.remote, msg.d) && (this.rollTo === null || msg.f < this.rollTo)) this.rollTo = msg.f;
      if (typeof msg.sf === 'number') this._syncClock(msg.sf);
    } else if (msg.t === 'h') {
      this.remoteHashes.set(msg.f, msg.v);
      this._compare(msg.f);
    }
  }

  // Where the opponent's clock is now (his frame at sending plus the one-way time) against ours.
  _syncClock(sf) {
    const owd = (this.room.rtt || 0) / 2 / (NET_FRAME * 1000);
    const adv = this.frame - (sf + owd);
    this.adv = this.adv === null ? adv : this.adv * 0.9 + adv * 0.1;
    this.rate = this.adv > NET_SYNC_DEAD ? 1 - Math.min(0.06, (this.adv - NET_SYNC_DEAD) * 0.02) : 1;
  }

  _compare(f) {
    if (f >= this.hashFrom) return; // our own hash of that frame may still rest on a guess: settled frames only
    if (this.hashes.has(f) && this.remoteHashes.has(f) && this.hashes.get(f) !== this.remoteHashes.get(f) && !this.desynced) {
      this.desynced = true;
      this.onDesync(f);
    }
  }

  _stateHash() {
    const view = this.core.stateWords();
    let h = 0x811c9dc5;
    for (let i = 0; i < view.length; i++) h = Math.imul(h ^ view[i], 16777619) >>> 0;
    return h;
  }

  // The opponent's input for frame f: the real one, else his last known one without the one-shot parts (punches, kicks, pause / rematch).
  _remote(f) {
    const remote = this.inputs[1 - this.slot];
    if (remote.has(f)) return { arr: remote.get(f), guessed: false };
    const last = remote.get(this.remoteNext - 1) || NET_NEUTRAL;
    const g = last.slice();
    g[5] = 0; g[6] = 0; g[9] = 0;
    return { arr: g, guessed: true };
  }

  // Simulate frame f (its state is saved first, so it can be replayed).
  _simulate(f) {
    this.core.save(f % NET_SLOTS);
    const r = this._remote(f);
    const mine = this.inputs[this.slot].get(f) || NET_NEUTRAL;
    this.used.set(f, { remote: r.arr, guessed: r.guessed });
    if (this.slot === 0) this.core.versusStep(mine, r.arr); else this.core.versusStep(r.arr, mine);
    const ev = this.core.drainEvents();
    for (const e of ev.combat) {
      const key = `${e.type}|${e.actor}|${e.attackId}|${e.tick}`;
      if (this.seen.has(key)) continue;
      this.seen.set(key, f);
      this.out.combat.push(e);
    }
    if (ev.match.length) this.matchByFrame.set(f, ev.match); else this.matchByFrame.delete(f);
    if (f % NET_HASH_EVERY === NET_HASH_EVERY - 1) this.hashes.set(f, this._stateHash());
  }

  _rollback() {
    const from = this.rollTo;
    this.rollTo = null;
    if (from === null || from >= this.frame) return;
    const depth = this.frame - from;
    if (depth >= NET_SLOTS - 1 || !this.core.load(from % NET_SLOTS)) { this.onDesync(from); this.desynced = true; return; }
    this.rollbacks++;
    this.rolledFrames += depth;
    this.deepest = Math.max(this.deepest, depth);
    for (let f = from; f < this.frame; f++) this._simulate(f);
  }

  // Advance by real time; returns how many lockstep frames ran (0..4).
  update(dt) {
    this.acc = Math.min(this.acc + dt * this.rate, NET_FRAME * 6);
    let ran = 0;
    while (this.acc >= NET_FRAME && ran < 4) {
      if (!this._advance()) break;
      this.acc -= NET_FRAME;
      ran++;
    }
    return ran;
  }

  _advance() {
    this._rollback();
    if (this.frame >= this.remoteNext + NET_WINDOW) { this.stalled++; return false; } // too far on a guess: wait for him
    this.stalled = 0;
    while (this.localNext <= this.frame + this.delay) {
      const d = netCleanInput(this.sample(this.localNext));
      this.inputs[this.slot].set(this.localNext, d);
      this.room.send({ t: 'in', f: this.localNext, d, sf: this.frame });
      this.localNext++;
    }
    this._simulate(this.frame);
    this.frame++;
    this._settle();
    return true;
  }

  // Frames below `final` were simulated with real inputs on both sides: release their match events, compare hashes, forget old data.
  _settle() {
    const final = Math.min(this.remoteNext, this.frame);
    for (const [f, evs] of [...this.matchByFrame]) {
      if (f < final) { this.out.match.push(...evs); this.matchByFrame.delete(f); }
    }
    const from = this.hashFrom;
    this.hashFrom = Math.max(from, final);
    for (let h = from; h < this.hashFrom; h++) {
      if (h % NET_HASH_EVERY !== NET_HASH_EVERY - 1) continue;
      const v = this.hashes.get(h);
      if (v === undefined) continue;
      this.room.send({ t: 'h', f: h, v });
      this._compare(h);
    }
    const keep = this.frame - NET_SLOTS;
    for (const m of this.inputs) for (const f of [...m.keys()]) if (f < keep) m.delete(f);
    for (const f of [...this.used.keys()]) if (f < keep) this.used.delete(f);
    for (const [k, f] of [...this.seen]) if (f < keep) this.seen.delete(k);
    for (const f of [...this.hashes.keys()]) if (f < this.frame - NET_HASH_EVERY * 3) { this.hashes.delete(f); this.remoteHashes.delete(f); }
  }

  // Events produced since the last call (consumed): { combat, match }.
  takeEvents() {
    const o = this.out;
    this.out = { combat: [], match: [] };
    return o;
  }
}
