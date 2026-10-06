// Procedural boxing animation driven by the rules core: every frame the fighter snapshot (state, attack stage and
// progress, block, slip, stun, gassed, knockdown) becomes target pose parameters for computePose(); springs smooth
// them (torso and hips slightly underdamped, so weight carries through a punch), combat events add impulses (head
// snap, knock-back, glove recoil), and the feet are planted on the canvas: they stay where they were put until the
// body has drifted too far from them, then step there with a lifted arc (footwork, step-in jab, pivot on the cross,
// stagger after a heavy hit).
import * as THREE from 'three';
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

// Damped spring with damping ratio zeta < 1 (overshoot = follow-through); semi-implicit substeps of <= 1/240 s.
function springZ(x, v, target, omega, zeta, dt) {
  const n = Math.max(1, Math.ceil(dt * 240));
  const h = dt / n;
  for (let i = 0; i < n; i++) {
    v += (-omega * omega * (x - target) - 2 * zeta * omega * v) * h;
    x += v * h;
  }
  return [x, v];
}

// Smooth pseudo-noise in about [-1, 1]: incommensurate sines, phase from the seed.
const noise = (t, f, ph) => 0.62 * Math.sin(t * f + ph) + 0.38 * Math.sin(t * f * 2.37 + ph * 1.9 + 1.1);

const SCALARS = ['crouch', 'yaw', 'lean', 'twist', 'nod', 'lateral', 'elbow_out', 'lead_extended', 'rear_extended',
  'head_turn', 'head_tilt', 'side_bend', 'body_x'];
const OMEGA = { crouch: 13, yaw: 15, lean: 14, twist: 17, nod: 16, lateral: 13, elbow_out: 14, lead_extended: 40,
  rear_extended: 40, head_turn: 16, head_tilt: 14, side_bend: 14, body_x: 11 };
const ZETA = { yaw: 0.62, twist: 0.58, lean: 0.7, body_x: 0.66, lateral: 0.75 }; // the rest: critically damped
const HAND_OMEGA = 30;
const PUNCH_OMEGA = 70;

const GUARD = { lead: [0.30, 0.10, 1.48], rear: [0.22, -0.09, 1.47] };
const BLOCK = { lead: [0.20, 0.085, 1.64], rear: [0.19, -0.085, 1.64] };
// Boxing stance on the canvas (armature space): lead (left) foot forward, rear foot back and out.
const STANCE = { lead: [0.25, 0.17], rear: [-0.23, -0.16] };
const ANKLE_Z = 0.10;
const LEG_MAX = 0.84; // hip -> ankle reach before the knee locks (thigh 0.43 + calf 0.42)

export class FighterAnimator {
  constructor(rig, { isBot = false, seed = 1 } = {}) {
    this.rig = rig;
    this.isBot = isBot;
    this.seed = seed;
    this.t = seed * 3.7;
    this.p = structuredClone(POSE_DEFAULTS);
    this.v = Object.fromEntries(SCALARS.map((k) => [k, 0]));
    this.hv = { lead: [0, 0, 0], rear: [0, 0, 0] };
    this.kick = { nod: 0, turn: 0, lean: 0, x: 0, hands: 0, tilt: 0, twist: 0 };
    this.kickV = { nod: 0, turn: 0, lean: 0, x: 0, hands: 0, tilt: 0, twist: 0 };
    this.fall = 0;        // 0 standing .. 1 lying
    this.fallV = 0;
    this.outcome = '';    // 'win' | 'lose' | ''
    this.stagger = 0;     // 1 right after a heavy hit, decays: pushes the feet back
    this.pivot = 0;       // rear-foot pivot of the cross (smoothed)
    this.heel = [0, 0];   // heel lift lead/rear (smoothed)
    this.feet = { lead: { w: null, swing: null, rest: 0 }, rear: { w: null, swing: null, rest: 0 } };
    this.footBias = { lead: 0, rear: 0 };
    this.steps = 0;       // steps taken (debug / tests)
  }

