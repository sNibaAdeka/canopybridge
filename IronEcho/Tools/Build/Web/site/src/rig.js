// IE-1 rig for three.js: the contract skeleton exported by Tools/Blender/Realistic/export_web.py (rigid skin, one
// UV atlas) plus a port of the analytic posing in robot.py (two-bone IK for arms and legs, torso/head frames).
// Poses are computed in Blender armature space (metres, robot faces +X, its left is +Y, Z up) exactly like the
// renders, then converted to glTF/three space (Y up): (x, y, z) -> (x, z, -y).
import * as THREE from 'three';

// robot.py BONES: name -> [head, tail, parent]
export const RIG_BONES = {
  root: [[0, 0, 0], [0, 0.25, 0], ''],
  pelvis: [[0, 0, 0.97], [0, 0, 1.08], 'root'],
  spine_01: [[0, 0, 1.08], [0, 0, 1.21], 'pelvis'],
  spine_02: [[0, 0, 1.21], [0, 0, 1.35], 'spine_01'],
  spine_03: [[0, 0, 1.35], [0, 0, 1.55], 'spine_02'],
  neck_01: [[0, 0, 1.58], [0, 0, 1.70], 'spine_03'],
  head: [[0, 0, 1.70], [0, 0, 1.96], 'neck_01'],
  thigh_l: [[0, 0.12, 0.95], [0, 0.13, 0.52], 'pelvis'],
  calf_l: [[0, 0.13, 0.52], [0, 0.14, 0.10], 'thigh_l'],
  foot_l: [[0, 0.14, 0.10], [0.17, 0.14, 0.03], 'calf_l'],
  thigh_r: [[0, -0.12, 0.95], [0, -0.13, 0.52], 'pelvis'],
  calf_r: [[0, -0.13, 0.52], [0, -0.14, 0.10], 'thigh_r'],
  foot_r: [[0, -0.14, 0.10], [0.17, -0.14, 0.03], 'calf_r'],
  clavicle_l: [[0, 0.05, 1.53], [0, 0.20, 1.57], 'spine_03'],
  upperarm_l: [[0, 0.235, 1.57], [0, 0.335, 1.225], 'clavicle_l'],
  lowerarm_l: [[0, 0.335, 1.225], [0, 0.405, 0.895], 'upperarm_l'],
  hand_l: [[0, 0.405, 0.895], [0, 0.425, 0.795], 'lowerarm_l'],
  clavicle_r: [[0, -0.05, 1.53], [0, -0.20, 1.57], 'spine_03'],
  upperarm_r: [[0, -0.235, 1.57], [0, -0.335, 1.225], 'clavicle_r'],
  lowerarm_r: [[0, -0.335, 1.225], [0, -0.405, 0.895], 'upperarm_r'],
  hand_r: [[0, -0.405, 0.895], [0, -0.425, 0.795], 'lowerarm_r'],
  fist_tip_l: [[0, 0.458, 0.63], [0, 0.466, 0.59], 'hand_l'],
  fist_tip_r: [[0, -0.458, 0.63], [0, -0.466, 0.59], 'hand_r'],
};

// Guard stance defaults of robot.pose() plus the extra channels the game animates.
const STANCE_TURN = -22 + -8; // yaw + twist of the default stance (POSE_DEFAULTS), degrees
export const POSE_DEFAULTS = {
  lead_hand: [0.30, 0.10, 1.50], rear_hand: [0.22, -0.09, 1.49], crouch: 0.06, yaw: -22, lean: 8, twist: -8,
  nod: 10, lateral: 0, lead_foot: [0.24, 0.17], rear_foot: [-0.22, -0.15], foot_yaw: [10, 35], elbow_out: 0.25,
  lead_extended: 0, rear_extended: 0, head_turn: 0, head_tilt: 0, side_bend: 0, body_x: 0,
};

const DEG = Math.PI / 180;
const V = (x, y, z) => new THREE.Vector3(x, y, z);
const vHead = (b) => V(...RIG_BONES[b][0]);
const vTail = (b) => V(...RIG_BONES[b][1]);

function mul(...ms) {
  const out = new THREE.Matrix4();
  for (const m of ms) out.multiply(m);
  return out;
}
const T = (x, y, z) => new THREE.Matrix4().makeTranslation(x, y, z);
const TV = (v) => new THREE.Matrix4().makeTranslation(v.x, v.y, v.z);
const RX = (deg) => new THREE.Matrix4().makeRotationX(deg * DEG);
const RY = (deg) => new THREE.Matrix4().makeRotationY(deg * DEG);
const RZ = (deg) => new THREE.Matrix4().makeRotationZ(deg * DEG);

