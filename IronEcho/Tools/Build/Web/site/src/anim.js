// Procedural boxing animation driven by the rules core: every frame the fighter snapshot (state, attack stage and
// progress, block, slip, stun, gassed, knockdown) becomes target pose parameters for computePose(); critically
// damped springs smooth them, and combat events add short impulses (head snap, knock-back, glove recoil).
import { computePose, POSE_DEFAULTS } from './rig.js';

const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const easeOut = (t) => { t = clamp(t, 0, 1); return 1 - (1 - t) * (1 - t) * (1 - t); };
const lerp3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

// Exact step of a critically damped spring toward `target` (stable at any dt).
function spring(x, v, target, omega, dt) {
  const y = x - target;
  const b = v + omega * y;
  const e = Math.exp(-omega * dt);
  return [target + (y + b * dt) * e, (v - omega * b * dt) * e];
}

const SCALARS = ['crouch', 'yaw', 'lean', 'twist', 'nod', 'lateral', 'elbow_out', 'lead_extended', 'rear_extended',
  'head_turn', 'head_tilt', 'side_bend', 'body_x'];
const OMEGA = { crouch: 12, yaw: 16, lean: 14, twist: 18, nod: 16, lateral: 15, elbow_out: 14, lead_extended: 40,
  rear_extended: 40, head_turn: 16, head_tilt: 14, side_bend: 14, body_x: 12 };
const HAND_OMEGA = 34;
const PUNCH_OMEGA = 70;

const GUARD = { lead: [0.30, 0.10, 1.50], rear: [0.22, -0.09, 1.49] };
const BLOCK = { lead: [0.20, 0.085, 1.66], rear: [0.19, -0.085, 1.66] };

export class FighterAnimator {
  constructor(rig, { isBot = false, seed = 1 } = {}) {
    this.rig = rig;
    this.isBot = isBot;
    this.t = seed * 3.7;
    this.p = structuredClone(POSE_DEFAULTS);
    this.v = Object.fromEntries(SCALARS.map((k) => [k, 0]));
    this.hv = { lead: [0, 0, 0], rear: [0, 0, 0] };
    this.kick = { nod: 0, turn: 0, lean: 0, x: 0, hands: 0, tilt: 0 };
    this.kickV = { nod: 0, turn: 0, lean: 0, x: 0, hands: 0, tilt: 0 };
    this.fall = 0;        // 0 standing .. 1 lying
    this.fallV = 0;
    this.outcome = '';    // 'win' | 'lose' | ''
    this.lastAttack = { id: 0, hand: 0 };
  }

  // A clean hit landed on this fighter. hand: attacker's hand (0 lead/jab, 1 rear/cross).
  takeHit(hand, damage, counter) {
    const power = clamp(damage / 2.8, 0.4, 1.6) * (counter ? 1.25 : 1);
    const side = hand === 0 ? 1 : -1; // jab from the opponent's lead hand turns this head one way, cross the other
    // spring impulses (omega 14): peak = v0 / (omega * e) ~ v0 / 38 -> ~22 deg head snap, ~6 cm knock-back
    this.kickV.nod -= 840 * power;
    this.kickV.turn += side * 600 * power;
    this.kickV.lean -= 300 * power;
    this.kickV.x -= 2.3 * power;
    this.kickV.tilt += side * 230 * power;
  }

  // A punch was stopped by this fighter's guard.
  takeBlocked(damage) {
    const power = clamp(damage / 2.8, 0.4, 1.4);
    this.kickV.hands -= 2.7 * power; // gloves pushed ~7 cm back into the face
    this.kickV.nod -= 190 * power;
    this.kickV.x -= 0.9 * power;
  }

