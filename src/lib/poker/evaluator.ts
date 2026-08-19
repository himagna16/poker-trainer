/**
 * evaluator.ts - given 7 cards, how good is the best 5-card poker hand?
 *
 * This is the single most performance-critical file in the app. When we tell
 * you "you have 34.2% equity", we got that by dealing out thousands of possible
 * futures and evaluating a hand for each one. If this function is slow, the
 * whole app feels slow.
 *
 * THE KEY IDEA: we turn a poker hand into ONE NUMBER.
 *
 * A bigger number is a better hand, always. So comparing two hands is just
 * `scoreA > scoreB`. No special cases, no "well if they both have two pair
 * then check the kicker..." logic scattered around the codebase. All of that
 * knowledge gets baked into how we build the number, exactly once, right here.
 *
 * The number is packed like this, using 24 bits:
 *
 *     [ category ][ kicker1 ][ kicker2 ][ kicker3 ][ kicker4 ][ kicker5 ]
 *        4 bits     4 bits     4 bits     4 bits     4 bits     4 bits
 *
 * Category is 0 (high card) through 8 (straight flush). Because the category
 * sits in the highest bits, ANY flush automatically outranks ANY straight
 * without us ever writing an if-statement comparing them. The kickers below it
 * break ties within a category, in order of importance.
 *
 * Example: a pair of kings with A-9-4 kickers becomes
 *     category 1 (pair), then 11 (king), 12 (ace), 7 (nine), 2 (four), 0
 * A pair of queens with the same kickers packs to a smaller number. Done.
 *
 * Fun fact that motivates all this: there are 133,784,560 different ways to be
 * dealt 7 cards, but only 7,462 genuinely distinct hand strengths. Almost all
 * of that variety is cosmetic.
 */

import type { Card } from './cards';
import { RANK_NAMES, RANK_NAMES_PLURAL, RANK_CHARS } from './cards';

export const CAT_HIGH_CARD = 0;
export const CAT_PAIR = 1;
export const CAT_TWO_PAIR = 2;
export const CAT_TRIPS = 3;
export const CAT_STRAIGHT = 4;
export const CAT_FLUSH = 5;
export const CAT_FULL_HOUSE = 6;
export const CAT_QUADS = 7;
export const CAT_STRAIGHT_FLUSH = 8;

export const CATEGORY_NAMES = [
  'High card',
  'Pair',
  'Two pair',
  'Three of a kind',
  'Straight',
  'Flush',
  'Full house',
  'Four of a kind',
  'Straight flush',
];

/**
 * STRAIGHT LOOKUP TABLE - a precomputed answer for every possible hand shape.
 *
 * A "rank mask" is 13 bits saying which ranks you hold, ignoring suits. There
 * are only 2^13 = 8192 possible masks, which is tiny. So instead of scanning
 * for five-in-a-row every single time we evaluate a hand, we work out the
 * answer for all 8192 masks once when the app loads, and then every future
 * straight check is a single array lookup.
 *
 * This is the classic space-for-time trade: spend 8KB of memory once, save a
 * loop on every one of the millions of evaluations that follow.
 *
 * The stored value is the rank of the straight's highest card, or -1 for none.
 */
const STRAIGHT_HIGH = (() => {
  const table = new Int8Array(8192).fill(-1);
  for (let mask = 0; mask < 8192; mask++) {
    // Normal straights: five consecutive bits, checked from the top down so we
    // find the BEST straight first (a hand can contain more than one).
    for (let high = 12; high >= 4; high--) {
      const needed = 0b11111 << (high - 4);
      if ((mask & needed) === needed) {
        table[mask] = high;
        break;
      }
    }
    // The wheel: A-2-3-4-5, where the ace plays LOW. It's the one straight that
    // doesn't look like five consecutive bits, because the ace lives at the top
    // of our rank ordering. Its high card is the five, making it the weakest
    // straight - which is why the wheel loses to 2-3-4-5-6.
    const WHEEL = (1 << 12) | 0b1111;
    if (table[mask] < 0 && (mask & WHEEL) === WHEEL) table[mask] = 3;
  }
  return table;
})();

