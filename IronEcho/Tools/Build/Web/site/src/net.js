// Online duel: two browsers, no game server.
//  - Rooms: a six-character code. The free public PeerJS broker only introduces the two browsers; after that the data
//    channel (WebRTC) goes browser to browser. Behind a strict corporate NAT (no TURN relay here) it can fail.
//  - Play: deterministic lockstep. Both machines run the very same rules core (WebAssembly, bit-identical everywhere)
//    and exchange only their inputs, 60 times a second, each input applied a few frames after it was made (the "input
//    delay" the host picks from the measured ping), so nobody waits for the network in the middle of a punch.
//    Every two seconds the machines compare a hash of the whole state; a mismatch ends the bout with a message.
const NET_DEPS = globalThis.IRONECHO_DEPS || {};
const NET_PEERJS_URL = NET_DEPS.peerjs || 'https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js';
const NET_ID_PREFIX = 'ironecho-duel-';
const NET_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L
const NET_FRAME = 1 / 60; // one lockstep frame = two 120 Hz core ticks
const NET_HASH_EVERY = 120;
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

  _pong(msg) { if (this.samples) this.samples.push(performance.now() - msg.ts); }

  close() {
    this.closed = true;
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
      const d = this.sample();
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

// Input delay (frames) from the round-trip time: half of it plus a margin for jitter.
export function netChooseDelay(rttMs) {
  return Math.max(5, Math.min(15, Math.round(rttMs / 2 / (NET_FRAME * 1000)) + 3));
}