// rlib.frame_matrix: local Z runs head -> tail, local X as close to `forward` as possible.
function frameMatrix(h, t, forward = V(1, 0, 0)) {
  const z = t.clone().sub(h).normalize();
  const x = forward.clone().sub(z.clone().multiplyScalar(forward.dot(z)));
  if (x.length() < 1e-4) x.set(0, 0, 1).sub(z.clone().multiplyScalar(z.z));
  x.normalize();
  const y = z.clone().cross(x);
  return new THREE.Matrix4().makeBasis(x, y, z).setPosition(h);
}

const REST = {};
const REST_INV = {};
for (const b of Object.keys(RIG_BONES)) {
  REST[b] = frameMatrix(vHead(b), vTail(b));
  REST_INV[b] = REST[b].clone().invert();
}
const restY = (b) => new THREE.Vector3().setFromMatrixColumn(REST[b], 1);
const boneLen = (b) => vTail(b).distanceTo(vHead(b));

function twoBone(root, target, a, b, pole, poleUp = null, blendUp = 0) {
  const d = target.clone().sub(root);
  const dist = Math.max(1e-4, Math.min(d.length(), (a + b) * 0.999));
  d.normalize();
  const tgt = root.clone().add(d.clone().multiplyScalar(dist));
  const cosA = (a * a + dist * dist - b * b) / (2 * a * dist);
  const ang = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const proj = (v) => v.clone().sub(d.clone().multiplyScalar(v.dot(d)));
  let n = proj(pole.clone().normalize());
  if (poleUp && blendUp > 0) {
    // A hand above the shoulder (a block, a high guard) leaves the downward pole running along the limb's axis: the elbow has
    // no defined side and flips. There the elbow direction turns, by angle in the plane across the limb, toward `poleUp`
    // (forward and down, as in a real high guard); `blendUp` is 0 for ordinary hand heights, so those poses are untouched.
    const n1 = proj(poleUp.clone().normalize());
    if (n.length() < 1e-4) n = n1;
    else if (n1.length() > 1e-4) {
      const e1 = n.clone().normalize();
      const e2 = d.clone().cross(e1);
      const theta = Math.atan2(n1.dot(e2), n1.dot(e1)) * blendUp;
      n = e1.multiplyScalar(Math.cos(theta)).add(e2.multiplyScalar(Math.sin(theta)));
    }
  }
  if (n.length() < 1e-6) n.set(0, 0, -1);
  n.normalize();
  const mid = root.clone().add(d.clone().multiplyScalar(Math.cos(ang)).add(n.multiplyScalar(Math.sin(ang))).multiplyScalar(a));
  return [mid, tgt, n];
}

// The glove target is given in the body's frame, but the shoulder swings with lean, twist and yaw: a glove that ends up
// right at the shoulder leaves the two-bone chain without a direction (the elbow flips) and folds the 0.7 m arm into a V.
// Keep the wrist at a boxer's minimum distance from the shoulder (a guard is ~0.25 m away) and, very close to it,
// fade the direction to a sensible one (forward, a little toward the centre line).
const ARM_MIN_REACH = 0.25;
const ARM_DEAD_ZONE = 0.10;
function armTarget(shoulder, target, side) {
  const d = target.clone().sub(shoulder);
  const len = d.length();
  const prefer = V(0.8, -side * 0.3, 0.15).normalize();
  let dir;
  if (len >= ARM_DEAD_ZONE) dir = d.divideScalar(len);
  else {
    const w = len / ARM_DEAD_ZONE;
    dir = (len > 1e-6 ? d.divideScalar(len).multiplyScalar(w) : V(0, 0, 0)).add(prefer.multiplyScalar(1 - w)).normalize();
  }
  return shoulder.clone().add(dir.multiplyScalar(Math.max(len, ARM_MIN_REACH)));
}

// The hinge axis `y` of a two-bone limb follows from the geometry (across the plane of the bend) and is continuous. It used to
// be z1 x z2, flipped whenever it pointed against the rest pose's axis: every time the elbow plane turned through 90 degrees
// the whole arm rolled 180 degrees about its length in a single frame.
function chainFrames(p0, p1, p2, yAxis) {
  const z1 = p1.clone().sub(p0).normalize();
  const z2 = p2.clone().sub(p1).normalize();
  const y = yAxis.clone().normalize();
  const f1 = new THREE.Matrix4().makeBasis(y.clone().cross(z1), y, z1).setPosition(p0);
  const f2 = new THREE.Matrix4().makeBasis(y.clone().cross(z2), y, z2).setPosition(p1);
  return [f1, f2];
}

