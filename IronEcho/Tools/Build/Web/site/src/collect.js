// Collection Mode (?collect=1): a guided recording that turns a person in front of a real camera into labelled data. The game asks for one
// strike at a time ("Хук левой — ДАВАЙ!"), notes the moment it asked, and records the skeleton (numbers only: no picture, no sound).
// Tools/Eval/eval_camera.mjs then replays the file through the same strike detectors and counts what was caught, missed or mistaken.
// Three conditions: A good light at 2 m, B dim light, C 3 m and off-centre; one file per condition (each starts with the usual camera set-up,
// so every file carries its own calibration).
//
// CollectRunner is the timing logic only (no page, testable in node); CollectMode is the page around it.

export const COLLECT_FORMAT = 1;
export const COLLECT_CONDITIONS = [
  { id: 'A', title: 'Хороший свет, 2 метра', how: 'Свет спереди или сбоку (лампа, окно сбоку). Встань в 2 метрах от камеры, по центру.' },
  { id: 'B', title: 'Тусклый свет, 2 метра', how: 'Выключи верхний свет, оставь только экран или настольную лампу сбоку. То же место.' },
  { id: 'C', title: '3 метра и чуть сбоку', how: 'Отойди на 3 метра и на полметра в сторону от центра кадра. Свет обычный.' },
];

const COLLECT_SIDE = { L: 'левой', R: 'правой' };
const COLLECT_DIR = { L: 'влево', R: 'вправо' };
// what each kind of cue asks for (text) and how long it lasts; strike cues: the evaluator looks for the detection in [t-0.2, t+1.4]
export function collectText(c) {
  const s = COLLECT_SIDE[c.side] || '';
  switch (c.kind) {
    case 'straight': return c.target === 'body' ? `Прямой ${s} в корпус` : `Прямой ${s} в голову`;
    case 'hook': return c.target === 'body' ? `Хук ${s} в корпус` : `Хук ${s}`;
    case 'upper': return `Апперкот ${s}`;
    case 'elbow': return `Локоть ${s}`;
    case 'knee': return `Колено ${s === 'левой' ? 'левое' : 'правое'}`;
    case 'kick': return c.target === 'low' ? `Ногой ${s} по ногам` : `Ногой ${s} в корпус`;
    case 'duck': return 'Нырок';
    case 'block': return 'Блок — держи';
    case 'slip': return `Уклон ${COLLECT_DIR[c.side]}`;
    case 'lean': return 'Наклон к экрану';
    case 'idle': return 'Просто стой: переминайся, качайся, дыши';
    case 'confound': return 'Почеши нос, поправь волосы, потянись';
    default: return c.kind;
  }
}

// The protocol for one condition (~130 cues, ~8 minutes). Sides alternate at random inside a block; body/low targets are spread through it.
export function collectCues(rand, { legs = true } = {}) {
  const blocks = [];
  const sides = (n) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push(i % 2 ? 'R' : 'L');
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  };
  const block = (name, list) => blocks.push({ name, cues: list.map((c) => ({ ...c, block: name })) });
  block('stance', [{ kind: 'idle', hold: 6 }]);
  block('block', Array.from({ length: 5 }, () => ({ kind: 'block', hold: 2 })));
  block('slip', sides(10).map((side) => ({ kind: 'slip', side, hold: 1 })));
  block('duck', Array.from({ length: 8 }, () => ({ kind: 'duck', hold: 0.8 })));
  block('lean', Array.from({ length: 4 }, () => ({ kind: 'lean', hold: 1.2 })));
  block('straight', sides(30).map((side, i) => ({ kind: 'straight', side, target: i % 3 === 2 ? 'body' : 'head' })));
  block('hook', sides(16).map((side, i) => ({ kind: 'hook', side, target: i % 4 === 3 ? 'body' : 'head' })));
  block('upper', sides(16).map((side) => ({ kind: 'upper', side })));
  block('elbow', sides(12).map((side) => ({ kind: 'elbow', side })));
  if (legs) {
    block('knee', sides(12).map((side) => ({ kind: 'knee', side })));
    block('kick', sides(16).map((side, i) => ({ kind: 'kick', side, target: i % 2 ? 'low' : 'mid' })));
  }
  block('idle', [{ kind: 'idle', hold: 45 }]);
  block('confound', [{ kind: 'confound', hold: 20 }]);
  return blocks.flatMap((b) => b.cues);
}

