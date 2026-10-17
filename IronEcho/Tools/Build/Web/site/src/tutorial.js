// First-visit tutorial and the one tip on the results screen. The tutorial runs in training mode (the heavy bag) and
// checks each step against what the rules core really did (combat events and the player's snapshot), so it works the
// same with keys, touch or the camera; only the hint text differs. After the last step the page starts a short Easy bout.

const TUT_KIND = { straight: 0, hook: 4 };

// control: 'keys' | 'touch' | 'camera'; a step without text for a control is skipped for it (touch has no footwork)
export const TUTORIAL_STEPS = [
  { id: 'jab', title: 'ДЖЕБ', need: 2, keys: 'Нажми J', touch: 'Жми ДЖЕБ', camera: 'Резко выпрями левую руку к экрану',
    hint: 'Быстрый прямой левой: дальний и дешёвый по силам.',
    event: (e) => e.typeName === 'AttackStarted' && e.kind === TUT_KIND.straight && e.hand === 0 },
  { id: 'cross', title: 'КРОСС', need: 2, keys: 'Нажми K', touch: 'Жми КРОСС', camera: 'Выпрями правую руку к экрану',
    hint: 'Прямой правой: сильнее джеба, но дольше возвращается.',
    event: (e) => e.typeName === 'AttackStarted' && e.kind === TUT_KIND.straight && e.hand === 1 },
  { id: 'block', title: 'БЛОК', hold: 0.45, keys: 'Держи Пробел', touch: 'Держи БЛОК', camera: 'Подними оба кулака к лицу и держи',
    hint: 'Блок гасит прямые и хуки, но тратит дыхание.',
    event: (e) => e.typeName === 'BlockStarted', snap: (p) => p.blocking > 0.5 },
  { id: 'slip', title: 'УКЛОН', need: 2, keys: 'Нажми Q или E', touch: 'Жми ◀ или ▶', camera: 'Наклонись вбок, не сходя с места',
    hint: 'Уходи в последний миг, когда визор соперника вспыхнул.',
    event: (e) => e.typeName === 'DodgeStarted' },
  { id: 'hook', title: 'ХУК', need: 1, keys: 'Нажми U', touch: 'Жми ХУК', camera: 'Боковой удар левой: локоть в сторону, кулак по дуге',
    hint: 'Хук догоняет уклон. Вблизи — сильнейший удар.',
    event: (e) => e.typeName === 'AttackStarted' && e.kind === TUT_KIND.hook },
  { id: 'step', title: 'ШАГ', distance: 0.25, keys: 'W — вперёд, S — назад', camera: 'Наклонись к экрану — робот шагнёт вперёд',
    hint: 'Издалека удар не достаёт, вплотную — вязнет. Держи дистанцию ногами.' },
];

export const TUTORIAL_KEY = 'ironecho.tutorial'; // 'done' | 'skipped'

export class Tutorial {
  // root: the element to draw into (null in tests); onDone/onSkip: called once; onStep(i): a step was passed
  constructor({ control = 'keys', root = null, onDone = () => {}, onSkip = () => {}, onStep = () => {}, slot = 0 } = {}) {
    this.control = control;
    this.steps = TUTORIAL_STEPS.filter((s) => s[control]);
    this.slot = slot;
    this.index = 0;
    this.count = 0;
    this.held = 0;
    this.from = null;
    this.stepTime = 0;
    this.time = 0;
    this.finished = false;
    this.outcome = '';
    this.onDone = onDone;
    this.onSkip = onSkip;
    this.onStep = onStep;
    this.el = root ? this._ui(root) : null;
    this._render();
  }

  get step() { return this.steps[this.index] || null; }

  // core combat events (main.js passes every one of them)
  onCombat(e) {
    const s = this.step;
    if (this.finished || !s || !s.event || e.actor !== this.slot) return;
    if (!s.event(e)) return;
    if (s.hold) { this._pass(); return; }
    this.count++;
    this._render();
    if (this.count >= (s.need || 1)) this._pass();
  }

  // every simulation step while the training phase runs
  update(dt, snap) {
    if (this.finished) return;
    this.time += dt;
    this.stepTime += dt;
    const s = this.step;
    if (!s) return;
    const p = this.slot === 1 ? snap.opponent : snap.player;
    if (s.snap) {
      this.held = s.snap(p) ? this.held + dt : 0;
      if (this.held >= s.hold) { this._pass(); return; }
    }
    if (s.distance) {
      if (!this.from) this.from = { x: p.x, y: p.y };
      if (Math.hypot(p.x - this.from.x, p.y - this.from.y) >= s.distance) { this._pass(); return; }
    }
    if (this.el) this.el.next.hidden = this.stepTime < 12; // a step that will not register (camera) must not lock the player in
  }

  // "Дальше": move on without the step
  next() { if (!this.finished) this._pass(true); }

  skip() {
    if (this.finished) return;
    this.finished = true;
    this.outcome = 'skipped';
    this._render();
    this.onSkip(this.index);
  }

  destroy() { if (this.el) this.el.root.remove(); this.el = null; }

  _pass(forced = false) {
    this.onStep(this.index, forced);
    this.index++;
    this.count = 0;
    this.held = 0;
    this.from = null;
    this.stepTime = 0;
    if (this.index >= this.steps.length) {
      this.finished = true;
      this.outcome = 'done';
      this._render();
      this.onDone();
      return;
    }
    this._render();
  }

