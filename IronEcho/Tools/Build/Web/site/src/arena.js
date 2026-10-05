// Arena for the browser version: the pro ring of Tools/Blender/Realistic/ring.py rebuilt as real-time geometry
// (same dimensions; the canvas print is the Cycles albedo bake), the venue as a Cycles equirectangular panorama
// (background + image-based lighting), and TV truss lighting with real-time shadows.
// World: metres, Y up, the fight line is X (player at -X), ring centre at the origin, canvas top at y = 0.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export const RING = { INSIDE: 6.10, HALF: 3.05, POST: 3.35, APRON: 3.67, HEIGHT: 1.0, ROPES: [0.46, 0.76, 1.07, 1.37] };

const lin = (r, g, b) => new THREE.Color().setRGB(r, g, b, THREE.LinearSRGBColorSpace);

export function createRenderer(canvas, quality) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance', alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1.25));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  return renderer;
}

export function applyVenue(renderer, scene, pano) {
  pano.mapping = THREE.EquirectangularReflectionMapping;
  pano.colorSpace = THREE.SRGBColorSpace;
  scene.background = pano;
  scene.backgroundIntensity = 1.0;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(pano).texture;
  scene.environmentIntensity = 0.85;
  pmrem.dispose();
}

function apronTexture(band, label) {
  const c = document.createElement('canvas');
  c.width = 2048;
  c.height = 288;
  const g = c.getContext('2d');
  g.fillStyle = '#121214';
  g.fillRect(0, 0, c.width, c.height);
  // vinyl grain
  const img = g.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * 9;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  g.putImageData(img, 0, 0);
  g.fillStyle = band;
  g.fillRect(12, 16, c.width - 24, 20);
  g.fillStyle = '#d9d9dc';
  g.font = '800 104px "Arial Black", "Helvetica Neue", Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, c.width / 2, 150);
  g.globalAlpha = 0.55;
  g.font = '700 30px Arial, sans-serif';
  g.fillText('ROBOT BOXING CHAMPIONSHIP', c.width / 2, 232);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

export function buildRing(canvasTex) {
  const ring = new THREE.Group();
  ring.name = 'ring';
  const { HALF, POST, APRON, HEIGHT, ROPES } = RING;
  const size = 2 * APRON + 0.04;

  // canvas surface (Cycles albedo bake of the canvas and its prints) on a padded body
  canvasTex.colorSpace = THREE.SRGBColorSpace;
  canvasTex.anisotropy = 16;
  const canvasMat = new THREE.MeshStandardMaterial({ map: canvasTex, roughness: 0.86, metalness: 0.0 });
  const top = new THREE.Mesh(new THREE.PlaneGeometry(size, size).rotateX(-Math.PI / 2), canvasMat);
  top.receiveShadow = true;
  ring.add(top);
  const edgeMat = new THREE.MeshStandardMaterial({ color: lin(0.2, 0.2, 0.21), roughness: 0.8 });
  const body = new THREE.Mesh(new RoundedBoxGeometry(size, 0.06, size, 2, 0.025), edgeMat);
  body.position.y = -0.0305;
  body.receiveShadow = true;
  ring.add(body);

  // platform skirt with the printed apron (red and blue bands alternate like ring.py)
  const skirtH = HEIGHT - 0.06;
  const skirtMats = [apronTexture('#b3221d', 'IRON ECHO'), apronTexture('#1f3a9c', 'IRON ECHO')]
    .map((map) => new THREE.MeshStandardMaterial({ map, roughness: 0.55, metalness: 0.0 }));
  for (let i = 0; i < 4; i++) {
    const side = new THREE.Mesh(new THREE.PlaneGeometry(2 * APRON, skirtH), skirtMats[i % 2]);
    const rot = (i * Math.PI) / 2;
    side.position.set(Math.cos(rot) * APRON, -0.06 - skirtH / 2, -Math.sin(rot) * APRON);
    side.rotation.y = rot + Math.PI / 2;
    side.receiveShadow = true;
    ring.add(side);
  }

  // posts, caps, corner pads (blue -X/-Z corner = Blender -X/-Y, red +X/+Z... see corners below)
  const steel = new THREE.MeshStandardMaterial({ color: lin(0.12, 0.105, 0.095), metalness: 0.75, roughness: 0.52 });
  const chrome = new THREE.MeshStandardMaterial({ color: lin(0.8, 0.8, 0.82), metalness: 1.0, roughness: 0.14 });
  const leather = (c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.42, clearcoat: 0.35, clearcoatRoughness: 0.3, sheen: 0.2 });
  const pads = { blue: leather(lin(0.01, 0.07, 0.42)), red: leather(lin(0.48, 0.015, 0.01)), white: leather(lin(0.62, 0.62, 0.62)) };
  // Blender (x, y) -> three (x, -z): blue corner (-1,-1) -> (-x, +z); red (1, 1) -> (+x, -z)
  const corners = [[-1, 1, 'blue'], [1, -1, 'red'], [1, 1, 'white'], [-1, -1, 'white']];
  for (const [sx, sz, pad] of corners) {
    const px = sx * POST;
    const pz = sz * POST;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.055, 1.62, 28), steel);
    post.position.set(px, 0.81 - 0.06, pz);
    post.castShadow = true;
    ring.add(post);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.05, 28), steel);
    cap.position.set(px, 1.57, pz);
    ring.add(cap);
    const ang = Math.atan2(-sz, -sx);
    const padMesh = new THREE.Mesh(new RoundedBoxGeometry(0.2, 1.08, 0.26, 4, 0.07), pads[pad]);
    padMesh.position.set(px + 0.17 * Math.cos(ang), 0.92, pz + 0.17 * Math.sin(ang));
    padMesh.rotation.y = -ang;
    padMesh.castShadow = true;
    padMesh.receiveShadow = true;
    ring.add(padMesh);
    for (const y of ROPES) {
      const tb = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.16, 12), chrome);
      tb.position.set(px + 0.09 * Math.cos(ang), y, pz + 0.09 * Math.sin(ang));
      tb.rotation.z = Math.PI / 2;
      tb.rotation.y = -ang;
      ring.add(tb);
    }
  }

  // ropes with sag + ties
  const ropeMat = new THREE.MeshPhysicalMaterial({ color: lin(0.62, 0.62, 0.63), roughness: 0.35, clearcoat: 0.3, clearcoatRoughness: 0.25 });
  const tieMat = new THREE.MeshStandardMaterial({ color: lin(0.02, 0.02, 0.025), roughness: 0.6 });
  for (let side = 0; side < 4; side++) {
    const rot = (side * Math.PI) / 2;
    const c = Math.cos(rot);
    const s = Math.sin(rot);
    const at = (x, z, y) => new THREE.Vector3(x * c - z * s, y, x * s + z * c);
    for (const y of ROPES) {
      const pts = [];
      for (let k = 0; k <= 8; k++) {
        const u = -HALF - 0.12 + (k * (2 * HALF + 0.24)) / 8;
        const sag = 0.035 * (1 - (u / (HALF + 0.12)) ** 2);
        pts.push(at(HALF + 0.04, u, y - sag));
      }
      const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 48, 0.026, 10), ropeMat);
      rope.castShadow = true;
      rope.receiveShadow = true;
      ring.add(rope);
    }
    for (const u of [-HALF / 3, HALF / 3]) {
      const tie = new THREE.Mesh(new RoundedBoxGeometry(0.03, ROPES[3] - ROPES[0] + 0.08, 0.05, 2, 0.008), tieMat);
      const p = at(HALF + 0.06, u, (ROPES[0] + ROPES[3]) / 2 - 0.02);
      tie.position.copy(p);
      tie.rotation.y = -rot;
      ring.add(tie);
    }
  }

  // steps at the blue and red corners
  for (const [sx, sz] of [[-1, 1], [1, -1]]) {
    for (let i = 0; i < 3; i++) {
      const h = HEIGHT - i * 0.32;
      const d = APRON + 0.25 + i * 0.3;
      const step = new THREE.Mesh(new THREE.BoxGeometry(0.9, h, 0.3), steel);
      step.position.set(sx * (APRON - 0.6), -HEIGHT + h / 2, sz * d);
      step.receiveShadow = true;
      ring.add(step);
    }
  }
  return ring;
}

