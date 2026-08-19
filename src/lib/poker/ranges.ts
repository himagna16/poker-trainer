/**
 * ranges.ts - reading what your opponent might be holding.
 *
 * A beginner asks "what does he have?" - which is unanswerable. A good player
 * asks "what could he have, and how likely is each one?" That set of holdings,
 * with a weight on each, is called a RANGE, and thinking in ranges is probably
 * the single biggest leap in how you see the game.
 *
 * We start with all 1,326 possible two-card combinations at equal weight, then
 * shrink and reweight after every action they take. If a tight player raises,
 * the weight on 7-2 offsuit collapses to nearly zero while the weight on aces
 * stays high. Nothing is ever fully eliminated, because anyone can show up with
 * anything - we just track how *plausible* each holding has become.
 *
 * The neat part is that we don't need a separate model to do this. The bots
 * already expose their full strategy, so we run that same function backwards.
 */

import type { Card } from './cards';
import { handNotation, RANK_CHARS } from './cards';
import { preflopPercentile } from './preflopStrength';
import type { HandState, Action } from './engine';
import { livePlayers } from './engine';
import type { BotPersona } from './bots';
import { actionProbability } from './bots';

export interface WeightedCombo {
  cards: Card[];
  /** How plausible this holding is, 0..1. */
  weight: number;
}
export type WeightedRange = WeightedCombo[];

/** All 1,326 two-card combinations, every one equally likely. */
export function fullRange(): WeightedRange {
  const out: WeightedRange = [];
  for (let a = 0; a < 52; a++) {
    for (let b = a + 1; b < 52; b++) out.push({ cards: [a, b], weight: 1 });
  }
  return out;
}

/** The strongest `pct` of starting hands - e.g. 0.2 for "the top 20%". */
export function topPercentRange(pct: number): WeightedRange {
  return fullRange().filter((c) => preflopPercentile(handNotation(c.cards[0], c.cards[1])) <= pct);
}

/**
 * Drop combinations containing cards we can already see.
 *
 * This is "card removal", and it matters more than people expect. If you hold
 * two aces, there are only two aces left in the deck, so the chance your
 * opponent also has one drops sharply. Ignoring this quietly biases every read.
 */
export function removeBlocked(range: WeightedRange, dead: Card[]): WeightedRange {
  const blocked = new Uint8Array(52);
  for (const c of dead) blocked[c] = 1;
  return range.filter((c) => !blocked[c.cards[0]] && !blocked[c.cards[1]]);
}

/**
 * Update a range after the opponent acts.
 *
 * For every holding still in the range we ask the bot's own strategy function:
 * "holding these two cards, how often would you have done what you just did?"
 * Multiply that into the weight. Hands that would rarely play this way fade out;
 * hands that always play this way keep their weight.
 *
 * This is Bayes' rule, and it's worth recognising it as such - it's the same
 * update you'd use for any "I observed evidence, revise my beliefs" problem.
 */
export function updateRangeWithAction(
  range: WeightedRange,
  stateBeforeAction: HandState,
  persona: BotPersona,
  action: Action
): WeightedRange {
  const updated: WeightedRange = [];
  for (const combo of range) {
    const p = actionProbability(stateBeforeAction, persona, combo.cards, action);
    const w = combo.weight * p;
    if (w > 1e-6) updated.push({ cards: combo.cards, weight: w });
  }
  // If an action was so surprising it killed every holding, our model of this
  // opponent is simply wrong. Better to fall back to "could be anything" than to
  // report confident nonsense from an empty range.
  if (updated.length === 0) return range.map((c) => ({ ...c }));
  return normalize(updated);
}

/** Rescale so the most plausible holding sits at weight 1. */
export function normalize(range: WeightedRange): WeightedRange {
  let max = 0;
  for (const c of range) if (c.weight > max) max = c.weight;
  if (max <= 0) return range;
  return range.map((c) => ({ cards: c.cards, weight: c.weight / max }));
}

/**
 * How wide is this range, measured in combinations?
 *
 * We add up the weights rather than counting entries, so a range holding fifty
 * combos at 10% confidence counts as "about 5 combos", not fifty.
 */
export function rangeWidth(range: WeightedRange): number {
  let total = 0;
  for (const c of range) total += c.weight;
  return total;
}

/** Range width as a share of all possible hands - "they have about 18% of hands". */
export function rangePercent(range: WeightedRange): number {
  return rangeWidth(range) / 1326;
}