// robot.pose(): deform matrix per bone (Blender armature space). A rigid part bound to bone b moves by D[b].
export function computePose(p) {
  const D = {};
  const lat = p.lateral;
  const hip = V(0, 0, 0.97);
  const tPelvis = mul(T(p.body_x, lat * 0.08, -p.crouch), TV(hip), RZ(p.yaw), RX(-lat * 6), TV(hip.clone().negate()));
  const waist = V(0, 0, 1.08);
  const tChest = mul(tPelvis, TV(waist), RZ(p.twist), RY(p.lean), RX(-lat * 14 + p.side_bend), TV(waist.clone().negate()));
  const neck = V(0, 0, 1.62);
  const tHead = mul(tChest, TV(neck), RZ(-p.twist - p.yaw * 0.6 + p.head_turn), RY(p.nod), RX(p.head_tilt), TV(neck.clone().negate()));

  D.root = new THREE.Matrix4();
  D.pelvis = tPelvis;
  D.spine_01 = mul(tPelvis, TV(waist), RZ(p.twist * 0.5), RY(p.lean * 0.5), TV(waist.clone().negate()));
  for (const b of ['spine_02', 'spine_03', 'clavicle_l', 'clavicle_r', 'neck_01']) D[b] = tChest;
  D.head = tHead;

  const arms = [['l', 1, p.lead_hand, p.lead_extended], ['r', -1, p.rear_hand, p.rear_extended]];
  for (const [side, s, target, ext] of arms) {
    const sh = vHead(`upperarm_${side}`).applyMatrix4(tChest);
    const a = boneLen(`upperarm_${side}`);
    const b = boneLen(`lowerarm_${side}`);
    const pole = V(-0.35, s * p.elbow_out, -1.0).lerp(V(0.0, s * 0.2, -1.0), Math.max(0, Math.min(1, ext)));
    // While kicking (guard_follow 0..1) a hand that is not punching goes with the turning torso, like a real boxer's guard does:
    // left where it was, the shoulder swings through the glove target and the arm flips over the shoulder.
    let goal = V(target[0], target[1], target[2]);
    const follow = (p.guard_follow || 0) * (1 - Math.max(0, Math.min(1, ext)));
    if (follow > 0) goal = goal.clone().lerp(goal.clone().applyMatrix4(RZ(p.yaw + p.twist - STANCE_TURN)), follow);
    const reach = armTarget(sh, goal, s);
    const up = reach.clone().sub(sh).normalize().z; // how far above the shoulder the glove is, 0..1
    const hUp = Math.max(0, Math.min(1, (up - 0.25) / 0.35));
    const [elbow, wrist, bend] = twoBone(sh, reach, a, b, pole, V(0.7, s * 0.3, -0.5), hUp * hUp * (3 - 2 * hUp));
    const [fUp, fLo] = chainFrames(sh, elbow, wrist, wrist.clone().sub(sh).normalize().cross(bend).negate());
    D[`upperarm_${side}`] = mul(fUp, REST_INV[`upperarm_${side}`]);
    D[`lowerarm_${side}`] = mul(fLo, REST_INV[`lowerarm_${side}`]);
    const fHand = fLo.clone().setPosition(wrist);
    D[`hand_${side}`] = mul(fHand, REST_INV[`hand_${side}`]);
    D[`fist_tip_${side}`] = D[`hand_${side}`];
  }

  const legs = [['l', 1, p.lead_foot, p.foot_yaw[0]], ['r', -1, p.rear_foot, p.foot_yaw[1]]];
  for (const [side, s, foot, fyaw] of legs) {
    const hp = vHead(`thigh_${side}`).applyMatrix4(tPelvis);
    const a = boneLen(`thigh_${side}`);
    const b = boneLen(`calf_${side}`);
    const fdir = V(1, 0, 0).applyMatrix4(RZ(-s * fyaw));
    // foot = [x, y, ankle z (0.10 on the canvas, more while swinging), heel lift (toe stays down)]
    const heel = foot.length > 3 ? foot[3] : 0;
    const az = foot.length > 2 ? foot[2] : 0.10;
    const [knee, ankle, bendL] = twoBone(hp, V(foot[0], foot[1], az + heel), a, b, fdir.clone());
    // a knee bends forward, the opposite way to an elbow: its hinge axis is the other sign of the same geometric axis
    const [fTh, fCa] = chainFrames(hp, knee, ankle, ankle.clone().sub(hp).normalize().cross(bendL));
    D[`thigh_${side}`] = mul(fTh, REST_INV[`thigh_${side}`]);
    D[`calf_${side}`] = mul(fCa, REST_INV[`calf_${side}`]);
    const toe = ankle.clone().add(fdir.clone().multiplyScalar(0.17)).add(V(0, 0, -0.07 - heel + Math.max(0, az - 0.10) * 0.6));
    D[`foot_${side}`] = mul(frameMatrix(ankle, toe, fdir), REST_INV[`foot_${side}`]);
  }
  return D;
}

