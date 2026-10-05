// Broadcast-style HUD (DOM): fighter bars with a damage trail, stamina, knockdown pips, round clock, callouts,
// banners, the referee count with the get-up prompt, and the result card with the three judges.
const $h = (sel) => document.querySelector(sel);

const METHOD = { 1: 'НОКАУТ', 2: 'РЕШЕНИЕ СУДЕЙ', 3: 'НИЧЬЯ', 4: 'ТЕХНИЧЕСКИЙ НОКАУТ' };
const DECISION = { 1: 'единогласное', 2: 'раздельное', 3: 'большинством' };

export class Hud {
  constructor() {
    this.el = {
      hud: $h('#hud'),
      pName: $h('#p-name'), oName: $h('#o-name'),
      pHp: $h('#p-hp'), oHp: $h('#o-hp'), pTrail: $h('#p-trail'), oTrail: $h('#o-trail'),
      pSt: $h('#p-st'), oSt: $h('#o-st'), pKd: $h('#p-kd'), oKd: $h('#o-kd'),
      pGas: $h('#p-gas'), round: $h('#round'), time: $h('#time'), feed: $h('#feed'), banner: $h('#banner'),
      bannerMain: $h('#banner-main'), bannerSub: $h('#banner-sub'), count: $h('#count'), getup: $h('#getup'),
      getupFill: $h('#getup-fill'), results: $h('#results'), combo: $h('#combo'), training: $h('#training'),
      trainingHits: $h('#training-hits'), flash: $h('#flash'),
    };
    this.trail = { p: 1, o: 1 };
    this.trailHold = { p: 0, o: 0 };
    this.bannerTimer = 0;
    this.comboTimer = 0;
  }

  setNames(player, opponent) {
    this.el.pName.textContent = player;
    this.el.oName.textContent = opponent;
  }

  show(on) { this.el.hud.hidden = !on; }

  _bar(side, f, dt) {
    const hp = f.maxHealth > 0 ? Math.max(0, f.health / f.maxHealth) : 0;
    const st = f.maxStamina > 0 ? Math.max(0, f.stamina / f.maxStamina) : 0;
    this.el[`${side}Hp`].style.width = `${(hp * 100).toFixed(2)}%`;
    if (hp < this.trail[side]) {
      this.trailHold[side] -= dt;
      if (this.trailHold[side] <= 0) this.trail[side] = Math.max(hp, this.trail[side] - dt * 0.35);
    } else {
      this.trail[side] = hp;
      this.trailHold[side] = 0.55;
    }
    this.el[`${side}Trail`].style.width = `${(this.trail[side] * 100).toFixed(2)}%`;
    this.el[`${side}St`].style.width = `${(st * 100).toFixed(1)}%`;
    this.el[`${side}St`].classList.toggle('low', st < 0.25);
    const kd = this.el[`${side}Kd`];
    const n = Math.round(f.roundKnockdowns);
    if (kd.dataset.n !== String(n)) {
      kd.dataset.n = String(n);
      kd.innerHTML = '<i></i><i></i><i></i>';
      kd.querySelectorAll('i').forEach((pip, i) => pip.classList.toggle('on', i < n));
    }
  }

  // Called when a knockdown resets a bar (the trail must not lag behind a get-up refill).
  resetTrail(side) { this.trail[side] = 1; this.trailHold[side] = 0; }