  // A clean hit landed on this fighter. hand: attacker's hand (0 lead/jab, 1 rear/cross); zone 1 = body shot.
  takeHit(hand, damage, counter, zone = 0) {
    const power = clamp(damage / 2.8, 0.4, 1.6) * (counter ? 1.25 : 1);
    const side = hand === 0 ? 1 : -1; // jab from the opponent's lead hand turns this head one way, cross the other
    if (zone === 1) {
      // to the body: folds forward around the glove, the head stays
      this.kickV.nod += 260 * power;
      this.kickV.lean += 520 * power;
      this.kickV.x -= 2.4 * power;
      this.kickV.twist += side * 180 * power;
      this.stagger = Math.max(this.stagger, clamp(power - 0.5, 0, 1));
      return;
    }
    this.kickV.nod -= 900 * power;
    this.kickV.turn += side * 640 * power;
    this.kickV.lean -= 420 * power;
    this.kickV.x -= 3.6 * power;       // ~10 cm knock-back of the hips: the feet have to catch it
    this.kickV.tilt += side * 260 * power;
    this.kickV.twist += side * 260 * power;
    this.stagger = Math.max(this.stagger, clamp(power - 0.35, 0, 1));
  }

  // A punch was stopped by this fighter's guard.
  takeBlocked(damage) {
    const power = clamp(damage / 2.8, 0.4, 1.4);
    this.kickV.hands -= 2.7 * power; // gloves pushed ~7 cm back into the face
    this.kickV.nod -= 190 * power;
    this.kickV.x -= 1.4 * power;
  }

