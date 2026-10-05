// Impact effects: metal sparks on clean hits, cooler sparks on blocked punches, a short flash, camera shake.
import * as THREE from 'three';

function dotTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Sparks {
  constructor(scene, max = 600) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.age = new Float32Array(max);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.035, map: dotTexture(), vertexColors: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, sizeAttenuation: true, toneMapped: false,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.flashes = [];
    this.flashMat = new THREE.SpriteMaterial({ map: dotTexture(), color: 0xffffff, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false });
    this.scene = scene;
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -100;
  }

  // dir: unit vector of the punch; kind: 'hit' | 'block' | 'counter'
  burst(at, dir, kind, power = 1) {
    const n = Math.round((kind === 'block' ? 26 : kind === 'counter' ? 70 : 46) * power);
    const warm = kind !== 'block';
    for (let k = 0; k < n; k++) {
      const i = this.next;
      this.next = (this.next + 1) % this.max;
      const spread = new THREE.Vector3((Math.random() - 0.5) * 2, Math.random() * 1.2 - 0.2, (Math.random() - 0.5) * 2).normalize();
      const v = dir.clone().multiplyScalar(1.2 + Math.random() * 2.5).add(spread.multiplyScalar(1.5 + Math.random() * 3.5)).multiplyScalar(power);
      this.pos.set([at.x, at.y, at.z], i * 3);
      this.vel.set([v.x, v.y, v.z], i * 3);
      const heat = Math.random();
      if (warm) this.col.set([3.2, 1.4 + 1.2 * heat, 0.35 + 0.6 * heat * heat], i * 3);
      else this.col.set([1.4 + heat, 1.8 + heat, 3.0], i * 3);
      this.life[i] = 0.22 + Math.random() * (warm ? 0.45 : 0.25);
      this.age[i] = 0;
    }
    const flash = new THREE.Sprite(this.flashMat.clone());
    flash.material.color.set(warm ? 0xffd2a0 : 0xbfd6ff);
    flash.position.copy(at);
    flash.scale.setScalar(0.35 * power * (kind === 'counter' ? 1.5 : 1));
    flash.userData.age = 0;
    this.scene.add(flash);
    this.flashes.push(flash);
  }

  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) continue;
      this.age[i] += dt;
      const k = i * 3;
      if (this.age[i] >= this.life[i]) {
        this.life[i] = 0;
        this.pos[k + 1] = -100;
        continue;
      }
      this.vel[k + 1] -= 9.8 * dt;
      const drag = Math.exp(-2.2 * dt);
      this.vel[k] *= drag;
      this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      if (this.pos[k + 1] < 0.005) {
        this.pos[k + 1] = 0.005;
        this.vel[k + 1] *= -0.3;
      }
      const fade = 1 - this.age[i] / this.life[i];
      this.col[k] *= 0.985 + 0.015 * fade;
      this.col[k + 1] *= 0.96 + 0.04 * fade;
      this.col[k + 2] *= 0.93 + 0.07 * fade;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;
    this.flashes = this.flashes.filter((f) => {
      f.userData.age += dt;
      const a = 1 - f.userData.age / 0.09;
      if (a <= 0) {
        this.scene.remove(f);
        f.material.dispose();
        return false;
      }
      f.material.opacity = a;
      return true;
    });
  }
}

// Trauma-style shake: add() on impacts, offset() each frame.
export class Shake {
  constructor() { this.trauma = 0; this.t = 0; }
  add(amount) { this.trauma = Math.min(1, this.trauma + amount); }
  update(dt) { this.t += dt; this.trauma = Math.max(0, this.trauma - dt * 1.8); }
  offset() {
    const s = this.trauma * this.trauma;
    const n = (f, o) => Math.sin(this.t * f + o) * 0.6 + Math.sin(this.t * f * 2.13 + o * 1.7) * 0.4;
    return { x: 0.06 * s * n(37, 0.1), y: 0.05 * s * n(41, 1.3), z: 0.04 * s * n(29, 2.2), roll: 0.03 * s * n(23, 0.7) };
  }
}
