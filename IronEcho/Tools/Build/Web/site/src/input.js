// Keyboard / mouse / touch input. Everything becomes the same InputFrame fields the camera tracker produces
// (BlockAmount, LeanLateral, punch events), so the core's IntentMapper (hysteresis) handles it exactly as in Unreal.
import { STATUS_LIVE } from './core.js';

const PUNCH_LEFT = 1;  // jab (lead, left hand)
const PUNCH_RIGHT = 2; // cross (rear, right hand)

export const KEY_HELP = [
  ['J', 'джеб (левая)'], ['K', 'кросс (правая)'], ['Пробел / S', 'блок (держать)'], ['A / D', 'уклон влево / вправо'],
  ['Мышь', 'ЛКМ — джеб, ПКМ — кросс'], ['Esc / P', 'пауза'],
];

export class ManualInput {
  constructor(root) {
    this.mask = 0;
    this.blockKeys = new Set();
    this.leftHeld = false;
    this.rightHeld = false;
    this.touchBlock = false;
    this.touchLeft = false;
    this.touchRight = false;
    this.onPause = null;
    this.enabled = true;
    const down = (e) => {
      if (!this.enabled || e.repeat) return;
      const k = e.code;
      if (k === 'KeyJ' || k === 'KeyF') { this.mask |= PUNCH_LEFT; e.preventDefault(); }
      else if (k === 'KeyK' || k === 'KeyG') { this.mask |= PUNCH_RIGHT; e.preventDefault(); }
      else if (k === 'Space' || k === 'KeyS' || k === 'KeyL' || k === 'ArrowDown') { this.blockKeys.add(k); e.preventDefault(); }
      else if (k === 'KeyA' || k === 'ArrowLeft') { this.leftHeld = true; e.preventDefault(); }
      else if (k === 'KeyD' || k === 'ArrowRight') { this.rightHeld = true; e.preventDefault(); }
      else if ((k === 'Escape' || k === 'KeyP') && this.onPause) { this.onPause(); e.preventDefault(); }
    };
    const up = (e) => {
      const k = e.code;
      this.blockKeys.delete(k);
      if (k === 'KeyA' || k === 'ArrowLeft') this.leftHeld = false;
      if (k === 'KeyD' || k === 'ArrowRight') this.rightHeld = false;
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', () => { this.blockKeys.clear(); this.leftHeld = this.rightHeld = false; });
    root.addEventListener('mousedown', (e) => {
      if (!this.enabled || e.target.closest('button, .panel')) return;
      if (e.button === 0) this.mask |= PUNCH_LEFT;
      if (e.button === 2) this.mask |= PUNCH_RIGHT;
    });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Touch pad (phones/tablets): buttons with data-act="jab|cross|block|left|right".
  bindTouch(pad) {
    const set = (act, on) => {
      if (act === 'jab' && on) this.mask |= PUNCH_LEFT;
      if (act === 'cross' && on) this.mask |= PUNCH_RIGHT;
      if (act === 'block') this.touchBlock = on;
      if (act === 'left') this.touchLeft = on;
      if (act === 'right') this.touchRight = on;
    };
    for (const btn of pad.querySelectorAll('[data-act]')) {
      const act = btn.dataset.act;
      btn.addEventListener('pointerdown', (e) => { e.preventDefault(); btn.setPointerCapture(e.pointerId); btn.classList.add('on'); set(act, true); });
      const off = () => { btn.classList.remove('on'); set(act, false); };
      btn.addEventListener('pointerup', off);
      btn.addEventListener('pointercancel', off);
    }
  }

  // One frame of input for core.frame().
  poll() {
    const mask = this.enabled ? this.mask : 0;
    this.mask = 0;
    const left = this.leftHeld || this.touchLeft;
    const right = this.rightHeld || this.touchRight;
    const block = this.enabled && (this.blockKeys.size > 0 || this.touchBlock);
    return {
      status: STATUS_LIVE,
      lean: left && !right ? -1 : right && !left ? 1 : 0, // + = player's right (InputFrame.LeanLateral)
      block: block ? 1 : 0,
      punchMask: mask,
      confidence: 1,
    };
  }
}