  update(snap, dt, training, roundSeconds = 90) {
    const m = snap.match;
    this._bar('p', snap.player, dt);
    this._bar('o', snap.opponent, dt);
    this.el.pGas.hidden = !(snap.player.gassedTicksLeft > 0);
    this.el.training.hidden = !training;
    if (training) this.el.trainingHits.textContent = String(m.trainingHits);
    if (training) {
      this.el.round.textContent = 'ТРЕНИРОВКА';
      this.el.time.textContent = '∞';
    } else {
      this.el.round.textContent = `РАУНД ${Math.max(1, m.round)}/${m.rounds}`;
      const secs = m.round > 0 ? Math.max(0, Math.ceil(m.roundTicksLeft / m.tickRate)) : roundSeconds;
      this.el.time.textContent = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;
      this.el.time.classList.toggle('hot', secs <= 10 && m.phaseName === 'Fighting');
    }
    // referee count + get-up prompt
    const counting = m.phaseName === 'Knockdown' && m.postGetUpTicksLeft <= 0;
    this.el.count.hidden = !counting || m.knockdownCount <= 0;
    if (counting) this.el.count.textContent = String(m.knockdownCount);
    const playerDown = snap.player.stateName === 'KnockedDown';
    this.el.getup.hidden = !(counting && playerDown);
    if (playerDown) this.el.getupFill.style.width = `${m.getUpProgress}%`;
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.el.banner.classList.remove('on');
    }
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0) this.el.combo.classList.remove('on');
    }
  }

  banner(main, sub = '', seconds = 1.6, tone = '') {
    this.el.bannerMain.textContent = main;
    this.el.bannerSub.textContent = sub;
    this.el.banner.className = `on ${tone}`;
    this.bannerTimer = seconds;
  }

  combo(n) {
    this.el.combo.textContent = `КОМБО ×${n}`;
    this.el.combo.classList.remove('on');
    void this.el.combo.offsetWidth;
    this.el.combo.classList.add('on');
    this.comboTimer = 1.1;
  }

  // Event callout. The same text while still on screen becomes "×2"; warnings repeat at most every 5 s; two at a time.
  feed(text, tone = '') {
    const now = performance.now();
    this.feedSeen = this.feedSeen || new Map();
    const live = [...this.el.feed.children].find((c) => c.dataset.text === text);
    if (live) {
      const n = Number(live.dataset.n || 1) + 1;
      live.dataset.n = String(n);
      live.textContent = `${text} ×${n}`;
      live.style.animation = 'none';
      void live.offsetWidth;
      live.style.animation = '';
      clearTimeout(live.timer);
      live.timer = setTimeout(() => live.remove(), 1300);
      return;
    }
    if (tone === 'warn' && now - (this.feedSeen.get(text) || -1e9) < 5000) return;
    this.feedSeen.set(text, now);
    const item = document.createElement('div');
    item.className = `callout ${tone}`;
    item.dataset.text = text;
    item.textContent = text;
    this.el.feed.appendChild(item);
    item.timer = setTimeout(() => item.remove(), 1300);
    while (this.el.feed.children.length > 2) this.el.feed.firstChild.remove();
  }

  flash(tone = 'hit') {
    const f = this.el.flash;
    f.className = '';
    void f.offsetWidth;
    f.className = `on ${tone}`;
  }

  results(snap, names) {
    const m = snap.match;
    const p = snap.player;
    const o = snap.opponent;
    const won = m.hasWinner && m.winner === 0;
    const title = !m.hasWinner ? 'НИЧЬЯ' : won ? 'ПОБЕДА' : 'ПОРАЖЕНИЕ';
    let how = METHOD[m.result] || '';
    if ((m.result === 2 || m.result === 3) && DECISION[m.decision]) how += ` (${DECISION[m.decision]})`;
    const winnerName = m.hasWinner ? (m.winner === 0 ? names[0] : names[1]) : '';
    const acc = (f) => (f.thrown > 0 ? Math.round((100 * f.landed) / f.thrown) : 0);
    const row = (label, a, b) => `<tr><td>${a}</td><th>${label}</th><td>${b}</td></tr>`;
    const judges = [1, 2, 3].map((j) => `<div class="judge"><span>Судья ${j}</span><b>${m[`judge${j}Player`]} – ${m[`judge${j}Opponent`]}</b></div>`).join('');
    const showCards = m.result === 2 || m.result === 3;
    const r = this.el.results;
    r.querySelector('.res-title').textContent = title;
    r.querySelector('.res-title').className = `res-title ${won ? 'win' : m.hasWinner ? 'lose' : ''}`;
    r.querySelector('.res-how').textContent = winnerName ? `${winnerName} · ${how} · раунд ${m.round}` : how;
    r.querySelector('.res-judges').innerHTML = showCards ? judges : '';
    r.querySelector('.res-stats').innerHTML = `<table><thead><tr><td>${names[0]}</td><th></th><td>${names[1]}</td></tr></thead><tbody>${[
      row('Ударов', p.thrown, o.thrown), row('Попаданий', `${p.landed} (${acc(p)}%)`, `${o.landed} (${acc(o)}%)`),
      row('Блоков', p.blocksMade, o.blocksMade), row('Уклонов', p.dodgesMade, o.dodgesMade),
      row('Контрударов', p.counterHits, o.counterHits), row('Лучшее комбо', p.maxCombo, o.maxCombo),
      row('Нокдаунов получено', p.knockdowns, o.knockdowns), row('Урон нанесён', p.totalDamage.toFixed(1), o.totalDamage.toFixed(1)),
    ].join('')}</tbody></table>`;
    r.hidden = false;
  }

  hideResults() { this.el.results.hidden = true; }
}
