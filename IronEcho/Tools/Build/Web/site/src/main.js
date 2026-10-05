// IRON ECHO in the browser: menu -> loading -> bout. The rules (timing, hits, bot, knockdowns, judges) are the real
// C++ core; this file wires input, the core, animation, effects, sound, HUD and the camera.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { loadCore } from './core.js';
import { RobotRig } from './rig.js';
import { FighterAnimator } from './anim.js';
import { createRenderer, applyVenue, buildRing, buildLights, HeavyBag, updateRingOcclusion } from './arena.js';
import { Sparks, Shake } from './fx.js';
import { Sound } from './audio.js';
import { ManualInput } from './input.js';
import { Hud } from './hud.js';

const NAMES = ['FORGE 07', 'EMBER 13'];
const PHASE_LABEL = { WaitingForPlayer: 'ПРИГОТОВЬСЯ', Paused: 'ПАУЗА' };
const $ = (s) => document.querySelector(s);

const settings = { level: 0, mode: 'bout', quality: 'high', control: 'keys' }; // Easy first: new players lose ~94% on Normal
try {
  Object.assign(settings, JSON.parse(localStorage.getItem('ironecho.settings') || '{}'));
} catch { /* storage unavailable: defaults */ }
const saveSettings = () => { try { localStorage.setItem('ironecho.settings', JSON.stringify(settings)); } catch { /* ignore */ } };

const assetUrl = (name) => (globalThis.IRONECHO_ASSETS && globalThis.IRONECHO_ASSETS[name]) || `assets/${name}`;

const app = {
  core: null, renderer: null, scene: null, camera: null, rigs: null, anim: null, bag: null, ring: null,
  sparks: null, shake: new Shake(), sound: new Sound(), hud: new Hud(), input: null, cameraInput: null,
  state: 'menu', training: false, lastPhase: '', resultsShown: false, resultTimer: 0, hitStop: 0, intro: 0,
  camPos: new THREE.Vector3(-4.5, 2.6, 2.6), camLook: new THREE.Vector3(0, 1.3, 0), loaded: false,
};

// ---------------------------------------------------------------- loading
function progress(fraction, label) {
  $('#load-fill').style.width = `${Math.round(fraction * 100)}%`;
  if (label) $('#load-label').textContent = label;
  const note = $('#menu-load');
  if (note) {
    note.hidden = fraction >= 1;
    note.textContent = `Загрузка арены… ${Math.round(fraction * 100)}%`;
  }
}

// The arena loads as soon as the page opens, behind the menu; "В ринг" waits for it only if it is not ready yet.
let worldPromise = null;
function ensureWorld() {
  if (!worldPromise) {
    worldPromise = buildWorld().catch((err) => { worldPromise = null; throw err; });
  }
  return worldPromise;
}