  // Target pose for the current rules state.
  _targets(f, ctx) {
    const T = structuredClone(POSE_DEFAULTS);
    let lead = [...GUARD.lead];
    let rear = [...GUARD.rear];
    const t = this.t;
    const fighting = ctx.phase === 'Fighting' || ctx.phase === 'Training';

    // idle rhythm: bounce, slight weave, breathing hands
    const bounce = Math.sin(t * 2 * Math.PI * 1.7);
    if (fighting) {
      T.crouch += 0.012 * bounce;
      T.lateral = 0.10 * Math.sin(t * 2 * Math.PI * 0.33);
      lead[2] += 0.012 * Math.sin(t * 2 * Math.PI * 1.7 + 0.6);
      rear[2] += 0.010 * Math.sin(t * 2 * Math.PI * 1.7 + 1.4);
    } else {
      T.crouch += 0.006 * Math.sin(t * 2 * Math.PI * 0.8);
    }

    const gassed = f.gassedTicksLeft > 0 || f.stamina < 12;
    if (gassed) {
      T.crouch += 0.035;
      T.nod += 10;
      T.lean += 2 * Math.sin(t * 2 * Math.PI * 1.3);
      lead = [lead[0] - 0.02, lead[1], lead[2] - 0.11];
      rear = [rear[0] - 0.02, rear[1], rear[2] - 0.11];
    }

    // defence
    const blocking = f.blocking > 0.5 || f.stateName === 'BlockStun' || f.stateName === 'Block';
    if (blocking) {
      lead = [...BLOCK.lead];
      rear = [...BLOCK.rear];
      T.crouch = 0.08 + 0.006 * bounce;
      T.lean = 12;
      T.nod = 18;
      T.elbow_out = 0.05;
    }
    if (f.dodge !== 0) {
      T.lateral = -f.dodge; // core: Left = -1 (own left); pose: +lateral = own left
      T.crouch = 0.10;
      T.lean = 14;
      T.nod = 16;
      const s = T.lateral;
      lead = [0.26, 0.10 + 0.06 * s, 1.40];
      rear = [0.18, -0.08 + 0.06 * s, 1.38];
    } else if (Math.abs(f.lean) > 0.05) {
      T.lateral += -0.35 * clamp(f.lean, -1, 1);
    }
    if (f.stateName === 'HitStun') {
      T.lean -= 6;
      T.nod -= 6;
      T.crouch += 0.02;
      lead[2] -= 0.05;
      rear[2] -= 0.05;
    }

    // punch: shaped extension e (< 0 loading, 1 full) from the attack stage and its progress
    if (f.stateName === 'Attack') {
      const hand = f.hand; // 0 = left/lead (jab), 1 = right/rear (cross)
      const a = f.stageAlpha;
      const L = this.isBot ? 0.62 : 0.2; // share of the windup spent loading: the bot's telegraph is readable
      let e = 0;
      if (f.stageName === 'Windup') e = a < L ? -0.15 * smooth(a / L) : -0.15 + 1.15 * easeOut((a - L) / (1 - L));
      else if (f.stageName === 'Active') e = 1;
      else if (f.stageName === 'Recovery') e = 1 - smooth(a);
      const reach = clamp(ctx.gap - 0.38, 0.62, 0.98);
      const pos = clamp(e, 0, 1);
      const load = clamp(-e / 0.15, 0, 1);
      const big = this.isBot ? 1.0 : 0.5; // the bot's load is exaggerated on purpose: it is the cue to react to
      this.telegraph = this.isBot ? load : 0;
      if (hand === 0) {
        const strike = [reach, 0.06, 1.57];
        const loaded = [lead[0] - 0.16 * big, lead[1] + 0.06 * big, lead[2] - 0.08 * big];
        lead = load > 0 ? lerp3(lead, loaded, load) : lerp3(lead, strike, pos);
        T.yaw = lerp(T.yaw, -34, pos) + 10 * load * big;
        T.twist = lerp(T.twist, -16, pos) + 8 * load * big;
        T.lean = lerp(T.lean, 13, pos);
        T.crouch += 0.02 * load + 0.01 * pos;
        T.lead_extended = pos;
        rear[2] += 0.04 * pos; // chin cover
      } else {
        const strike = [reach, -0.02, 1.56];
        const loaded = [rear[0] - 0.20 * big, rear[1] - 0.08 * big, rear[2] - 0.08 * big];
        rear = load > 0 ? lerp3(rear, loaded, load) : lerp3(rear, strike, pos);
        T.yaw = lerp(T.yaw, 6, pos) - 14 * load * big;
        T.twist = lerp(T.twist, 22, pos) - 22 * load * big;
        T.lean = lerp(T.lean, 14, pos);
        T.crouch += 0.03 * load + 0.01 * pos;
        T.head_turn = -10 * pos;
        T.rear_extended = pos;
        lead[2] += 0.05 * pos;
        lead[0] -= 0.05 * pos;
      }
      if (this.isBot && load > 0) {
        T.side_bend = (hand === 0 ? 7 : -9) * load; // shoulder dip: part of the telegraph
        T.crouch += 0.03 * load;
      }
    }

    // match over
    if (ctx.phase === 'MatchOver' && this.fall < 0.5) {
      if (this.outcome === 'win') {
        const w = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 1.2);
        lead = [0.12, 0.30, 2.02 + 0.04 * w];
        rear = [0.12, -0.30, 2.02 + 0.04 * (1 - w)];
        T.nod = -12;
        T.lean = -3;
        T.crouch = 0.02 + 0.02 * w;
        T.elbow_out = 0.6;
      } else if (this.outcome === 'lose') {
        lead = [0.26, 0.20, 1.12];
        rear = [0.20, -0.20, 1.10];
        T.nod = 26;
        T.lean = 16;
        T.crouch = 0.09;
      }
    }

