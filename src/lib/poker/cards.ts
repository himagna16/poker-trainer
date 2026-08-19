/**
 * cards.ts - how we represent a deck of cards.
 *
 * A card is just a number from 0 to 51. That's the whole representation.
 *
 * Why a plain number instead of an object like { rank: 'A', suit: 'spades' }?
 * Because we are going to evaluate millions of poker hands per second when we
 * calculate odds. Comparing numbers is dramatically faster than comparing
 * objects, and it lets us use bit tricks later in the evaluator. Almost all of
 * this app's speed traces back to this one decision.
 *
 * The encoding is:   card = rank * 4 + suit
 *
 *   rank: 0..12  ->  2 3 4 5 6 7 8 9 T J Q K A     (0 is a deuce, 12 is an ace)
 *   suit: 0..3   ->  s h d c                        (spade heart diamond club)
 *
 * To pull the pieces back out:
 *   rank = card >> 2    (a fast way to divide by 4 and drop the remainder)
 *   suit = card & 3     (a fast way to get the remainder after dividing by 4)
 */

export type Card = number;

export const RANK_CHARS = '23456789TJQKA';
export const SUIT_CHARS = 'shdc';

/** Pretty symbols for the UI. Index matches SUIT_CHARS. */
export const SUIT_SYMBOLS = ['♠', '♥', '♦', '♣'];

/** Spades and clubs render dark, hearts and diamonds render red. */
export const SUIT_IS_RED = [false, true, true, false];

/** Full rank names, used when we describe a hand in English. */
export const RANK_NAMES = [
  'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight',
  'Nine', 'Ten', 'Jack', 'Queen', 'King', 'Ace',
];

export const RANK_NAMES_PLURAL = [
  'Twos', 'Threes', 'Fours', 'Fives', 'Sixes', 'Sevens', 'Eights',
  'Nines', 'Tens', 'Jacks', 'Queens', 'Kings', 'Aces',
];

export function rankOf(card: Card): number {
  return card >> 2;
}

export function suitOf(card: Card): number {
  return card & 3;
}

export function makeCard(rank: number, suit: number): Card {
  return rank * 4 + suit;
}

/** 5 -> "7h". Used for debugging, tests, and URLs. */
export function cardToString(card: Card): string {
  return RANK_CHARS[rankOf(card)] + SUIT_CHARS[suitOf(card)];
}

/** "7h" -> 5. Throws on anything malformed so bad input fails loudly. */
export function stringToCard(s: string): Card {
  const rank = RANK_CHARS.indexOf(s[0].toUpperCase());
  const suit = SUIT_CHARS.indexOf(s[1].toLowerCase());
  if (rank < 0 || suit < 0) throw new Error(`Bad card string: ${s}`);
  return makeCard(rank, suit);
}

/** "AhKd" or "Ah Kd" -> [card, card] */
export function parseCards(s: string): Card[] {
  const cleaned = s.replace(/[\s,]/g, '');
  const out: Card[] = [];
  for (let i = 0; i < cleaned.length; i += 2) {
    out.push(stringToCard(cleaned.slice(i, i + 2)));
  }
  return out;
}

export function cardsToString(cards: Card[]): string {
  return cards.map(cardToString).join('');
}

/** A fresh 52-card deck, in order. */
export function makeDeck(): Card[] {
  const deck: Card[] = new Array(52);
  for (let i = 0; i < 52; i++) deck[i] = i;
  return deck;
}

/**
 * A seeded random number generator (the "mulberry32" algorithm).
 *
 * Why not just use Math.random()? Because we want hands to be *reproducible*.
 * If a drill deals you a tricky spot, we want to be able to replay that exact
 * spot later, share it with a friend by URL, or use it in a test that gives the
 * same answer every time. Feeding the same seed in always produces the same
 * sequence of "random" numbers out.
 */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function rng(): number {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Fisher-Yates shuffle, done in place.
 *
 * Walk backwards through the array and swap each card with a random card at or
 * before it. This is the only shuffle that gives every one of the 52! possible
 * orderings exactly equal probability. The "obvious" shuffle most people write
 * first (loop through and swap each card with any random card) is subtly biased
 * toward some orderings, which would quietly skew every odds number we compute.
 */
export function shuffle<T>(arr: T[], rng: () => number): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

/** Deal n cards off the end of a deck array, mutating it. */
export function deal(deck: Card[], n: number): Card[] {
  const out: Card[] = [];
  for (let i = 0; i < n; i++) out.push(deck.pop()!);
  return out;
}

/**
 * Build a deck with certain cards removed - the "dead cards".
 *
 * When we compute your odds, the cards you can already see (your hole cards and
 * the board) can't come again. This gives us the deck of everything still live.
 */
export function deckWithout(dead: Card[]): Card[] {
  const used = new Uint8Array(52);
  for (const c of dead) used[c] = 1;
  const out: Card[] = [];
  for (let c = 0; c < 52; c++) if (!used[c]) out.push(c);
  return out;
}

/**
 * The standard shorthand for a starting hand: "AKs", "AKo", "77".
 *
 * There are 1326 distinct two-card combinations you can be dealt, but only 169
 * that actually play differently - because AhKh and AsKs are the same hand
 * strategically. That collapse from 1326 to 169 is what makes preflop charts
 * fit on one screen.
 */
export function handNotation(a: Card, b: Card): string {
  const [hi, lo] = rankOf(a) >= rankOf(b) ? [a, b] : [b, a];
  const hr = RANK_CHARS[rankOf(hi)];
  const lr = RANK_CHARS[rankOf(lo)];
  if (rankOf(hi) === rankOf(lo)) return hr + lr;
  return hr + lr + (suitOf(hi) === suitOf(lo) ? 's' : 'o');
}