// Scratch space reused across calls. Allocating a fresh array inside a function
// that runs millions of times would bury us in garbage collection, so we keep
// one buffer and clear it. Safe because JavaScript runs this single-threaded.
const _rankCount = new Uint8Array(13);
const _suitMask = new Int32Array(4);
const _suitCount = new Uint8Array(4);
const _kick: number[] = [0, 0, 0, 0, 0];

function pack(cat: number, k0 = 0, k1 = 0, k2 = 0, k3 = 0, k4 = 0): number {
  return (cat << 20) | (k0 << 16) | (k1 << 12) | (k2 << 8) | (k3 << 4) | k4;
}

/** Collect the highest `n` ranks present in `mask` into the scratch array. */
function topRanks(mask: number, n: number): number {
  let found = 0;
  for (let r = 12; r >= 0 && found < n; r--) {
    if (mask & (1 << r)) _kick[found++] = r;
  }
  while (found < 5) _kick[found++] = 0;
  return found;
}

/**
 * Score the best 5-card hand contained in `cards`. Expects 5, 6, or 7 cards.
 * Bigger is better; the number is only meaningful compared to another score.
 */
export function evaluate(cards: Card[]): number {
  _rankCount.fill(0);
  _suitMask.fill(0);
  _suitCount.fill(0);

  let rankMask = 0;
  for (let i = 0; i < cards.length; i++) {
    const c = cards[i];
    const r = c >> 2;
    const s = c & 3;
    rankMask |= 1 << r;
    _rankCount[r]++;
    _suitMask[s] |= 1 << r;
    _suitCount[s]++;
  }

  // Is there a flush? With only 7 cards, at most ONE suit can reach five cards
  // (two suits would need ten), so there's never any ambiguity about which.
  let flushSuit = -1;
  for (let s = 0; s < 4; s++) {
    if (_suitCount[s] >= 5) {
      flushSuit = s;
      break;
    }
  }

  // We check categories from strongest to weakest and return on the first hit.
  // Because the categories are strictly ordered, the first match is always the
  // best hand available. This is also why we can't shortcut: holding a flush
  // does NOT mean you have a flush hand, since you might also have a full house
  // hiding in the same seven cards, and a boat beats a flush.

  // 8 - Straight flush
  if (flushSuit >= 0) {
    const sfHigh = STRAIGHT_HIGH[_suitMask[flushSuit]];
    if (sfHigh >= 0) return pack(CAT_STRAIGHT_FLUSH, sfHigh);
  }

  // Scan the rank counts once and remember what we found. Going top-down means
  // the first pair/trips we see is automatically the highest one.
  let quad = -1;
  let trips1 = -1;
  let trips2 = -1;
  let pair1 = -1;
  let pair2 = -1;
  for (let r = 12; r >= 0; r--) {
    const n = _rankCount[r];
    if (n === 4) {
      if (quad < 0) quad = r;
    } else if (n === 3) {
      if (trips1 < 0) trips1 = r;
      else if (trips2 < 0) trips2 = r;
    } else if (n === 2) {
      if (pair1 < 0) pair1 = r;
      else if (pair2 < 0) pair2 = r;
    }
  }

  // 7 - Four of a kind
  if (quad >= 0) {
    topRanks(rankMask & ~(1 << quad), 1);
    return pack(CAT_QUADS, quad, _kick[0]);
  }

  // 6 - Full house. The "pair" half can come from an actual pair or from a
  // second set of trips (7 cards can hold two sets, e.g. 999-444-K).
  if (trips1 >= 0) {
    const partner = trips2 > pair1 ? trips2 : pair1;
    if (partner >= 0) return pack(CAT_FULL_HOUSE, trips1, partner);
  }

  // 5 - Flush
  if (flushSuit >= 0) {
    topRanks(_suitMask[flushSuit], 5);
    return pack(CAT_FLUSH, _kick[0], _kick[1], _kick[2], _kick[3], _kick[4]);
  }

  // 4 - Straight
  const straightHigh = STRAIGHT_HIGH[rankMask];
  if (straightHigh >= 0) return pack(CAT_STRAIGHT, straightHigh);

  // 3 - Three of a kind
  if (trips1 >= 0) {
    topRanks(rankMask & ~(1 << trips1), 2);
    return pack(CAT_TRIPS, trips1, _kick[0], _kick[1]);
  }

  // 2 - Two pair. With three pairs in seven cards we play the top two, and the
  // odd pair's rank is still eligible to be our kicker.
  if (pair1 >= 0 && pair2 >= 0) {
    topRanks(rankMask & ~(1 << pair1) & ~(1 << pair2), 1);
    return pack(CAT_TWO_PAIR, pair1, pair2, _kick[0]);
  }

  // 1 - One pair
  if (pair1 >= 0) {
    topRanks(rankMask & ~(1 << pair1), 3);
    return pack(CAT_PAIR, pair1, _kick[0], _kick[1], _kick[2]);
  }

  // 0 - High card
  topRanks(rankMask, 5);
  return pack(CAT_HIGH_CARD, _kick[0], _kick[1], _kick[2], _kick[3], _kick[4]);
}