const COLLECT_STRIKES = new Set(['straight', 'hook', 'upper', 'elbow', 'knee', 'kick']);
export const collectIsStrike = (kind) => COLLECT_STRIKES.has(kind);

export class CollectRunner {
  // cues: from collectCues; opts: { rand, prep, window, restMin, restMax }
  constructor(cues, opts = {}) {
    this.queue = cues.map((c) => ({ ...c }));
    this.done = [];
    this.rand = opts.rand || Math.random;
    this.prep = opts.prep ?? 0.9;       // s the instruction is shown before "ДАВАЙ"
    this.window = opts.window ?? 1.4;   // s given to a strike
    this.restMin = opts.restMin ?? 1.4;
    this.restMax = opts.restMax ?? 2.0;
    this.phase = 'idle';                // idle | prep | go | rest | paused | finished
    this.cue = null;
    this.until = 0;
    this.pausedPhase = null;
    this.requeued = new Set();
  }

  get total() { return this.done.length + this.queue.length + (this.cue ? 1 : 0); }
  get finished() { return this.phase === 'finished'; }

  // t: the camera's clock (seconds); visible: the player is tracked right now
  tick(t, visible = true) {
    if (this.phase === 'paused' || this.phase === 'finished') return this.view();
    if (this.phase === 'idle' || (this.phase === 'rest' && t >= this.until)) {
      this.cue = this.queue.shift() || null;
      if (!this.cue) { this.phase = 'finished'; return this.view(); }
      this.phase = 'prep';
      this.until = t + this.prep;
    } else if (this.phase === 'prep' && t >= this.until) {
      this.phase = 'go';
      this.cue.t = t;
      this.cue.dur = collectIsStrike(this.cue.kind) ? this.window : (this.cue.hold || 1) + 0.4;
      this.cue.status = visible ? 'ok' : 'invisible';
      this.until = t + this.cue.dur;
    } else if (this.phase === 'go' && t >= this.until) {
      const c = this.cue;
      this.done.push(c);
      if (c.status === 'invisible' && !this.requeued.has(c)) { this.requeued.add(c); this.queue.push({ ...c, t: undefined, status: undefined }); }
      this.cue = null;
      this.phase = 'rest';
      const long = !collectIsStrike(c.kind) && (c.hold || 0) > 5;
      this.until = t + (long ? 1.5 : this.restMin + (this.restMax - this.restMin) * this.rand());
    }
    return this.view();
  }

  // the last cue went wrong: mark it and ask again right away
  redo() {
    if (this.cue && this.phase === 'go') { // the cue being performed now: end it here and ask again
      const c = this.cue;
      c.status = 'redo';
      this.done.push(c);
      this.queue.unshift({ ...c, t: undefined, status: undefined, dur: undefined });
      this.cue = null;
      this.phase = 'rest';
      this.until = 0;
      return;
    }
    const last = this.done[this.done.length - 1];
    if (!last || last.status === 'redo' || last.status === 'skipped') return;
    last.status = 'redo';
    this.queue.unshift({ ...last, t: undefined, status: undefined, dur: undefined });
  }

  // skip the rest of the current block (e.g. kicks with no room to kick)
  skipBlock() {
    const name = (this.cue || this.queue[0] || {}).block;
    if (!name) return;
    if (this.cue) { this.cue.status = 'skipped'; this.done.push(this.cue); this.cue = null; }
    while (this.queue.length && this.queue[0].block === name) this.done.push({ ...this.queue.shift(), status: 'skipped' });
    this.phase = 'rest';
    this.until = 0;
  }

