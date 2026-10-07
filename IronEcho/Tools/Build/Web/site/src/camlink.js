// Phones as cameras over WebRTC (no app, no cable): the game page opens a room, a phone opens the page the QR code points
// to (site/phone.template.html), allows its camera and calls the room; the video goes phone -> game page directly.
// The free public PeerJS broker only introduces the two; behind a strict NAT (no TURN relay here) it can fail.
// Slots: 1 and 2. With the computer's own webcam the phone takes slot 1 as the second camera; with two phones slot 1 is
// the main camera and slot 2 the second one.
const CAM_ID_PREFIX = 'ironecho-cam-';

export class PhoneLink {
  constructor() {
    this.handlers = {};
    this.peer = null;
    this.code = '';
    this.calls = new Map(); // slot -> MediaConnection
  }

  on(name, fn) { this.handlers[name] = fn; return this; }
  _emit(name, arg) { if (this.handlers[name]) this.handlers[name](arg); }

  async open() {
    const Peer = await netLoadPeerJS();
    for (let attempt = 0; attempt < 6; attempt++) {
      const code = netRoomCode();
      const peer = new Peer(CAM_ID_PREFIX + code, netPeerOptions());
      try {
        await new Promise((resolve, reject) => {
          peer.on('open', resolve);
          peer.on('error', (err) => reject(err));
          setTimeout(() => reject(new Error('timeout')), 15000);
        });
      } catch (err) {
        peer.destroy();
        if (err && err.type === 'unavailable-id') continue;
        throw new Error('нет связи с сетевым посредником (проверь интернет)');
      }
      this.peer = peer;
      this.code = code;
      peer.on('call', (call) => this._onCall(call));
      peer.on('error', (err) => this._emit('error', `сеть: ${err.type || err.message || err}`));
      peer.on('disconnected', () => { try { peer.reconnect(); } catch { /* the room keeps working with open calls */ } });
      return code;
    }
    throw new Error('не удалось занять код комнаты, попробуй ещё раз');
  }

  _onCall(call) {
    const slot = Number(call.metadata && call.metadata.slot) === 2 ? 2 : 1;
    const previous = this.calls.get(slot);
    if (previous) { previous.replaced = true; try { previous.close(); } catch { /* ignore */ } }
    this.calls.set(slot, call);
    call.answer(); // we send nothing back
    let seen = null;
    call.on('stream', (stream) => {
      if (seen === stream.id) return; // PeerJS may announce the same stream once per track
      seen = stream.id;
      this._emit('stream', { slot, stream, call });
    });
    call.on('close', () => {
      if (this.calls.get(slot) !== call || call.replaced) return;
      this.calls.delete(slot);
      this._emit('lost', { slot });
    });
    call.on('error', () => { /* the close handler follows */ });
  }

  // the address a phone opens (QR code), or null when this build has no phone page (single-file offline copy)
  url(slot) {
    const page = (globalThis.IRONECHO_DEPS || {}).phonePage;
    if (!page || !this.code) return null;
    const u = new URL(page, location.href);
    u.searchParams.set('cam', this.code);
    u.searchParams.set('slot', String(slot));
    return u.href;
  }

  close() {
    for (const call of this.calls.values()) { call.replaced = true; try { call.close(); } catch { /* ignore */ } }
    this.calls.clear();
    try { if (this.peer) this.peer.destroy(); } catch { /* ignore */ }
    this.peer = null;
  }
}