export function categoryOf(score: number): number {
  return score >> 20;
}

export function kickerOf(score: number, i: number): number {
  return (score >> (16 - i * 4)) & 15;
}

/**
 * Turn a score back into English: "Full house, Kings full of Threes".
 * We use this for the hand history, and to trigger vocabulary tooltips -
 * flopping a full house is what teaches you the phrase "flopped the boat".
 */
export function describeHand(score: number): string {
  const cat = categoryOf(score);
  const k = (i: number) => kickerOf(score, i);
  switch (cat) {
    case CAT_STRAIGHT_FLUSH:
      return k(0) === 12 ? 'Royal flush' : `Straight flush, ${RANK_NAMES[k(0)]} high`;
    case CAT_QUADS:
      return `Four of a kind, ${RANK_NAMES_PLURAL[k(0)]}`;
    case CAT_FULL_HOUSE:
      return `Full house, ${RANK_NAMES_PLURAL[k(0)]} full of ${RANK_NAMES_PLURAL[k(1)]}`;
    case CAT_FLUSH:
      return `Flush, ${RANK_NAMES[k(0)]} high`;
    case CAT_STRAIGHT:
      return k(0) === 3 ? 'Straight, Five high (the wheel)' : `Straight, ${RANK_NAMES[k(0)]} high`;
    case CAT_TRIPS:
      return `Three of a kind, ${RANK_NAMES_PLURAL[k(0)]}`;
    case CAT_TWO_PAIR:
      return `Two pair, ${RANK_NAMES_PLURAL[k(0)]} and ${RANK_NAMES_PLURAL[k(1)]}`;
    case CAT_PAIR:
      return `Pair of ${RANK_NAMES_PLURAL[k(0)]}`;
    default:
      return `${RANK_NAMES[k(0)]} high`;
  }
}

/** Compact form for tight UI spots: "K♠ high", "Two pair KQ". */
export function shortDescribe(score: number): string {
  const cat = categoryOf(score);
  const k = (i: number) => RANK_CHARS[kickerOf(score, i)];
  switch (cat) {
    case CAT_STRAIGHT_FLUSH: return kickerOf(score, 0) === 12 ? 'Royal' : `SF ${k(0)}`;
    case CAT_QUADS: return `Quad ${k(0)}s`;
    case CAT_FULL_HOUSE: return `${k(0)}s full`;
    case CAT_FLUSH: return `${k(0)}-high flush`;
    case CAT_STRAIGHT: return `${k(0)}-high straight`;
    case CAT_TRIPS: return `Trip ${k(0)}s`;
    case CAT_TWO_PAIR: return `${k(0)}${k(1)} two pair`;
    case CAT_PAIR: return `Pair of ${k(0)}s`;
    default: return `${k(0)} high`;
  }
}

/**
 * Expose the straight table so other code can ask "would one more card of rank
 * R complete a straight?" without re-deriving the logic. Used for spotting
 * draws when the bots decide how to play.
 */
export function straightHighFromMask(rankMask: number): number {
  return STRAIGHT_HIGH[rankMask & 0x1fff];
}