  pause() { if (this.phase !== 'paused' && this.phase !== 'finished') { this.pausedPhase = this.phase; this.phase = 'paused'; } }
  resume(t) {
    if (this.phase !== 'paused') return;
    // a cue interrupted by the pause is asked again
    if (this.cue && this.pausedPhase === 'go') { this.cue.status = 'redo'; this.done.push(this.cue); this.queue.unshift({ ...this.cue, t: undefined, status: undefined }); }
    else if (this.cue) this.queue.unshift(this.cue);
    this.cue = null;
    this.phase = 'rest';
    this.until = t + 1.5;
  }

  view() {
    const c = this.cue;
    return { phase: this.phase, text: c ? collectText(c) : '', cue: c, index: this.done.length + 1, total: this.total, block: c ? c.block : '' };
  }

  // what goes into the file: every cue asked, with its time and outcome
  results() { return this.done.filter((c) => c.t !== undefined || c.status === 'skipped').map((c) => ({ kind: c.kind, side: c.side || '', target: c.target || '',
    block: c.block, t: c.t ?? null, dur: c.dur ?? 0, hold: c.hold || 0, status: c.status || 'ok' })); }
}

// The session file (one condition): frames and decisions from TraceRecorder.endSession(), cue times moved to the file's clock.
export function collectBuildFile({ version = '', consentAt = '', participant = {}, session, cues, condition, device = {}, calibration = null }) {
  const t0 = session.t0;
  return {
    format: 'ironecho-session', formatVersion: COLLECT_FORMAT, game: version, savedAt: new Date().toISOString(),
    consent: { at: consentAt, version: 1 }, participant, device,
    condition: { ...condition, start: 0, end: session.seconds },
    calibration,
    frames: session.frames,
    cues: cues.map((q) => ({ ...q, t: q.t === null || q.t === undefined ? null : Math.round((q.t - t0) * 1000) / 1000 })),
    gameEvents: session.decisions,
  };
}

// The file as text, built in pieces (one frame per string), so a 10-minute recording never becomes one giant JSON.stringify call.
export function collectJson(data) {
  const { frames = [], ...head } = data;
  const parts = [JSON.stringify(head).slice(0, -1), ',"frames":['];
  frames.forEach((f, i) => parts.push((i ? ',' : '') + JSON.stringify(f)));
  parts.push(']}');
  return parts.join('');
}

// ------------------------------------------------------------------------------------------------ the page
// Gets its CameraInput (pose.js) from makeCamera() after the consent (the browser asks for the camera only then); records with the
// camera's TraceRecorder in session mode.
export class CollectMode {
  constructor({ makeCamera, stage, version, onEvent = () => {}, seed = Date.now() }) {
    this.makeCamera = makeCamera;
    this.camera = null;
    this.version = version || '';
    this.onEvent = onEvent;
    let s = seed >>> 0 || 1;
    this.rand = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
    this.participant = { id: `p_${Math.floor(this.rand() * 0xffffff).toString(16).padStart(6, '0')}` };
    this.condIndex = 0;
    this.runner = null;
    this.speech = true;
    this.files = [];
    this._ui(stage);
  }