async function loadAssets() {
  const texLoader = new THREE.TextureLoader();
  const gltfLoader = new GLTFLoader();
  // Robots come meshopt-compressed (~5x smaller) when this browser runs WebAssembly; otherwise the plain GLBs.
  let decoder = globalThis.IRONECHO_MESHOPT || null;
  if (!decoder && app.core.kind === 'WebAssembly') {
    try {
      const mod = await import('three/addons/libs/meshopt_decoder.module.js');
      await mod.MeshoptDecoder.ready;
      decoder = mod.MeshoptDecoder;
    } catch (err) {
      console.warn('[assets] meshopt decoder unavailable, loading uncompressed robots', err);
    }
  }
  if (decoder) gltfLoader.setMeshoptDecoder(decoder);
  // The artifact host serves no .glb: the site ships each GLB base64-wrapped in JSON ({"glb": "..."}).
  const loadGlb = async (name) => {
    if (globalThis.IRONECHO_ASSETS && globalThis.IRONECHO_ASSETS[name]) return gltfLoader.loadAsync(globalThis.IRONECHO_ASSETS[name]);
    if (globalThis.IRONECHO_DEPS && globalThis.IRONECHO_DEPS.glb === 'plain') return gltfLoader.loadAsync(`assets/${name}`);
    const res = await fetch(`assets/${name}.json`);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    const b64 = (await res.json()).glb;
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return gltfLoader.parseAsync(bytes.buffer, '');
  };
  const glbName = (livery) => (decoder ? `IE1_${livery}.mo.glb` : `IE1_${livery}.glb`);
  const jobs = [];
  let done = 0;
  const track = (p) => p.then((v) => { done++; progress(done / jobs.length); return v; });
  const tex = (name, { srgb = true, flipY = true } = {}) => track(texLoader.loadAsync(assetUrl(name)).then((t) => {
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.flipY = flipY;
    t.anisotropy = 8;
    return t;
  }));
  const robot = (livery) => ({
    gltf: track(loadGlb(glbName(livery))),
    map: tex(`T_IE1_${livery}_BaseColor.jpg`, { flipY: false }),
    normalMap: tex(`T_IE1_${livery}_Normal.jpg`, { srgb: false, flipY: false }),
    orm: tex(`T_IE1_${livery}_ORM.jpg`, { srgb: false, flipY: false }),
    emissiveMap: tex(`T_IE1_${livery}_Emissive.jpg`, { flipY: false }),
  });
  const forge = robot('Forge');
  const ember = robot('Ember');
  const pano = tex('T_Venue_Pano.jpg');
  const canvas = tex('T_Ring_Canvas.jpg');
  for (const r of [forge, ember]) jobs.push(...Object.values(r));
  jobs.push(pano, canvas);
  const resolve = async (r) => Object.fromEntries(await Promise.all(Object.entries(r).map(async ([k, v]) => [k, await v])));
  return { forge: await resolve(forge), ember: await resolve(ember), pano: await pano, canvas: await canvas };
}

async function buildWorld() {
  progress(0.02, 'Запуск ядра правил…');
  if (!document.createElement('canvas').getContext('webgl2')) {
    throw new Error('браузер или видеокарта без WebGL 2. Обнови Chrome/Edge и драйвер видеокарты, включи аппаратное ускорение в настройках браузера');
  }
  app.core = await loadCore();
  progress(0.05, 'Загрузка роботов и арены…');
  const assets = await loadAssets();
  progress(1, 'Сборка сцены…');

  const canvasEl = $('#view');
  app.renderer = createRenderer(canvasEl, settings.quality);
  app.scene = new THREE.Scene();
  app.camera = new THREE.PerspectiveCamera(46, 1, 0.05, 200);
  applyVenue(app.renderer, app.scene, assets.pano);
  app.ring = buildRing(assets.canvas);
  app.scene.add(app.ring);
  app.lights = buildLights(app.scene, settings.quality);
  app.builtQuality = settings.quality;

  const mk = (a, name) => new RobotRig(a.gltf, { map: a.map, normalMap: a.normalMap, orm: a.orm, emissiveMap: a.emissiveMap }, { name });
  const player = mk(assets.forge, 'Forge');
  const opponent = mk(assets.ember, 'Ember');
  app.rigs = { player, opponent };
  app.holders = {};
  for (const [key, rig] of Object.entries(app.rigs)) {
    const face = new THREE.Group();
    const tilt = new THREE.Group();
    tilt.position.x = -0.24; // fall pivot behind the heels
    rig.root.position.x = 0.24;
    tilt.add(rig.root);
    face.add(tilt);
    face.rotation.y = key === 'opponent' ? Math.PI : 0;
    app.scene.add(face);
    app.holders[key] = { face, tilt };
  }
  app.anim = {
    player: new FighterAnimator(player, { isBot: false, seed: 1 }),
    opponent: new FighterAnimator(opponent, { isBot: true, seed: 2 }),
  };
  app.bag = new HeavyBag();
  app.scene.add(app.bag.group);
  app.sparks = new Sparks(app.scene);
  app.input = new ManualInput($('#stage'));
  app.input.bindTouch($('#pad'));
  app.input.onPause = togglePause;
  window.addEventListener('resize', resize);
  resize();
  app.loaded = true;
}