// Blender -> glTF/three basis change.
const C = new THREE.Matrix4().set(1, 0, 0, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 0, 0, 1);
const C_INV = C.clone().invert();
export function blenderToThree(v) { return new THREE.Vector3(v.x, v.z, -v.y); }

export class RobotRig {
  // gltf: loaded GLB (mesh + skeleton, no material); maps: { map, normalMap, orm, emissiveMap } textures
  constructor(gltf, maps, { name = 'robot', emissiveIntensity = 3.0 } = {}) {
    this.name = name;
    this.root = new THREE.Group();
    this.root.name = name;
    this.scene = gltf.scene;
    this.root.add(this.scene);
    this.skinned = [];
    this.scene.traverse((o) => {
      if (o.isSkinnedMesh) this.skinned.push(o);
    });
    if (!this.skinned.length) throw new Error(`${name}: no skinned mesh in GLB`);
    this.baseEmissive = emissiveIntensity;
    this.material = new THREE.MeshStandardMaterial({
      map: maps.map, normalMap: maps.normalMap, aoMap: maps.orm, roughnessMap: maps.orm, metalnessMap: maps.orm,
      emissiveMap: maps.emissiveMap, emissive: new THREE.Color(1, 1, 1), emissiveIntensity, roughness: 1.0,
      metalness: 1.0, aoMapIntensity: 1.0, envMapIntensity: 1.0,
    });
    for (const m of this.skinned) {
      m.material = this.material;
      m.castShadow = true;
      m.receiveShadow = true;
      m.frustumCulled = false; // bounds of the bind pose are wrong once posed
    }
    const skeleton = this.skinned[0].skeleton;
    this.bones = {};
    this.bind = {};
    // Rest bone matrices in GLB-scene space, taken from the node hierarchy (not from the inverse bind matrices:
    // gltfpack's vertex quantisation folds its dequantisation into those).
    this.scene.updateMatrixWorld(true);
    const sceneInv = this.scene.matrixWorld.clone().invert();
    skeleton.bones.forEach((bone) => {
      this.bones[bone.name] = bone;
      this.bind[bone.name] = new THREE.Matrix4().multiplyMatrices(sceneInv, bone.matrixWorld);
    });
    skeleton.bones.forEach((bone) => { bone.matrixAutoUpdate = false; });
    for (const b of Object.keys(RIG_BONES)) {
      if (!this.bones[b]) throw new Error(`${name}: bone ${b} missing in GLB`);
    }
    // parents first
    this.order = [];
    const visit = (b) => {
      if (this.order.includes(b)) return;
      const parent = RIG_BONES[b][2];
      if (parent) visit(parent);
      this.order.push(b);
    };
    Object.keys(RIG_BONES).forEach(visit);
    this._world = {};
    this.deform = {};
    this.applyPose(computePose(POSE_DEFAULTS));
  }

  // D: deform per bone in Blender space (computePose output).
  applyPose(D) {
    this.deform = D;
    this.scene.updateWorldMatrix(true, false);
    const rootParent = this.bones.root.parent;
    if (rootParent) rootParent.updateWorldMatrix(true, false);
    const sceneWorld = this.scene.matrixWorld;
    const tmp = new THREE.Matrix4();
    for (const b of this.order) {
      const dt = mul(C, D[b] || new THREE.Matrix4(), C_INV);
      const world = mul(sceneWorld, dt, this.bind[b]);
      this._world[b] = world;
      const bone = this.bones[b];
      const parentWorld = this._world[RIG_BONES[b][2]] || (bone.parent ? bone.parent.matrixWorld : new THREE.Matrix4());
      tmp.copy(parentWorld).invert();
      bone.matrix.multiplyMatrices(tmp, world);
    }
  }

  // Point given in Blender rest space (e.g. a bone head), carried by bone b's deform, in world space.
  worldPoint(b, blenderPoint) {
    const p = blenderPoint.clone().applyMatrix4(this.deform[b] || new THREE.Matrix4());
    return blenderToThree(p).applyMatrix4(this.scene.matrixWorld);
  }

  // Blender armature space <-> world (foot planting).
  armatureToWorld(p) { return blenderToThree(p).applyMatrix4(this.scene.matrixWorld); }
  worldToArmature(w) {
    const t = w.clone().applyMatrix4(this.scene.matrixWorld.clone().invert());
    return new THREE.Vector3(t.x, -t.z, t.y);
  }

  fistWorld(side) { return this.worldPoint(`fist_tip_${side}`, vHead(`fist_tip_${side}`)); }
  headWorld() { return this.worldPoint('head', V(0.10, 0, 1.80)); }
  chestWorld() { return this.worldPoint('spine_03', V(0.16, 0, 1.38)); }
}