  _ui(stage) {
    const el = document.createElement('div');
    el.id = 'collect';
    el.innerHTML = `<div class="cl-card"><b class="cl-title"></b><div class="cl-body"></div><div class="cl-btns"></div></div>
      <div class="cl-cue" hidden><div class="cl-count"></div><div class="cl-text"></div><div class="cl-bar"><i></i></div>
      <div class="cl-ctl"><button type="button" data-a="redo">Повторить</button><button type="button" data-a="skip">Пропустить блок</button><button type="button" data-a="pause">Пауза</button><button type="button" data-a="voice">Голос: вкл</button></div></div>`;
    const style = document.createElement('style');
    style.textContent = `#collect{position:absolute;inset:0;z-index:30;display:grid;place-items:center;pointer-events:none;font:500 15px/1.45 Inter,system-ui,sans-serif;color:#e8ecf2}
      #collect .cl-card{pointer-events:auto;width:min(92vw,620px);background:rgba(10,11,14,.95);border:1px solid rgba(255,255,255,.14);border-radius:10px;padding:20px 22px}
      #collect .cl-title{display:block;font:800 28px/1.1 "Barlow Condensed",Arial Narrow,sans-serif;letter-spacing:.04em;margin-bottom:10px}
      #collect .cl-body p{margin:6px 0}#collect .cl-body label{display:block;margin:6px 0}#collect .cl-body select{margin-left:6px}
      #collect .cl-btns{display:flex;gap:10px;flex-wrap:wrap;margin-top:14px}
      #collect button{background:#1d2530;color:#e8ecf2;border:1px solid rgba(255,255,255,.18);border-radius:6px;padding:9px 16px;font:700 14px Inter,system-ui,sans-serif;cursor:pointer}
      #collect button.primary{background:#3f7dff;border-color:#3f7dff}
      #collect .cl-cue{pointer-events:auto;position:absolute;left:50%;top:44%;transform:translate(-50%,-50%);text-align:center;width:min(94vw,820px)}
      #collect .cl-text{font:800 clamp(40px,7vw,86px)/1.05 "Barlow Condensed",Arial Narrow,sans-serif;letter-spacing:.03em;text-shadow:0 2px 14px #000}
      #collect .cl-text.go{color:#c8f06a}#collect .cl-count{font:700 15px Inter,system-ui,sans-serif;color:#9aa3ae;margin-bottom:8px}
      #collect .cl-bar{height:6px;margin:16px auto 12px;width:60%;background:rgba(255,255,255,.1);border-radius:3px;overflow:hidden}#collect .cl-bar i{display:block;height:100%;width:0;background:#3f7dff}
      #collect .cl-ctl{display:flex;gap:8px;justify-content:center;flex-wrap:wrap}`;
    document.head.appendChild(style);
    stage.appendChild(el);
    this.el = el;
    this.card = el.querySelector('.cl-card');
    this.cueEl = el.querySelector('.cl-cue');
    this.cueEl.addEventListener('click', (e) => {
      const a = e.target && e.target.dataset ? e.target.dataset.a : '';
      if (!this.camera) return;
      const t = this.camera.lastT;
      if (a === 'redo' && this.runner) this.runner.redo();
      if (a === 'skip' && this.runner) this.runner.skipBlock();
      if (a === 'pause' && this.runner) {
        if (this.runner.phase === 'paused') { this.runner.resume(t); e.target.textContent = 'Пауза'; } else { this.runner.pause(); e.target.textContent = 'Продолжить'; }
      }
      if (a === 'voice') { this.speech = !this.speech; e.target.textContent = this.speech ? 'Голос: вкл' : 'Голос: выкл'; }
    });
  }