    // down: sit back, arms limp
    if (this.fall > 0.01) {
      const k = this.fall;
      T.crouch = lerp(T.crouch, 0.30, smooth(k * 1.6));
      T.lean = lerp(T.lean, -22, k);
      T.nod = lerp(T.nod, -18, k);
      lead = lerp3(lead, [0.05, 0.42, 0.95], k);
      rear = lerp3(rear, [0.00, -0.42, 0.95], k);
      T.elbow_out = lerp(T.elbow_out, 0.8, k);
    }
    return { T, lead, rear };
  }

  update(dt, f, ctx) {
    this.t += dt;
    this.telegraph = 0;
    const down = f.stateName === 'KnockedDown' || f.stateName === 'KnockedOut';
    [this.fall, this.fallV] = spring(this.fall, this.fallV, down ? 1 : 0, down ? 5.5 : 4.0, dt);
    for (const k of Object.keys(this.kick)) {
      [this.kick[k], this.kickV[k]] = spring(this.kick[k], this.kickV[k], 0, 14, dt);
    }
    const { T, lead, rear } = this._targets(f, ctx);
    const attacking = f.stateName === 'Attack';
    for (const k of SCALARS) {
      const om = attacking && (k === 'yaw' || k === 'twist' || k === 'lean') ? OMEGA[k] * 1.8 : OMEGA[k];
      [this.p[k], this.v[k]] = spring(this.p[k], this.v[k], T[k], om, dt);
    }
    const handOmega = (side) => (attacking && ((side === 'lead' && f.hand === 0) || (side === 'rear' && f.hand === 1)) ? PUNCH_OMEGA : HAND_OMEGA);
    for (const [side, target, key] of [['lead', lead, 'lead_hand'], ['rear', rear, 'rear_hand']]) {
      const om = handOmega(side);
      for (let i = 0; i < 3; i++) {
        [this.p[key][i], this.hv[side][i]] = spring(this.p[key][i], this.hv[side][i], target[i], om, dt);
      }
    }
    // impulses on top of the smoothed pose
    const P = structuredClone(this.p);
    P.nod += this.kick.nod;
    P.head_turn += this.kick.turn;
    P.head_tilt += this.kick.tilt;
    P.lean += this.kick.lean;
    P.body_x += this.kick.x;
    P.lead_hand = [P.lead_hand[0] + this.kick.hands, P.lead_hand[1], P.lead_hand[2]];
    P.rear_hand = [P.rear_hand[0] + this.kick.hands, P.rear_hand[1], P.rear_hand[2]];
    this.rig.applyPose(computePose(P));
    // visor LEDs flare while the bot loads a punch: a readable "now!" for a human 2 m from the screen
    this.glow = (this.glow || 0) + ((this.telegraph > 0 ? 1 : 0) - (this.glow || 0)) * Math.min(1, dt * 18);
    this.rig.material.emissiveIntensity = this.rig.baseEmissive * (1 + 4.5 * this.glow);
  }
}