  _ui(root) {
    const box = document.createElement('div');
    box.id = 'tut';
    box.innerHTML = '<span class="tut-n"></span><b class="tut-t"></b><div class="tut-do"></div><small class="tut-h"></small>'
      + '<div class="tut-dots"></div><div class="tut-btns"><button type="button" class="linkish tut-next" hidden>Дальше</button>'
      + '<button type="button" class="linkish tut-skip">Пропустить обучение</button></div>';
    root.appendChild(box);
    const el = { root: box, n: box.querySelector('.tut-n'), t: box.querySelector('.tut-t'), do: box.querySelector('.tut-do'),
      h: box.querySelector('.tut-h'), dots: box.querySelector('.tut-dots'), next: box.querySelector('.tut-next') };
    box.querySelector('.tut-skip').addEventListener('click', () => this.skip());
    el.next.addEventListener('click', () => this.next());
    return el;
  }

  _render() {
    const el = this.el;
    if (!el) return;
    if (this.finished) {
      el.root.classList.add('done');
      el.n.textContent = 'ОБУЧЕНИЕ';
      el.t.textContent = this.outcome === 'done' ? 'ГОТОВО!' : 'ПРОПУЩЕНО';
      el.do.textContent = this.outcome === 'done' ? 'Теперь — короткий бой с лёгким соперником' : '';
      el.h.textContent = '';
      el.next.hidden = true;
      el.root.querySelector('.tut-skip').hidden = true;
      return;
    }
    const s = this.step;
    el.root.classList.remove('done');
    el.n.textContent = `ОБУЧЕНИЕ · ${this.index + 1} из ${this.steps.length}`;
    el.t.textContent = s.title;
    const left = (s.need || 1) - this.count;
    el.do.textContent = s[this.control] + (s.need > 1 && left > 0 ? ` · ещё ${left}` : '');
    el.h.textContent = s.hint;
    el.dots.textContent = '';
    this.steps.forEach((_, i) => { const d = document.createElement('i'); if (i < this.index) d.className = 'on'; else if (i === this.index) d.className = 'now'; el.dots.append(d); });
  }
}

// ---------------------------------------------------------------- the results screen: one tip from what went wrong
// st: what the page counted during the bout (main.js boutStats): { taken: {straight, hook, upper, body, kick, elbow, knee},
// counters, whiffs, smothered, gassed }; me / foe: the fighters' snapshots at the end; won: true / false / null (draw).
export function resultTip(st, me, foe, { won = null, level = 0, camera = false } = {}) {
  const k = (keys, cam) => (camera ? cam : keys);
  const taken = st.taken || {};
  const hits = Object.values(taken).reduce((a, b) => a + b, 0);
  const acc = me.thrown > 0 ? me.landed / me.thrown : 0;
  const top = Object.entries(taken).sort((a, b) => b[1] - a[1])[0] || ['', 0];
  if (won === false && top[0] === 'hook' && top[1] >= 4) return k('Хуки догоняют уклон: от хука ныряй (C) или держи блок (Пробел).', 'Хуки догоняют уклон: от хука присядь (нырок) или держи кулаки у лица.');
  if (won === false && top[0] === 'upper' && top[1] >= 3) return k('От апперкота спасает уклон (Q / E): сквозь блок проходит половина.', 'От апперкота спасает наклон вбок: сквозь блок проходит половина.');
  if ((st.counters || 0) >= 3) return 'Тебя ловят встречными: бей сразу после его удара, а не в его замах.';
  if ((st.whiffs || 0) >= 5) return k('Много ударов не достало: шагни вперёд (W) перед серией.', 'Много ударов не достало: наклонись к экрану, чтобы подойти, и тогда бей.');
  if ((st.smothered || 0) >= 4) return k('Слишком близко — удары вязнут. Отступи на полшага (S) или бей апперкот (N / M).', 'Слишком близко — удары вязнут. Отклонись назад или бей апперкот снизу.');
  if ((st.gassed || 0) >= 1) return 'Ты выдыхался: делай паузы между сериями, дыхание восстанавливается, пока не бьёшь.';
  if (won === false && hits >= 10 && (me.blocksMade || 0) + (me.dodgesMade || 0) < 4) return k('Защищайся: Пробел — блок, Q / E — уклон в миг, когда визор соперника вспыхнул.', 'Защищайся: кулаки к лицу — блок, наклон вбок — уклон, когда визор соперника вспыхнул.');
  if (me.thrown >= 15 && acc < 0.25) return 'Точность низкая: бей, когда он промахнулся или ударил в блок — в этот миг он открыт.';
  if (won === true && level < 2) return 'Чисто сработано. Попробуй соперника сильнее.';
  if (won === true) return 'Победа над сложным ботом. Теперь — рейтинг и онлайн-дуэль.';
  if ((foe.blocksMade || 0) >= 8) return k('Соперник часто в блоке: апперкот (N / M) проходит сквозь блок наполовину, удар в корпус (Shift) — обходит.', 'Соперник часто в блоке: апперкот снизу проходит сквозь блок наполовину.');
  return k('Серия джеб-джеб-кросс (J J K) пробивает защиту чаще одиночных ударов.', 'Серия «левой, левой, правой» пробивает защиту чаще одиночных ударов.');
}
