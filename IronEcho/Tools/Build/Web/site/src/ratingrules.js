// Rating rules, shared by the page and the rating server (both import this very file): nicknames, the Elo formula, the bot ratings.
// No DOM, no network: pure functions, tested in Tests/Web/rating_test.mjs.

export const RATING_START = 1000;
export const RATING_FLOOR = 100;
export const BOT_RATING = [900, 1200, 1500]; // Easy, Normal, Hard: the rating each bot is worth in the Elo formula
export const LADDERS = ['keys', 'camera'];   // keyboard / touch, and body tracking through a webcam or phones: separate tables
export const NICK_MIN = 3;
export const NICK_MAX = 16;

// Letters of any alphabet, digits, and inside the name: space _ . -  (3-16 characters, starts and ends with a letter or digit).
const NICK_RE = /^[\p{L}\p{N}][\p{L}\p{N} _.\-]{1,14}[\p{L}\p{N}]$/u;

export function cleanNick(raw) {
  const s = String(raw ?? '').normalize('NFC').replace(/\s+/g, ' ').trim();
  return NICK_RE.test(s) ? s : '';
}

// Cyrillic letters that look like Latin ones count as the same letter, so "Аdmin" cannot pass for "Admin".
const LOOKALIKE = { а: 'a', в: 'b', е: 'e', ё: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', і: 'i', ј: 'j', ѕ: 's' };
export function nickKey(nick) {
  let out = '';
  for (const ch of String(nick).normalize('NFC').toLowerCase()) {
    if (/[\s_.\-]/u.test(ch)) continue;
    out += LOOKALIKE[ch] || ch;
  }
  return out;
}

// K: new players move fast, settled players slowly.
export function kFactor(games) { return games < 10 ? 40 : games < 30 ? 32 : 24; }

export function expectedScore(rating, opponent) { return 1 / (1 + 10 ** ((opponent - rating) / 400)); }

// score: 1 win, 0.5 draw, 0 loss. Returns the new rating (two decimals, never below the floor).
export function ratingAfter(rating, games, level, score) {
  const opp = BOT_RATING[level] ?? BOT_RATING[1];
  const next = rating + kFactor(games) * (score - expectedScore(rating, opp));
  return Math.max(RATING_FLOOR, Math.round(next * 100) / 100);
}

export const isLadder = (x) => LADDERS.includes(x);
export const isLevel = (x) => Number.isInteger(x) && x >= 0 && x <= 2;
// A player is "provisional" (shown with a question mark) until this many rated bouts.
export const PROVISIONAL_GAMES = 10;
