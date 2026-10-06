// Keyboard / mouse / touch input. Everything becomes the same InputFrame fields the camera tracker produces
// (BlockAmount, LeanLateral, punch events, MoveForward/MoveLateral), so the core's IntentMapper handles it exactly as
// in Unreal (same keys there: Source/IronEcho/Private/IronEchoPlayerController.cpp).
import { STATUS_LIVE } from './core.js';

const PUNCH_LEFT = 1;  // jab (lead, left hand)
const PUNCH_RIGHT = 2; // cross (rear, right hand)
const BODY_LEFT = 4;   // jab to the body
const BODY_RIGHT = 8;  // cross to the body

export const KEY_HELP = [
  ['W / S', 'шаг вперёд / назад'], ['A / D', 'кружить влево / вправо'], ['J / K', 'джеб / кросс в голову'],
  ['Shift+J / K', 'в корпус (или N / M)'], ['Q / E', 'уклон'], ['Пробел', 'блок'], ['Esc / P', 'пауза'],
];
const MOVE_KEYS = { KeyW: 'fwd', ArrowUp: 'fwd', KeyS: 'back', KeyA: 'left', KeyD: 'right' };

export class ManualInput {
  constructor(root) {
    this.mask = 0;
    this.blockKeys = new Set();
    this.leftHeld = false;
    this.rightHeld = false;
    this.move = new Set();
    this.touchBlock = false;
    this.touchLeft = false;
    this.touchRight = false;
    this.onPause = null;
    this.enabled = true;
    const down = (e) => {
      if (!this.enabled || e.repeat) return;
      const k = e.code;
      const body = e.shiftKey;
      if (k === 'KeyJ' || k === 'KeyF') { this.mask |= body ? BODY_LEFT : PUNCH_LEFT; e.preventDefault(); }
      else if (k === 'KeyK' || k === 'KeyG') { this.mask |= body ? BODY_RIGHT : PUNCH_RIGHT; e.preventDefault(); }
      else if (k === 'KeyN') { this.mask |= BODY_LEFT; e.preventDefault(); }
      else if (k === 'KeyM') { this.mask |= BODY_RIGHT; e.preventDefault(); }
      else if (k === 'Space' || k === 'KeyL' || k === 'ArrowDown') { this.blockKeys.add(k); e.preventDefault(); }
      else if (k === 'KeyQ' || k === 'ArrowLeft') { this.leftHeld = true; e.preventDefault(); }
      else if (k === 'KeyE' || k === 'ArrowRight') { this.rightHeld = true; e.preventDefault(); }
      else if (MOVE_KEYS[k]) { this.move.add(MOVE_KEYS[k]); e.preventDefault(); }
      else if ((k === 'Escape' || k === 'KeyP') && this.onPause) { this.onPause(); e.preventDefault(); }
    };
    const up = (e) => {
      const k = e.code;
      this.blockKeys.delete(k);
      if (k === 'KeyQ' || k === 'ArrowLeft') this.leftHeld = false;
      if (k === 'KeyE' || k === 'ArrowRight') this.rightHeld = false;
      if (MOVE_KEYS[k]) this.move.delete(MOVE_KEYS[k]);
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', () => { this.blockKeys.clear(); this.move.clear(); this.leftHeld = this.rightHeld = false; });
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
    const m = this.enabled ? this.move : new Set();
    return {
      status: STATUS_LIVE,
      lean: left && !right ? -1 : right && !left ? 1 : 0, // + = player's right (InputFrame.LeanLateral)
      block: block ? 1 : 0,
      punchMask: mask,
      confidence: 1,
      moveForward: (m.has('fwd') ? 1 : 0) - (m.has('back') ? 1 : 0),
      moveSide: (m.has('right') ? 1 : 0) - (m.has('left') ? 1 : 0), // + = circle to the player's right
    };
  }
}