/**
 * Build a sampler that draws holdings in proportion to their weight.
 * Uses cumulative weights plus a binary search, so each draw is O(log n).
 */
export function makeSampler(range: WeightedRange): (u: number) => Card[] {
  const cumulative = new Float64Array(range.length);
  let running = 0;
  for (let i = 0; i < range.length; i++) {
    running += range[i].weight;
    cumulative[i] = running;
  }
  return (u: number) => {
    if (running <= 0) return range[0]?.cards ?? [0, 1];
    const target = u * running;
    let lo = 0;
    let hi = range.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cumulative[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    return range[lo].cards;
  };
}

export interface GridCell {
  hand: string;
  /** Average weight across the combos of this hand, 0..1. */
  weight: number;
  /** How many combinations of this hand remain. */
  combos: number;
  maxCombos: number;
}

/**
 * Collapse a range down to the 13x13 grid every poker tool displays: pairs on
 * the diagonal, suited hands above it, offsuit below. It's the standard way to
 * look at a range at a glance.
 */
export function rangeGrid(range: WeightedRange): Map<string, GridCell> {
  const grid = new Map<string, GridCell>();
  for (let i = 12; i >= 0; i--) {
    for (let j = 12; j >= 0; j--) {
      const hand =
        i === j ? RANK_CHARS[i] + RANK_CHARS[j]
        : i > j ? RANK_CHARS[i] + RANK_CHARS[j] + 's'
        : RANK_CHARS[j] + RANK_CHARS[i] + 'o';
      if (!grid.has(hand)) {
        grid.set(hand, { hand, weight: 0, combos: 0, maxCombos: i === j ? 6 : i > j ? 4 : 12 });
      }
    }
  }
  for (const combo of range) {
    const hand = handNotation(combo.cards[0], combo.cards[1]);
    const cell = grid.get(hand);
    if (!cell) continue;
    cell.weight += combo.weight;
    cell.combos += 1;
  }
  for (const cell of grid.values()) {
    if (cell.combos > 0) cell.weight = cell.weight / cell.combos;
  }
  return grid;
}

/* ------------------------------------------------------------------ *
 * Tracking every opponent at once
 * ------------------------------------------------------------------ */

/**
 * One range per seat. The hero's own entry stays empty - we can see our cards,
 * so there is nothing to infer.
 *
 * At a six-handed table you are reading five people at the same time, and they
 * are not interchangeable: the seat that raised under the gun has a completely
 * different range from the seat that called on the button. Keeping them
 * separate is what lets the trainer say "the Rock has you beaten but the Maniac
 * doesn't" instead of averaging them into mush.
 */
export type RangeBook = WeightedRange[];

export function newRangeBook(state: HandState, heroSeat: number): RangeBook {
  const dead = [...state.hole[heroSeat], ...state.board];
  const book: RangeBook = [];
  for (let seat = 0; seat < state.playerCount; seat++) {
    book.push(seat === heroSeat ? [] : removeBlocked(fullRange(), dead));
  }
  return book;
}

/** Narrow one seat's range after that seat acts. Other seats are untouched. */
export function updateBookForAction(
  book: RangeBook,
  stateBeforeAction: HandState,
  persona: BotPersona,
  action: Action,
  seat: number
): RangeBook {
  const next = [...book];
  if (next[seat] && next[seat].length > 0) {
    next[seat] = updateRangeWithAction(next[seat], stateBeforeAction, persona, action);
  }
  return next;
}

/**
 * Drop holdings containing cards that have since become visible.
 *
 * Every time a board card appears, that's one more card nobody can be holding.
 * Skipping this is a quiet source of wrong reads - the app would keep assigning
 * opponents hands built from cards lying face up on the table.
 */
export function pruneBook(book: RangeBook, dead: Card[]): RangeBook {
  return book.map((range) => (range.length ? removeBlocked(range, dead) : range));
}

/** The seats we still have to worry about, and how wide each one is. */
export function activeReads(
  state: HandState,
  heroSeat: number,
  book: RangeBook
): Array<{ seat: number; percent: number; combos: number }> {
  return livePlayers(state)
    .filter((seat) => seat !== heroSeat)
    .map((seat) => ({
      seat,
      percent: rangePercent(book[seat] ?? []),
      combos: Math.round(rangeWidth(book[seat] ?? [])),
    }));
}