  // Target pose for the current rules state.
  _targets(f, ctx) {
    const T = structuredClone(POSE_DEFAULTS);
    let lead = [...GUARD.lead];
    let rear = [...GUARD.rear];
    const t = this.t;
    const ph = this.seed * 1.7;
    const fighting = ctx.phase === 'Fighting' || ctx.phase === 'Training';
    const gassed = f.gassedTicksLeft > 0 || f.stamina < 12;
    let leadBias = 0;
    let rearBias = 0;
    let heelL = 0;
    let heelR = 0;
    let pivot = 0;

    // live rhythm: knees bent, bouncing on the balls of the feet, rocking in and out, weaving the head
    const hz = gassed ? 1.15 : 1.85;
    const bounce = Math.sin(t * 2 * Math.PI * hz);
    if (fighting) {
      const energy = gassed ? 0.45 : 1;
      T.crouch = 0.10 + 0.018 * energy * bounce;
      heelL = heelR = 0.018 * energy * (0.5 + 0.5 * Math.sin(t * 2 * Math.PI * hz + 1.2));
      // the legs move for real now (the rules walk the robot): the rocking only fills the pauses
      const still = 1 - clamp(Math.hypot(f.speedForward || 0, f.speedSide || 0) / 0.6, 0, 1);
      T.body_x = 0.045 * energy * still * noise(t, 1.25, ph);  // in and out of range
      T.lateral = 0.15 * energy * noise(t, 0.85, ph + 2.0);   // a small weave; the real slip comes from the rules
      T.lean += 5 * clamp(f.speedForward || 0, -1.5, 1.5);    // into the step, away when backing off
      T.side_bend += -3 * clamp(f.speedSide || 0, -1.5, 1.5);
      T.yaw += 5 * noise(t, 0.7, ph + 4.0);
      T.twist += 4 * noise(t, 1.1, ph + 5.0);
      T.side_bend = 3 * noise(t, 0.9, ph + 6.0);
      T.head_turn = 3 * noise(t, 0.6, ph + 7.0);
      const hb = 0.016 * energy;
      lead[0] += 0.03 * noise(t, 1.6, ph + 8.0);              // feinting lead hand
      lead[2] += hb * Math.sin(t * 2 * Math.PI * hz + 0.6);
      rear[2] += hb * Math.sin(t * 2 * Math.PI * hz + 1.4);
      leadBias += 0.6 * T.body_x;
      rearBias += 0.4 * T.body_x;
    } else {
      T.crouch = 0.07 + 0.006 * Math.sin(t * 2 * Math.PI * 0.8);
      T.lateral = 0.05 * noise(t, 0.5, ph);
    }

    if (gassed) {
      T.crouch += 0.035;
      T.nod += 10;
      T.lean += 3 + 2 * Math.sin(t * 2 * Math.PI * 1.3);
      lead = [lead[0] - 0.02, lead[1], lead[2] - 0.12];
      rear = [rear[0] - 0.02, rear[1], rear[2] - 0.12];
    }

    // defence
    const blocking = f.blocking > 0.5 || f.stateName === 'BlockStun' || f.stateName === 'Block';
    if (blocking) {
      lead = [...BLOCK.lead];
      rear = [...BLOCK.rear];
      T.crouch = 0.13 + 0.008 * bounce;
      T.lean = 14;
      T.nod = 20;
      T.elbow_out = 0.05;
      T.body_x *= 0.3;
      T.lateral *= 0.3;
    }
    // the head goes exactly where the rules put it (headOffset, m to the own right; that is what punches miss):
    // 0.30 m of slip = pose lateral 1.3 (+lateral = own left)
    const slip = -4.33 * (f.headOffset || 0);
    if (f.dodge !== 0) {
      T.lateral = slip;
      T.crouch = 0.16;
      T.lean = 16;
      T.nod = 16;
      T.yaw += 8 * T.lateral;
      const s = T.lateral;
      lead = [0.26, 0.10 + 0.07 * s, 1.38];
      rear = [0.18, -0.08 + 0.07 * s, 1.36];
    } else if (Math.abs(slip) > 0.02) {
      T.lateral += slip;
    }
    if (f.stateName === 'HitStun') {
      T.lean -= 8;
      T.nod -= 6;
      T.crouch += 0.03;
      lead[2] -= 0.06;
      rear[2] -= 0.06;
      T.body_x -= 0.03;
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
      // the glove goes down the punch line to the aim point: if the target slipped off it, the glove misses beside it
      const reach = clamp((f.aimAlong ?? ctx.gap) - 0.38, 0.62, 0.98);
      const aimY = -clamp(f.aimSide || 0, -0.35, 0.35); // armature +y = own left
      const body = f.zone === 1;
      const strikeZ = body ? 1.12 : 1.56;
      const pos = clamp(e, 0, 1);
      const load = clamp(-e / 0.15, 0, 1);
      const big = this.isBot ? 1.0 : 0.5; // the bot's load is exaggerated on purpose: it is the cue to react to
      this.telegraph = this.isBot ? load : 0;
      // the step of a jab and the drive of a cross both start before the hand lands
      const drive = f.stageName === 'Recovery' ? 1 - smooth(a * 1.4) : (f.stageName === 'Active' ? 1 : smooth((a - L * 0.5) / (1 - L * 0.5)));
      if (hand === 0) {
        const strike = [reach, 0.06 + aimY, strikeZ];
        const loaded = [lead[0] - 0.16 * big, lead[1] + 0.06 * big, lead[2] - 0.08 * big];
        lead = load > 0 ? lerp3(lead, loaded, load) : lerp3(lead, strike, pos);
        T.yaw = lerp(T.yaw, -36, pos) + 10 * load * big;
        T.twist = lerp(T.twist, -18, pos) + 8 * load * big;
        T.lean = lerp(T.lean, 15, pos);
        T.crouch += 0.02 * load + 0.015 * pos;
        T.body_x = lerp(T.body_x, 0.09, drive) - 0.03 * load * big; // step in behind the jab
        T.lateral = lerp(T.lateral, 0.12, pos);
        T.lead_extended = pos;
        leadBias = lerp(leadBias, 0.13, drive);                   // lead foot steps in, rear foot drags after
        rearBias = lerp(rearBias, 0.06, drive);
        rear[2] += 0.04 * pos; // chin cover
      } else {
        const strike = [reach, -0.02 + aimY, strikeZ - 0.01];
        const loaded = [rear[0] - 0.20 * big, rear[1] - 0.08 * big, rear[2] - 0.08 * big];
        rear = load > 0 ? lerp3(rear, loaded, load) : lerp3(rear, strike, pos);
        T.yaw = lerp(T.yaw, 16, pos) - 16 * load * big;            // hips turn through the target
        T.twist = lerp(T.twist, 26, pos) - 22 * load * big;
        T.lean = lerp(T.lean, 16, pos);
        T.crouch += 0.03 * load + 0.02 * pos;
        T.body_x = lerp(T.body_x, 0.08, drive) - 0.04 * load * big; // weight onto the lead leg
        T.lateral = lerp(T.lateral, 0.22, drive);
        T.head_turn = -10 * pos;
        T.rear_extended = pos;
        pivot = drive;                                              // rear heel up, foot turns in
        heelR = Math.max(heelR, 0.07 * drive);
        leadBias = lerp(leadBias, 0.04, drive);
        lead[2] += 0.05 * pos;
        lead[0] -= 0.05 * pos;
      }
      if (body) {
        T.crouch += 0.08 * pos + 0.03 * load; // level change: bend the knees to go downstairs
        T.lean += 7 * pos;
      }
      if (this.isBot && load > 0) {
        T.side_bend = (hand === 0 ? 7 : -9) * load; // shoulder dip: part of the telegraph
        T.crouch += 0.03 * load;
      }
    }

    // a heavy hit knocks the stance back: the rear foot catches the fall, then the lead foot follows
    if (this.stagger > 0.01) {
      rearBias -= 0.16 * this.stagger;
      leadBias -= 0.08 * this.stagger;
      T.crouch += 0.03 * this.stagger;
    }

    // match over
    if (ctx.phase === 'MatchOver' && this.fall < 0.5) {
      if (this.outcome === 'win') {
        const w = 0.5 + 0.5 * Math.sin(t * 2 * Math.PI * 1.2);
        lead = [0.12, 0.30, 2.02 + 0.04 * w];
        rear = [0.12, -0.30, 2.02 + 0.04 * (1 - w)];
        T.nod = -12;
        T.lean = -3;
        T.crouch = 0.02 + 0.03 * w;
        T.elbow_out = 0.6;
        heelL = heelR = 0.03 * w;
      } else if (this.outcome === 'lose') {
        lead = [0.26, 0.20, 1.12];
        rear = [0.20, -0.20, 1.10];
        T.nod = 26;
        T.lean = 18;
        T.crouch = 0.10;
      }
    }

    // down: sit back, arms limp
    if (this.fall > 0.01) {
      const k = this.fall;
      T.crouch = lerp(T.crouch, 0.30, smooth(k * 1.6));
      T.lean = lerp(T.lean, -22, k);
      T.nod = lerp(T.nod, -18, k);
      T.body_x = lerp(T.body_x, 0, k);
      lead = lerp3(lead, [0.05, 0.42, 0.95], k);
      rear = lerp3(rear, [0.00, -0.42, 0.95], k);
      T.elbow_out = lerp(T.elbow_out, 0.8, k);
    }
    return { T, lead, rear, leadBias, rearBias, heel: [heelL, heelR], pivot };
  }