// TV lighting: soft top key with the main contact shadows, hard truss spots, cool/warm rims.
export function buildLights(scene, quality) {
  const lights = new THREE.Group();
  const key = new THREE.DirectionalLight(0xfff4e8, 2.2);
  key.position.set(0.8, 6.0, 0.6);
  key.target.position.set(0, 0.9, 0);
  key.castShadow = true;
  key.shadow.mapSize.set(quality === 'high' ? 2048 : 1024, quality === 'high' ? 2048 : 1024);
  key.shadow.camera.left = -3.2;
  key.shadow.camera.right = 3.2;
  key.shadow.camera.top = 3.2;
  key.shadow.camera.bottom = -3.2;
  key.shadow.camera.near = 2;
  key.shadow.camera.far = 9;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 4;
  lights.add(key, key.target);

  const spotSpots = [[-3.9, 1.75], [-3.9, -1.75], [3.9, 1.75], [3.9, -1.75], [1.75, 3.9], [-1.75, -3.9]];
  spotSpots.forEach(([x, z], i) => {
    const spot = new THREE.SpotLight(0xfff1df, 95, 14, (30 * Math.PI) / 180 / 2 + 0.12, 0.45, 2);
    spot.position.set(x, 5.75, z);
    spot.target.position.set(x * 0.08, 1.1, z * 0.08);
    const shadow = quality === 'high' ? i < 2 : false;
    spot.castShadow = shadow;
    if (shadow) {
      spot.shadow.mapSize.set(1024, 1024);
      spot.shadow.bias = -0.0005;
      spot.shadow.normalBias = 0.02;
      spot.shadow.camera.near = 2;
      spot.shadow.camera.far = 12;
    }
    lights.add(spot, spot.target);
  });

  const rimBlue = new THREE.DirectionalLight(0x8cb2ff, 0.9);
  rimBlue.position.set(-9, 7, 9);
  const rimRed = new THREE.DirectionalLight(0xffa070, 0.8);
  rimRed.position.set(9, 7, -9);
  lights.add(rimBlue, rimRed);
  scene.add(lights);
  return lights;
}

