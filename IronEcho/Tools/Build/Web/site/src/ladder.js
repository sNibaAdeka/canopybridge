// The ladder (1.10): six opponents in a row. The rules of each (bot level + style) live in the core (Match.h, ApplyLadderRung);
// here is what the page shows of them: the name, the chassis and paint, one line on how it fights and one tip against it.
// Progress is the player's own and stays in this browser.
//
// chassis: the robot the opponent is built on ('forge' = the sparring frame, 'ember' = the champion's); livery: RobotRig.setLivery
// (hue turns the painted areas round the colour wheel, shell repaints the dark armour of the Ember frame), null = as baked.
// level: the bot level the rung is built on (the HUD and the telemetry name it); body: its body language (FighterAnimator.setStyle).

export const LADDER = [
  { id: 'bolt', name: 'БОЛТ', title: 'новичок', chassis: 'forge', level: 0,
    livery: { hue: 0.616, sat: 0.8, glow: [0.9, 1.0, 0.55] }, body: { crouch: -0.03, lean: -4, bounce: 0.6, weave: 0.5, hz: 0.9 },
    style: 'Бьёт джебом издалека, почти не защищается.',
    tip: 'Отвечай кроссом сразу после его джеба: в этот миг он открыт.' },
  { id: 'sledge', name: 'КУВАЛДА', title: 'панчер', chassis: 'forge', level: 0,
    livery: { hue: 0.436, sat: 1.05, glow: [1.0, 0.75, 0.45] }, body: { crouch: 0.04, lean: 8, bounce: 0.5, weave: 0.4, hz: 0.75 },
    style: 'Тяжёлые хуки с большим замахом, прёт вперёд. Держит удар.',
    tip: 'Широкий замах — нырок или блок, потом твоя серия. Не размахивайся в ответ.' },
  { id: 'mirror', name: 'ЗЕРКАЛО', title: 'контрпанчер', chassis: 'ember', level: 0,
    livery: { hue: 0.5, sat: 0.9, shell: [0.42, 0.44, 0.47], shellMix: 0.9, glow: [0.6, 0.9, 1.0] },
    body: { crouch: 0.01, bounce: 0.4, weave: 0.6, hz: 0.9, guard: 0.03 },
    style: 'Ждёт твоего промаха, закрывается и отвечает.',
    tip: 'Не бей в блок: финт джебом, удар в корпус, а главное — сразу после его удара.' },
  { id: 'whirl', name: 'ВИХРЬ', title: 'танцор', chassis: 'forge', level: 1,
    livery: { hue: 0.146, sat: 1.0, glow: [1.0, 0.5, 1.0] }, body: { crouch: -0.01, bounce: 1.8, weave: 1.8, hz: 1.25 },
    style: 'Кружит, уклоняется и бьёт сериями лёгких ударов.',
    tip: 'Хук догоняет уклон. Режь ринг шагом в сторону, а не гонись за ним.' },
  { id: 'ram', name: 'ТАРАН', title: 'давящий', chassis: 'ember', level: 2,
    livery: { hue: 0.3, sat: 0.85, shell: [0.045, 0.06, 0.03], shellMix: 0.85, glow: [0.7, 1.0, 0.5] },
    body: { crouch: 0.03, lean: 8, bounce: 0.8, weave: 0.7, hz: 1.1 },
    style: 'Прижимает к канатам и бьёт в корпус, почти без пауз.',
    tip: 'Не стой у канатов: шаг в сторону, а вплотную — апперкот.' },
  { id: 'ember', name: 'EMBER 13', title: 'чемпион', chassis: 'ember', level: 2, livery: null,
    style: 'Читает твою защиту и бьёт туда, что ты не прикрыл.',
    tip: 'Меняй защиту: блок, уклон и нырок по очереди — он запоминает привычку.' },
];

export const LADDER_KEY = 'ironecho.ladder';

export class LadderProgress {
  // store: { get(key), set(key, value) } (main.js pageStore: survives a private window as best it can)
  constructor(store) {
    this.store = store;
    let saved = null;
    try { saved = JSON.parse(store.get(LADDER_KEY) || 'null'); } catch { saved = null; }
    this.beaten = Array.isArray(saved && saved.beaten) ? saved.beaten.filter((r) => Number.isInteger(r) && r >= 0 && r < LADDER.length) : [];
    this.titles = (saved && Number.isInteger(saved.titles)) ? saved.titles : 0; // champion beaten this many times
    this.pick = null; // a rung chosen in the menu for this visit (a beaten one, to fight again)
  }

  // the first rung not beaten yet; after the champion, the champion again (a title defence)
  get next() {
    for (let r = 0; r < LADDER.length; r++) if (!this.beaten.includes(r)) return r;
    return LADDER.length - 1;
  }

  get champion() { return this.titles > 0; }

  current() { return this.pick !== null && this.isOpen(this.pick) ? this.pick : this.next; }

  isOpen(r) { return r <= this.next || this.beaten.includes(r); }

  win(r) {
    if (!this.beaten.includes(r)) this.beaten.push(r);
    if (r === LADDER.length - 1) this.titles++;
    this.pick = null;
    this._save();
  }

  _save() { this.store.set(LADDER_KEY, JSON.stringify({ beaten: this.beaten, titles: this.titles })); }
}