// Graphics quality: pixel-ratio cap and shadowed spots; switchable live from the menu.
const PIXEL_CAP = { high: 2, low: 1.25 };
let resScale = 1; // adaptive resolution (0.6..1), lowered when the frame rate drops
function applyPixelRatio() {
  const ratio = Math.min(window.devicePixelRatio || 1, PIXEL_CAP[settings.quality] || 1.25) * resScale;
  if (Math.abs(app.renderer.getPixelRatio() - ratio) > 0.01) app.renderer.setPixelRatio(ratio);
}
function applyQuality() {
  if (!app.loaded) return;
  app.scene.remove(app.lights);
  app.lights.traverse((o) => { if (o.shadow && o.shadow.map) o.shadow.map.dispose(); });
  app.lights = buildLights(app.scene, settings.quality);
  app.builtQuality = settings.quality;
  resScale = 1;
  applyPixelRatio();
  resize();
}
// Keep the fight above ~50 fps on weak GPUs: every 2 s compare the mean frame time and step the resolution.
const perf = { sum: 0, n: 0 };
function adaptResolution(dt) {
  if (app.state !== 'playing' || document.hidden) { perf.sum = perf.n = 0; return; }
  perf.sum += dt;
  perf.n++;
  if (perf.sum < 2 || perf.n < 8) return;
  const fps = perf.n / perf.sum;
  perf.sum = perf.n = 0;
  const before = resScale;
  if (fps < 48 && resScale > 0.6) resScale = Math.max(0.6, resScale - (fps < 30 ? 0.2 : 0.1));
  else if (fps > 58 && resScale < 1) resScale = Math.min(1, resScale + 0.05);
  if (resScale !== before) { applyPixelRatio(); resize(); }
}