// Training: a heavy bag on a chain that swings when hit (pendulum, damped).
export class HeavyBag {
  constructor() {
    this.group = new THREE.Group();
    this.pivot = new THREE.Group();
    this.pivot.position.set(0, 3.1, 0);
    this.group.add(this.pivot);
    const leather = new THREE.MeshPhysicalMaterial({ color: lin(0.12, 0.012, 0.01), roughness: 0.5, clearcoat: 0.4, clearcoatRoughness: 0.35 });
    const bag = new THREE.Mesh(new THREE.CapsuleGeometry(0.19, 1.0, 8, 24), leather);
    bag.position.y = -1.75;
    bag.castShadow = true;
    bag.receiveShadow = true;
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.195, 0.195, 0.06, 32), new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.4 }));
    band.position.y = -1.35;
    const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 1.25, 6), new THREE.MeshStandardMaterial({ color: 0x9a9a9a, metalness: 1, roughness: 0.3 }));
    chain.position.y = -0.62;
    this.pivot.add(bag, band, chain);
    this.angle = 0;
    this.vel = 0;
    this.twist = 0;
    this.twistVel = 0;
  }

  hit(power, side) {
    this.vel -= 0.9 * power;
    this.twistVel += side * 1.2 * power;
  }

  update(dt) {
    const g = 9.81 / 1.9;
    this.vel += (-g * Math.sin(this.angle) - 0.9 * this.vel) * dt;
    this.angle += this.vel * dt;
    this.twistVel += (-6 * this.twist - 1.5 * this.twistVel) * dt;
    this.twist += this.twistVel * dt;
    this.pivot.rotation.z = this.angle;
    this.pivot.rotation.y = this.twist;
  }
}