  // Feet: planted in world space, stepping with a lifted arc when the body has moved away from them.
  _feet(dt, P, tg, live) {
    const rig = this.rig;
    rig.scene.updateWorldMatrix(true, false);
    const out = {};
    const desired = {};
    for (const side of ['lead', 'rear']) {
      const st = STANCE[side];
      const bias = side === 'lead' ? tg.leadBias : tg.rearBias;
      // a walking robot places its feet ahead of the body, in the direction it travels
      desired[side] = new THREE.Vector3(st[0] + bias + 0.10 * (this.speedF || 0), st[1] + P.lateral * 0.05 - 0.10 * (this.speedS || 0), ANKLE_Z);
    }
    if (!live) {
      for (const side of ['lead', 'rear']) {
        this.feet[side].w = null;
        this.feet[side].swing = null;
        out[side] = desired[side];
      }
      return out;
    }
    const hipZ = 0.95 - P.crouch;
    const local = {};
    for (const side of ['lead', 'rear']) {
      const ft = this.feet[side];
      if (!ft.w) ft.w = rig.armatureToWorld(desired[side]);
      ft.rest += dt;
      if (ft.swing) {
        const sw = ft.swing;
        sw.t += dt / sw.dur;
        sw.to = rig.armatureToWorld(desired[side]); // land where the body is now, not where it was
        const s = clamp(sw.t, 0, 1);
        const k = smooth(s);
        const w = sw.from.clone().lerp(sw.to, k);
        const a = rig.worldToArmature(w);
        a.z = ANKLE_Z + sw.lift * Math.sin(Math.PI * s);
        local[side] = a;
        if (sw.t >= 1) {
          ft.w = sw.to.clone();
          ft.swing = null;
          ft.rest = 0;
        }
      } else {
        const a = rig.worldToArmature(ft.w);
        a.z = ANKLE_Z;
        local[side] = a;
      }
    }
    // start a step: one foot at a time, the one furthest from where it belongs (or about to overreach)
    if (!this.feet.lead.swing && !this.feet.rear.swing) {
      let best = null;
      let bestErr = 0;
      for (const side of ['lead', 'rear']) {
        const a = local[side];
        const err = Math.hypot(a.x - desired[side].x, a.y - desired[side].y);
        const hy = side === 'lead' ? 0.12 : -0.12;
        const reach = Math.hypot(a.x - P.body_x, a.y - hy, hipZ - ANKLE_Z);
        const ft = this.feet[side];
        const need = err > 0.065 || reach > LEG_MAX - 0.01 || (err > 0.03 && ft.rest > 0.55);
        const score = err + (reach > LEG_MAX - 0.01 ? 1 : 0);
        if (need && ft.rest > 0.06 && score > bestErr) {
          best = side;
          bestErr = score;
        }
      }
      if (best) {
        const ft = this.feet[best];
        const err = Math.min(bestErr, 0.4);
        ft.swing = { from: ft.w.clone(), to: ft.w.clone(), t: 0, dur: clamp(0.12 + err * 0.45, 0.12, 0.24), lift: clamp(0.025 + err * 0.3, 0.03, 0.08) };
        this.steps++;
      }
    }
    return local;
  }