function resize() {
  if (!app.renderer) return;
  const w = window.innerWidth;
  const h = window.innerHeight;
  app.renderer.setSize(w, h, false);
  app.camera.aspect = w / h;
  app.camera.fov = w / h < 0.9 ? 62 : 46; // portrait phones need a wider view
  app.camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- flow
function startBout() {
  if (app.builtQuality !== settings.quality) applyQuality(); // changed while the arena was still loading
  const mode = settings.mode === 'training' ? 1 : 0;
  app.training = mode === 1;
  const roundSeconds = settings.mode === 'short' ? 45 : 0;
  app.core.init({ mode, level: settings.level, seed: (Date.now() % 100000) + 1, rounds: 0, roundSeconds });
  app.hud.setNames(NAMES[0], app.training ? 'ГРУША' : `${NAMES[1]} · ${['ЛЁГКИЙ', 'НОРМ', 'СЛОЖНЫЙ'][settings.level]}`);
  app.hud.resetTrail('p');
  app.hud.resetTrail('o');
  app.hud.hideResults();
  app.anim.player.outcome = app.anim.opponent.outcome = '';
  app.resultsShown = false;
  app.resultTimer = 0;
  app.lastPhase = '';
  app.intro = 3.2;
  resetStage();
  app.rigs.opponent.root.visible = !app.training;
  app.bag.group.visible = app.training;
  app.state = 'playing';
  app.input.enabled = true;
  $('#menu').hidden = true;
  $('#pause').hidden = true;
  app.hud.show(true);
  const useCamera = settings.control === 'camera' && typeof CameraInput !== 'undefined';
  $('#help').hidden = useCamera;
  $('#pad').hidden = useCamera || !('ontouchstart' in window || navigator.maxTouchPoints > 0);
  if (useCamera && !app.cameraInput) {
    app.cameraInput = new CameraInput();
    app.cameraInput.start().catch((err) => {
      console.error(err);
      app.cameraInput.stop();
      app.cameraInput = null;
      app.hud.banner('КАМЕРА НЕДОСТУПНА', String(err && err.message ? err.message : err).slice(0, 90) + ' — играю с клавиатуры', 4, 'warn');
    });
  } else if (!useCamera && app.cameraInput) {
    app.cameraInput.stop();
    app.cameraInput = null;
  }
}

// Pause freezes the whole simulation in any phase. The rules core also gets its own pause (so it resumes through the
// ready check and a countdown), applied at once with one tick; in phases where the core has no pause (waiting for the
// player) the freeze alone holds the bout.
const IDLE_INPUT = { status: 7, lean: 0, block: 0, punchMask: 0 };
function togglePause() {
  if (app.state === 'playing') {
    const phase = app.core.snapshot().match.phaseName;
    if (phase === 'MatchOver') return;
    app.core.pause();
    app.core.frame(1 / 100, IDLE_INPUT); // >= one 120 Hz tick: the core takes the request now
    const snap = app.core.snapshot();
    const ev = app.core.drainEvents();
    for (const e of ev.combat) onCombat(e, snap);
    for (const e of ev.match) onMatch(e, snap);
    app.state = 'paused';
    $('#pause').hidden = false;
  } else if (app.state === 'paused') {
    resumeBout();
  }
}

function resumeBout() {
  if (app.core.snapshot().match.phaseName === 'Paused') app.core.resume();
  app.state = 'playing';
  $('#pause').hidden = true;
}

// Losing focus (Alt+Tab, another window, minimised) pauses the bout instead of letting the bot hit a ghost.
function autoPause() {
  if (app.state !== 'playing' || app.frozen) return;
  togglePause();
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
}

function toMenu() {
  app.state = 'menu';
  $('#pause').hidden = true;
  app.hud.hideResults();
  app.hud.show(false);
  $('#help').hidden = true;
  $('#pad').hidden = true;
  $('#menu').hidden = false;
}

// ---------------------------------------------------------------- events
const slotKey = (slot) => (slot === 0 ? 'player' : 'opponent');

function onCombat(e, snap) {
  const actor = slotKey(e.actor);
  const target = slotKey(e.target);
  const playerActs = e.actor === 0;
  const type = e.typeName;
  if (type === 'AttackActive') {
    app.sound.whoosh(e.hand === 1 ? 1.1 : 0.85);
    return;
  }
  if (type === 'HitConfirmed') {
    const power = Math.min(1.6, e.damage / 2.2 + (e.counter ? 0.3 : 0));
    let at;
    if (target === 'opponent' && app.training) at = stagePoint(snap.opponent.position - 0.18, 1.45);
    else at = app.rigs[target].headWorld();
    const dir = stageDir().multiplyScalar(e.actor === 0 ? 1 : -1).setY(0.15).normalize();
    app.sparks.burst(at, dir, e.counter ? 'counter' : 'hit', 0.7 + 0.4 * power);
    app.sound.hit(0.7 + 0.3 * power, !!e.counter);
    if (app.training && target === 'opponent') app.bag.hit(power, e.hand === 0 ? 1 : -1);
    else app.anim[target].takeHit(e.hand, e.damage, !!e.counter);
    app.hitStop = e.counter ? 0.06 : 0.035;
    app.shake.add(target === 'player' ? 0.45 * power : 0.18 * power);
    if (target === 'player') app.hud.flash('hit');
    if (playerActs) {
      if (e.counter) app.hud.feed('КОНТРУДАР!', 'good');
      if (e.combo >= 2) app.hud.combo(e.combo);
    } else if (e.counter) app.hud.feed('ПОЙМАЛ НА ВСТРЕЧНОМ', 'bad');
    if (power > 1.1) app.sound.crowdSwell(0.6);
    return;
  }
  if (type === 'Blocked') {
    const rig = app.rigs[target];
    const at = app.training && target === 'opponent' ? stagePoint(snap.opponent.position - 0.18, 1.45)
      : rig.fistWorld('l').add(rig.fistWorld('r')).multiplyScalar(0.5);
    app.sparks.burst(at, stageDir().multiplyScalar(e.actor === 0 ? 1 : -1).setY(0.2).normalize(), 'block', 0.7);
    app.sound.block(0.9);
    if (!(app.training && target === 'opponent')) app.anim[target].takeBlocked(e.damage / 0.15);
    app.shake.add(target === 'player' ? 0.12 : 0.05);
    if (!playerActs) app.hud.feed('БЛОК', 'good');
    return;
  }
  if (type === 'GuardBroken') {
    app.hud.feed(playerActs ? 'ПРОБИЛ ЗАЩИТУ!' : 'ЗАЩИТА ПРОБИТА', playerActs ? 'good' : 'bad');
    return;
  }
  if (type === 'Dodged') {
    app.hud.feed(playerActs ? 'СОПЕРНИК УКЛОНИЛСЯ' : 'УКЛОН!', playerActs ? '' : 'good');
    return;
  }
  if (type === 'StaminaExhausted' && actor === 'player') {
    app.hud.feed('ВЫДОХСЯ — ПЕРЕВЕДИ ДУХ', 'warn');
    return;
  }
  if (type === 'KnockedDown') {
    app.sound.knockdown();
    app.shake.add(0.7);
    app.hud.banner('НОКДАУН', actor === 'player' ? 'держи блок, чтобы встать' : NAMES[1], 1.8, actor === 'player' ? 'bad' : 'good');
    return;
  }
  if (type === 'GotUp') {
    app.hud.resetTrail(actor === 'player' ? 'p' : 'o');
    app.hud.feed(actor === 'player' ? 'ТЫ НА НОГАХ' : 'СОПЕРНИК ВСТАЛ', actor === 'player' ? 'good' : 'warn');
    return;
  }
  if (type === 'KnockedOut') {
    app.sound.crowdSwell(2);
    app.hud.banner('НОКАУТ', '', 2.6, actor === 'player' ? 'bad' : 'good');
  }
}

function onMatch(e, snap) {
  const type = e.typeName;
  if (type === 'CountdownTick') {
    app.hud.banner(String(e.countdownSeconds), snap.match.round > 0 ? `РАУНД ${snap.match.round}` : '', 0.9);
    app.sound.count();
  } else if (type === 'RoundStarted') {
    app.sound.bell(1);
    app.hud.banner('БОКС!', '', 0.9, 'good');
  } else if (type === 'RoundEnded') {
    app.sound.bell(2);
    const m = snap.match;
    app.hud.banner('КОНЕЦ РАУНДА', `судьи: ${m.judge1Player}–${m.judge1Opponent} · ${m.judge2Player}–${m.judge2Opponent} · ${m.judge3Player}–${m.judge3Opponent}`, 3.0);
  } else if (type === 'KnockdownCount') {
    app.sound.count();
  } else if (type === 'MatchEnded') {
    app.sound.bell(3);
    const m = snap.match;
    app.anim.player.outcome = m.hasWinner ? (m.winner === 0 ? 'win' : 'lose') : '';
    app.anim.opponent.outcome = m.hasWinner ? (m.winner === 1 ? 'win' : 'lose') : '';
    app.resultTimer = 2.6;
  } else if (type === 'Paused' && e.reason === 2) {
    app.hud.banner('ТРЕКИНГ ПОТЕРЯН', 'встань в кадр', 2.0, 'warn');
  }
}

// ---------------------------------------------------------------- stage
// The rules core places both fighters on one line (metres, +X toward the opponent). On screen that line circles the
// ring: it turns slowly around the fighters' midpoint and its centre wanders over the canvas, so the robots work
// around each other with real footwork instead of sliding on a rail. Visual only: distance and reach stay the core's.
const stage = { theta: 0, omega: 0, cx: 0, cz: 0, t: 0 };
function resetStage() { Object.assign(stage, { theta: 0, omega: 0, cx: 0, cz: 0, t: 0 }); }
function stageDir() { return new THREE.Vector3(Math.cos(stage.theta), 0, -Math.sin(stage.theta)); }
function stageSide() { return new THREE.Vector3(Math.sin(stage.theta), 0, Math.cos(stage.theta)); }
function stagePoint(s, y = 0) { return new THREE.Vector3(stage.cx + Math.cos(stage.theta) * s, y, stage.cz - Math.sin(stage.theta) * s); }
function updateStage(dt, snap) {
  if (app.training) { resetStage(); return; }
  const fighting = snap.match.phaseName === 'Fighting';
  if (fighting) stage.t += dt;
  const t = stage.t;
  const busy = (f) => f.stateName === 'Attack' || f.stateName === 'HitStun' || f.blocking > 0.5;
  let w = fighting ? 0.42 * (0.65 * Math.sin(t * 0.23 + 0.4) + 0.35 * Math.sin(t * 0.61 + 2.1)) : 0;
  if (busy(snap.player) || busy(snap.opponent)) w *= 0.3; // plant to exchange, circle between exchanges
  stage.omega += (w - stage.omega) * Math.min(1, dt * 1.8);
  stage.theta += stage.omega * dt;
  // the centre drifts over the middle of the canvas (well inside the ropes: the ring is 6.1 m)
  const tx = fighting ? 0.75 * Math.sin(t * 0.093 + 1.0) : stage.cx;
  const tz = fighting ? 0.65 * Math.sin(t * 0.071 + 2.6) : stage.cz;
  const k = Math.min(1, dt * 0.8);
  stage.cx += (tx - stage.cx) * k;
  stage.cz += (tz - stage.cz) * k;
}
function placeFighters(snap) {
  const { player, opponent } = app.holders;
  player.face.position.copy(stagePoint(snap.player.position));
  opponent.face.position.copy(stagePoint(snap.opponent.position));
  player.face.rotation.y = stage.theta;
  opponent.face.rotation.y = stage.theta + Math.PI;
}

// ---------------------------------------------------------------- camera
function updateCamera(dt, snap) {
  const m = snap.match;
  const px = snap.player.position;
  const ox = snap.opponent.position;
  let pos;
  let look;
  if (app.intro > 0 && (m.phaseName === 'WaitingForPlayer' || m.phaseName === 'Countdown')) {
    app.intro -= dt;
    const a = 1 - Math.max(0, app.intro) / 3.2;
    const ang = -2.2 + 1.6 * a;
    pos = new THREE.Vector3(Math.cos(ang) * 4.2, 1.7 + 0.5 * (1 - a), -Math.sin(ang) * 4.2);
    look = new THREE.Vector3(0, 1.25, 0);
  } else if (m.phaseName === 'MatchOver') {
    const t = performance.now() / 1000;
    const w = stagePoint(m.hasWinner ? (m.winner === 0 ? px : ox) : (px + ox) / 2);
    pos = new THREE.Vector3(w.x + Math.cos(t * 0.25) * 3.4, 1.8, w.z + Math.sin(t * 0.25) * 3.4);
    look = new THREE.Vector3(w.x, 1.3, w.z);
  } else {
    // three-quarter broadcast view from behind the player's right side: both robots in full, feet included
    const downP = snap.player.stateName === 'KnockedDown' || snap.player.stateName === 'KnockedOut';
    const sway = 0.18 * Math.max(-1, Math.min(1, -snap.player.dodge || 0));
    const n = stageSide();
    const mid = (px + ox) / 2;
    pos = downP ? stagePoint(px - 0.4, 2.6).addScaledVector(n, 2.4) : stagePoint(px - 0.9, 1.8).addScaledVector(n, 3.25 - sway);
    look = stagePoint(mid + 0.1, 0.96).addScaledVector(n, -0.1 - sway * 0.3);
  }
  const k = 1 - Math.exp(-dt * (app.intro > 0 ? 6 : 4.5));
  app.camPos.lerp(pos, k);
  app.camLook.lerp(look, k);
  const s = app.shake.offset();
  app.camera.position.set(app.camPos.x + s.x, app.camPos.y + s.y, app.camPos.z + s.z);
  app.camera.lookAt(app.camLook);
  app.camera.rotateZ(s.roll);
  updateRingOcclusion(app.ring, app.camera.position, app.camLook, dt);
}

// ---------------------------------------------------------------- loop
function currentInput() {
  if (app.state !== 'playing') return { status: 7, lean: 0, block: 0, punchMask: 0 };
  return app.cameraInput && app.cameraInput.active ? app.cameraInput.poll() : app.input.poll();
}

// One simulation + animation step (no rendering).
function step(dt, input, now) {
  if (app.state === 'paused') return; // frozen frame behind the pause panel
  if (app.state !== 'menu') {
    app.core.frame(dt, input);
    const snap = app.core.snapshot();
    const ev = app.core.drainEvents();
    for (const e of ev.combat) onCombat(e, snap);
    for (const e of ev.match) onMatch(e, snap);
    const phase = snap.match.phaseName;
    if (phase !== app.lastPhase) {
      if (PHASE_LABEL[phase] && phase !== 'Paused') app.hud.banner(PHASE_LABEL[phase], app.training ? 'тренировка' : '', 1.2);
      app.lastPhase = phase;
    }
    if (app.resultTimer > 0) {
      app.resultTimer -= dt;
      if (app.resultTimer <= 0 && !app.resultsShown) {
        app.resultsShown = true;
        app.hud.results(snap, NAMES);
        app.state = 'results';
      }
    }
    // hit-stop: a few frames of frozen animation sell the impact (visual only; the rules keep running)
    let animDt = dt;
    if (app.hitStop > 0) {
      app.hitStop -= dt;
      animDt = dt * 0.15;
    }
    const gap = snap.match.gap;
    const ctx = { gap, phase };
    updateStage(dt, snap);
    placeFighters(snap);
    app.anim.player.update(animDt, snap.player, ctx);
    if (!app.training) app.anim.opponent.update(animDt, snap.opponent, ctx);
    app.holders.player.tilt.rotation.z = app.anim.player.fall * 1.2;
    app.holders.opponent.tilt.rotation.z = app.anim.opponent.fall * 1.2;
    app.bag.group.position.copy(stagePoint(snap.opponent.position + 0.1));
    app.bag.update(dt);
    app.sparks.update(dt);
    app.shake.update(dt);
    app.hud.update(snap, dt, app.training, settings.mode === 'short' ? 45 : 90);
    updateCamera(dt, snap);
  } else {
    // menu: slow orbit around the ring
    const t = now / 1000;
    app.camera.position.set(Math.cos(t * 0.08) * 6.5, 2.4, Math.sin(t * 0.08) * 6.5);
    app.camera.lookAt(0, 1.0, 0);
    updateRingOcclusion(app.ring, app.camera.position, { x: 0, y: 1, z: 0 }, dt);
    app.anim.player.update(dt, IDLE, { gap: 1.35, phase: 'Menu' });
    app.anim.opponent.update(dt, IDLE, { gap: 1.35, phase: 'Menu' });
    resetStage();
    placeFighters({ player: { position: -0.675 }, opponent: { position: 0.675 } });
  }
}

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const raw = (now - last) / 1000;
  const dt = Math.min(0.1, raw);
  last = now;
  if (!app.loaded || app.frozen) return;
  if (raw < 0.5) adaptResolution(raw); // real frame time (not the clamped step); skip stalls such as a tab switch
  step(dt, currentInput(), now);
  app.renderer.render(app.scene, app.camera);
}