  _card(title, html, buttons) {
    this.cueEl.hidden = true;
    this.card.hidden = false;
    this.card.querySelector('.cl-title').textContent = title;
    this.card.querySelector('.cl-body').innerHTML = html;
    const box = this.card.querySelector('.cl-btns');
    box.innerHTML = '';
    for (const [label, fn, primary] of buttons) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      if (primary) b.className = 'primary';
      b.addEventListener('click', fn);
      box.appendChild(b);
    }
  }

  _say(text) {
    if (!this.speech || !globalThis.speechSynthesis) return;
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'ru-RU';
      u.rate = 1.15;
      speechSynthesis.speak(u);
    } catch { /* no voice: the text is enough */ }
  }

  // consent → short form → conditions
  start() {
    this.onEvent('collect', { step: 'open' });
    this._card('Помоги улучшить камеру', `<p>Игра попросит тебя сделать удары по одному: «Хук левой — ДАВАЙ!». Это около 8 минут на одно условие, всего условий три.</p>
      <p><b>Что записывается:</b> только числа — положения 33 точек тела (плечи, локти, кисти…) и время. <b>Не записываются</b> видео, фото, звук, лицо, имя.</p>
      <p>Файл сохранится у тебя на компьютере. Ты сам решаешь, отправлять его или нет, и можешь удалить его в любой момент.</p>
      <p>Освободи место вокруг, бей в воздух не в полную силу и остановись, если что-то болит.</p>`,
    [['Согласен, начать', () => this._form(), true], ['Назад в игру', () => { location.search = ''; }]]);
  }

  _form() {
    const sel = (name, opts) => `<select name="${name}">${opts.map(([v, l]) => `<option value="${v}">${l}</option>`).join('')}</select>`;
    this._card('Пара вопросов (необязательно)', `<label>Рост: ${sel('height', [['', '—'], ['<160', 'до 160'], ['160-175', '160–175'], ['175-190', '175–190'], ['>190', 'больше 190']])}</label>
      <label>Телосложение: ${sel('build', [['', '—'], ['slim', 'худощавое'], ['medium', 'среднее'], ['broad', 'крупное']])}</label>
      <label>Очки: ${sel('glasses', [['', '—'], ['no', 'нет'], ['yes', 'да']])}</label>
      <label>Одежда: ${sel('clothing', [['', '—'], ['fitted', 'облегающая'], ['loose', 'свободная, рукава']])}</label>
      <label>Опыт бокса: ${sel('experience', [['', '—'], ['none', 'нет'], ['hobby', 'немного'], ['trained', 'тренируюсь']])}</label>
      <label>Ведущая рука: ${sel('hand', [['', '—'], ['right', 'правая'], ['left', 'левая']])}</label>`,
    [['Дальше', () => {
      for (const s of this.card.querySelectorAll('select')) if (s.value) this.participant[s.name] = s.value;
      this.consentAt = new Date().toISOString();
      this._card('Включаю камеру…', '<p>Разреши доступ к камере. Видео остаётся на твоём устройстве.</p>', []);
      this.makeCamera().then((cam) => { this.camera = cam; this._conditionIntro(); }).catch((err) => {
        this.onEvent('collect', { step: 'camera_fail' });
        this._card('Камера недоступна', `<p>${String(err && err.message ? err.message : err).slice(0, 160)}</p><p>Проверь, что камера не занята другой программой, и разреши доступ.</p>`,
          [['Попробовать снова', () => this._form(), true], ['Назад в игру', () => { location.search = ''; }]]);
      });
    }, true]]);
  }

  _conditionIntro() {
    const c = COLLECT_CONDITIONS[this.condIndex];
    const done = this.files.length ? `<p>Готово условий: ${this.files.length} из 3. Файлы уже сохранены.</p>` : '';
    this._card(`Условие ${c.id} из 3: ${c.title}`, `${done}<p>${c.how}</p><p>Сначала обычная настройка камеры (стойка, блок, уклоны, удары) — потом подсказки по одному удару.</p>`,
      [[`Начать условие ${c.id}`, () => this._beginCondition(), true], ...(this.files.length ? [['Закончить', () => this._finish()]] : [])]);
  }

  _beginCondition() {
    const cam = this.camera;
    this.card.hidden = true;
    const c = COLLECT_CONDITIONS[this.condIndex];
    this.onEvent('collect', { step: 'condition', id: c.id });
    // a fresh calibration for every condition (the player may have moved); the file starts with it
    cam.recalibrate();
    cam.rec.beginSession();
    this.condStart = cam.lastT;
    this.waitingCal = true;
    this.runner = null;
    const loop = () => {
      if (!this.waitingCal && !this.runner) return;
      requestAnimationFrame(loop);
      this._step();
    };
    requestAnimationFrame(loop);
  }

  _step() {
    const cam = this.camera;
    const t = cam.lastT;
    cam.poll(); // what the live detectors decide goes into the file next to the cues (the game is not running a bout here)
    if (this.waitingCal) {
      if (!cam.proc.cal) return;
      this.waitingCal = false;
      const legs = (cam.proc.cal.kneesSeen ?? 1) >= 0.5;
      this.runner = new CollectRunner(collectCues(this.rand, { legs }), { rand: this.rand });
      this.cueEl.hidden = false;
      this.lastPhase = '';
    }
    const r = this.runner;
    const v = r.tick(t, cam.proc.status === 7);
    const text = this.cueEl.querySelector('.cl-text');
    if (v.phase !== this.lastPhase) {
      if (v.phase === 'prep') { text.textContent = v.text; text.className = 'cl-text'; this._say(v.text); }
      if (v.phase === 'go') { text.textContent = collectIsStrike(v.cue.kind) ? 'ДАВАЙ!' : `${v.text}!`; text.className = 'cl-text go'; }
      if (v.phase === 'rest') { text.textContent = '…'; text.className = 'cl-text'; }
      this.lastPhase = v.phase;
    }
    this.cueEl.querySelector('.cl-count').textContent = `Условие ${COLLECT_CONDITIONS[this.condIndex].id} · ${Math.min(v.index, v.total)} из ${v.total}${cam.proc.status === 7 ? '' : ' · тебя не видно!'}`;
    this.cueEl.querySelector('.cl-bar i').style.width = `${Math.round((100 * (v.index - 1)) / Math.max(1, v.total))}%`;
    if (r.finished) {
      const cues = r.results();
      this.runner = null;
      this._saveCondition(cues);
    }
  }

  // one file per condition: the frames since its calibration began, the cues, what the live detectors said
  async _saveCondition(cues) {
    const cam = this.camera;
    const c = COLLECT_CONDITIONS[this.condIndex];
    const session = cam.rec.endSession();
    const data = this.buildFile(session, c, cues);
    const name = `ironecho-session-${this.participant.id}-${c.id}.json.gz`;
    const bytes = await this._download(data, name);
    this.files.push({ name, bytes });
    this.onEvent('collect', { step: 'saved', id: c.id, cues: data.cues.length, kb: Math.round(bytes / 1024) });
    this.condIndex += 1;
    if (this.condIndex >= COLLECT_CONDITIONS.length) this._finish();
    else this._conditionIntro();
  }

  buildFile(session, cond, cues) {
    const cam = this.camera;
    const track = cam.video && cam.video.srcObject && cam.video.srcObject.getVideoTracks ? cam.video.srcObject.getVideoTracks()[0] : null;
    return collectBuildFile({
      version: this.version, consentAt: this.consentAt, participant: this.participant, session, cues,
      condition: { id: cond.id, title: cond.title, light: cam.light },
      device: { ua: typeof teleUaClass === 'function' ? teleUaClass() : '', camera: track && track.getSettings ? track.getSettings() : null,
        video: cam.video ? [cam.video.videoWidth, cam.video.videoHeight] : null, detector: cam.detector ? `${cam.detector.mode}/${cam.detector.delegate}` : '',
        model: cam.model, fps: Math.round(cam.fps || 0), inferMs: Math.round(cam.inferMs || 0) },
      calibration: cam.proc.cal ? { punchLimits: cam.proc.cal.punchLimits, kneesSeen: cam.proc.cal.kneesSeen, anklesSeen: cam.proc.cal.anklesSeen } : null,
    });
  }

  async _download(data, name) {
    // built in pieces: one frame per string, so a 10-minute file never becomes one giant string
    const jsonText = collectJson(data);
    let blob = new Blob([jsonText], { type: 'application/json' });
    let file = name;
    try { blob = await new Response(new Blob([jsonText]).stream().pipeThrough(new CompressionStream('gzip'))).blob(); } catch { file = name.replace(/\.gz$/, ''); }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = file;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 20000);
    return blob.size;
  }

  _finish() {
    this.onEvent('collect', { step: 'finish', files: this.files.length });
    const list = this.files.map((f) => `<li>${f.name} · ${Math.round(f.bytes / 1024)} КБ</li>`).join('');
    this._card('Спасибо!', `<p>Сохранено файлов: ${this.files.length}.</p><ul>${list}</ul><p>Они лежат в папке «Загрузки». Пришли их разработчику — по ним настраивается распознавание ударов.</p>`,
      [['В игру', () => { location.search = ''; }, true]]);
  }
}