  update(dt, f, ctx) {
    this.t += dt;
    this.speedF = f.speedForward || 0;
    this.speedS = f.speedSide || 0;
    this.telegraph = 0;
    const down = f.stateName === 'KnockedDown' || f.stateName === 'KnockedOut';
    [this.fall, this.fallV] = spring(this.fall, this.fallV, down ? 1 : 0, down ? 5.5 : 4.0, dt);
    for (const k of Object.keys(this.kick)) {
      [this.kick[k], this.kickV[k]] = spring(this.kick[k], this.kickV[k], 0, 14, dt);
    }
    this.stagger *= Math.exp(-dt * 3.2);
    const tg = this._targets(f, ctx);
    const { T, lead, rear } = tg;
    const attacking = f.stateName === 'Attack';
    for (const k of SCALARS) {
      const om = attacking && (k === 'yaw' || k === 'twist' || k === 'lean') ? OMEGA[k] * 1.8 : OMEGA[k];
      if (ZETA[k]) [this.p[k], this.v[k]] = springZ(this.p[k], this.v[k], T[k], om, ZETA[k], dt);
      else [this.p[k], this.v[k]] = spring(this.p[k], this.v[k], T[k], om, dt);
    }
    const handOmega = (side) => (attacking && ((side === 'lead' && f.hand === 0) || (side === 'rear' && f.hand === 1)) ? PUNCH_OMEGA : HAND_OMEGA);
    for (const [side, target, key] of [['lead', lead, 'lead_hand'], ['rear', rear, 'rear_hand']]) {
      const om = handOmega(side);
      for (let i = 0; i < 3; i++) {
        [this.p[key][i], this.hv[side][i]] = spring(this.p[key][i], this.hv[side][i], target[i], om, dt);
      }
    }
    const kf = 1 - Math.exp(-dt * 22);
    this.pivot += (tg.pivot - this.pivot) * kf;
    this.heel[0] += (tg.heel[0] - this.heel[0]) * kf;
    this.heel[1] += (tg.heel[1] - this.heel[1]) * kf;

    // impulses on top of the smoothed pose
    const P = structuredClone(this.p);
    P.nod += this.kick.nod;
    P.head_turn += this.kick.turn;
    P.head_tilt += this.kick.tilt;
    P.lean += this.kick.lean;
    P.twist += this.kick.twist;
    P.body_x += this.kick.x;
    P.lead_hand = [P.lead_hand[0] + this.kick.hands, P.lead_hand[1], P.lead_hand[2]];
    P.rear_hand = [P.rear_hand[0] + this.kick.hands, P.rear_hand[1], P.rear_hand[2]];

    const live = ctx.phase !== 'Menu' && this.fall < 0.02 && !down;
    const feet = this._feet(dt, P, tg, live);
    const swingL = this.feet.lead.swing ? 0 : 1;
    const swingR = this.feet.rear.swing ? 0 : 1;
    P.lead_foot = [feet.lead.x, feet.lead.y, feet.lead.z, this.heel[0] * swingL];
    P.rear_foot = [feet.rear.x, feet.rear.y, feet.rear.z, this.heel[1] * swingR];
    P.foot_yaw = [10, lerp(35, 4, this.pivot)];
    this.rig.applyPose(computePose(P));
    // visor LEDs flare while the bot loads a punch: a readable "now!" for a human 2 m from the screen
    this.glow = (this.glow || 0) + ((this.telegraph > 0 ? 1 : 0) - (this.glow || 0)) * Math.min(1, dt * 18);
    this.rig.material.emissiveIntensity = this.rig.baseEmissive * (1 + 4.5 * this.glow);
  }
}