// Test hook: advance `seconds` in fixed 1/60 s steps with a given input (function of the step index), then render.
app.debugAdvance = (seconds, inputFn = () => ({ status: 7, lean: 0, block: 0, punchMask: 0 })) => {
  app.frozen = true;
  const n = Math.max(1, Math.round(seconds * 60));
  for (let i = 0; i < n; i++) step(1 / 60, inputFn(i), performance.now());
  if (app.debugCamera) app.debugCamera(app.camera, stagePoint, stageSide());
  app.renderer.render(app.scene, app.camera);
  const s = app.core.snapshot();
  return { phase: s.match.phaseName, p: s.player.stateName + '/' + s.player.stageName, o: s.opponent.stateName + '/' + s.opponent.stageName,
    ph: s.player.health, oh: s.opponent.health, round: s.match.round, gap: s.match.gap, theta: +stage.theta.toFixed(3),
    steps: [app.anim.player.steps, app.anim.opponent.steps] };
};

const IDLE = { stateName: 'Guard', stageName: 'None', blocking: 0, dodge: 0, lean: 0, gassedTicksLeft: 0, stamina: 100, maxStamina: 100, hand: 0, stageAlpha: 0 };

// ---------------------------------------------------------------- menu wiring
function wireMenu() {
  const pick = (group, key, cast = (v) => v) => {
    for (const b of document.querySelectorAll(`[data-group="${group}"] button`)) {
      b.classList.toggle('sel', String(settings[key]) === b.dataset.value);
      b.addEventListener('click', () => {
        settings[key] = cast(b.dataset.value);
        saveSettings();
        for (const o of document.querySelectorAll(`[data-group="${group}"] button`)) o.classList.toggle('sel', o === b);
        app.sound.ui();
      });
    }
  };
  pick('level', 'level', Number);
  pick('mode', 'mode');
  pick('quality', 'quality');
  for (const b of document.querySelectorAll('[data-group="quality"] button')) b.addEventListener('click', applyQuality);
  pick('control', 'control');
  $('#start').addEventListener('click', async () => {
    if ($('#start').disabled) return;
    app.sound.start();
    if (!app.loaded) {
      $('#start').disabled = true;
      $('#menu').hidden = true;
      $('#loading').hidden = false;
      try {
        await ensureWorld();
      } catch (err) {
        console.error(err);
        $('#start').disabled = false;
        $('#loading').hidden = true;
        $('#menu').hidden = false;
        const note = $('#menu-load');
        note.hidden = false;
        note.textContent = `Не удалось запустить: ${err.message}`;
        return;
      }
      $('#start').disabled = false;
      $('#loading').hidden = true;
    }
    startBout();
  });
  $('#resume').addEventListener('click', resumeBout);
  $('#restart').addEventListener('click', startBout);
  $('#to-menu').addEventListener('click', toMenu);
  $('#rematch').addEventListener('click', startBout);
  $('#res-menu').addEventListener('click', toMenu);
  $('#sound').addEventListener('click', () => {
    app.sound.setEnabled(!app.sound.enabled);
    $('#sound').textContent = app.sound.enabled ? 'Звук: вкл' : 'Звук: выкл';
  });
  $('#pause-btn').addEventListener('click', togglePause);
  for (const b of document.querySelectorAll('.fs-toggle')) b.addEventListener('click', toggleFullscreen);
  document.addEventListener('visibilitychange', () => { if (document.hidden) autoPause(); });
  window.addEventListener('blur', autoPause);
  // Enter: into the ring from the menu, rematch from the results; Esc on the results: back to the menu.
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    const visible = (id) => !$(id).hidden;
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      if (visible('#menu') && !$('#start').disabled) { e.preventDefault(); $('#start').click(); }
      else if (app.state === 'results' && visible('#results')) { e.preventDefault(); startBout(); }
    } else if (e.code === 'Escape' && app.state === 'results' && visible('#results')) {
      e.preventDefault();
      toMenu();
    }
  });
}

// claude.ai artifact: offer the self-contained webcam build (published next to the page) through `downloads`.
async function offerCameraDownload() {
  if (typeof CameraInput !== 'undefined') return; // this is already the camera build
  const host = globalThis.claude;
  if (!host || typeof host.use !== 'function') return;
  let downloads = null;
  try {
    downloads = await host.use('downloads');
  } catch {
    downloads = null;
  }
  if (!downloads) return;
  $('#cam-offer').hidden = false;
  $('#cam-dl').addEventListener('click', async () => {
    const note = $('#cam-dl-note');
    try {
      $('#cam-dl').disabled = true;
      const res = await fetch('IronEcho-Camera.html');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      await downloads.save({ filename: 'IronEcho-Camera.html', data: blob });
      note.textContent = 'Сохранено. Открой файл двойным щелчком (Chrome/Edge), разреши камеру, встань в 2–3 м от экрана.';
    } catch (err) {
      const code = err && err.code;
      note.textContent = code === 'declined' ? 'Скачивание отменено.'
        : code === 'extension_not_enabled' || code === 'rejected_extension' ? 'Здесь нельзя сохранить HTML-файл.'
          : `Не получилось: ${(err && err.message) || err}`;
    } finally {
      $('#cam-dl').disabled = false;
    }
  });
}

wireMenu();
offerCameraDownload();
ensureWorld().catch((err) => {
  console.error(err);
  const note = $('#menu-load');
  note.hidden = false;
  note.textContent = `Не удалось загрузить арену: ${err.message}`;
});
requestAnimationFrame(frame);
globalThis.IRONECHO_APP = app; // for tests and the camera module
// Windows app (Tools/Build/Desktop): its local server keeps running while the page is open.
if (location.hostname === '127.0.0.1') setInterval(() => { fetch('/__ironecho').catch(() => {}); }, 3000);
