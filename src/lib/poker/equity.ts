/**
 * equity.ts - "what percent of the time do I win this hand?"
 *
 * Equity is the number the whole training app revolves around. If you and your
 * opponent both went all-in right now and played the hand out a thousand times,
 * equity is the share of the pot you'd walk away with on average.
 *
 * There are two honest ways to compute it, and knowing WHICH to use is most of
 * the skill here:
 *
 *   EXACT ENUMERATION - deal out every single possible future and count.
 *   Gives a perfect answer. Only possible when the number of futures is small.
 *
 *   MONTE CARLO - deal out a few thousand random futures and take the average.
 *   Gives an approximate answer, with error you can actually quantify.
 *
 * People reach for Monte Carlo far too fast. Look at how few futures there
 * actually are once cards are on the table:
 *
 *   after the flop (2 cards to come):  C(45,2) =         990 futures
 *   after the turn (1 card to come):                      44 futures
 *   before the flop (5 cards to come): C(48,5) =   1,712,304 futures
 *
 * So postflop, exact enumeration is not just possible, it's instant - under a
 * millisecond. Only the preflop case is big enough to be worth approximating,
 * and even that one we can brute-force in a fraction of a second.
 *
 * The lesson generalizes well beyond poker: check whether you can just count
 * before you reach for a simulation.
 */

import type { Card } from './cards';
import { deckWithout, makeRng } from './cards';
import { evaluate } from './evaluator';

export interface EquityResult {
  /** Share of the pot you win on average, 0..1. This is the headline number. */
  equity: number;
  win: number;
  tie: number;
  lose: number;
  /** How many futures we looked at. */
  trials: number;
  /** True if we enumerated every future, false if we sampled. */
  exact: boolean;
  /**
   * For sampled results: the 95% confidence interval half-width, in equity
   * points. "34.2% +/- 0.9%" means the true answer is almost certainly between
   * 33.3% and 35.1%. Reporting a simulated number without its error bar is how
   * people fool themselves.
   */
  margin: number;
}

/**
 * Walk every way to choose k items out of n, without allocating a new array
 * each time. This is the "odometer" algorithm: hold indices in increasing
 * order, bump the last one that still has room, then reset everything after it.
 */
function forEachCombination(n: number, k: number, cb: (idx: Int32Array) => void): void {
  const idx = new Int32Array(k);
  if (k === 0) {
    cb(idx);
    return;
  }
  if (k > n) return;
  for (let i = 0; i < k; i++) idx[i] = i;
  for (;;) {
    cb(idx);
    let i = k - 1;
    while (i >= 0 && idx[i] === n - k + i) i--;
    if (i < 0) return;
    idx[i]++;
    for (let j = i + 1; j < k; j++) idx[j] = idx[j - 1] + 1;
  }
}

/** How many futures are left given how many board cards we can already see. */
export function futureCount(boardLength: number, knownCards: number): number {
  const remaining = 52 - knownCards;
  const need = 5 - boardLength;
  let c = 1;
  for (let i = 0; i < need; i++) c = (c * (remaining - i)) / (i + 1);
  return Math.round(c);
}

/**
 * Exact equity for a known hand against a known hand. No randomness, no error
 * bars - this is the true number. Used for the X-ray overlay, where you can see
 * your opponent's cards and we want to show you the real answer.
 */
export function exactEquity(hero: Card[], villain: Card[], board: Card[]): EquityResult {
  const deck = deckWithout([...hero, ...villain, ...board]);
  const need = 5 - board.length;

  const hero7 = new Array<number>(7);
  const vill7 = new Array<number>(7);
  hero7[0] = hero[0];
  hero7[1] = hero[1];
  vill7[0] = villain[0];
  vill7[1] = villain[1];
  for (let i = 0; i < board.length; i++) {
    hero7[2 + i] = board[i];
    vill7[2 + i] = board[i];
  }
  const base = 2 + board.length;

  let win = 0;
  let tie = 0;
  let lose = 0;

  forEachCombination(deck.length, need, (idx) => {
    for (let i = 0; i < need; i++) {
      const c = deck[idx[i]];
      hero7[base + i] = c;
      vill7[base + i] = c;
    }
    const h = evaluate(hero7);
    const v = evaluate(vill7);
    if (h > v) win++;
    else if (h < v) lose++;
    else tie++;
  });

  const trials = win + tie + lose;
  return {
    equity: trials === 0 ? 0 : (win + tie / 2) / trials,
    win: win / trials,
    tie: tie / trials,
    lose: lose / trials,
    trials,
    exact: true,
    margin: 0,
  };
}

/**
 * Equity against a RANGE of hands rather than one specific hand.
 *
 * This is the more realistic question. At a real table you don't know their two
 * cards, you know roughly what they'd play this way - maybe 80 different two
 * card combinations. Your equity is the average across all of them.
 *
 * We sample here because range-vs-range gets big fast: 200 villain combos times
 * 1.7 million preflop runouts is 340 billion futures. Sampling a few thousand
 * gets us within a fraction of a percent, which is far more precision than any
 * poker decision actually needs.
 */
export function rangeEquity(
  hero: Card[],
  villainRange: Card[][],
  board: Card[],
  trials = 8000,
  seed = 12345
): EquityResult {
  const rng = makeRng(seed);
  const blocked = new Uint8Array(52);
  for (const c of hero) blocked[c] = 1;
  for (const c of board) blocked[c] = 1;

  // Card removal: if you hold the ace of spades, your opponent cannot. Dropping
  // the impossible combos up front matters more than people expect - it's why
  // holding an ace meaningfully lowers the chance they hold one too.
  const combos = villainRange.filter((c) => !blocked[c[0]] && !blocked[c[1]]);
  if (combos.length === 0) {
    return { equity: 0, win: 0, tie: 0, lose: 0, trials: 0, exact: false, margin: 0 };
  }

  const deck = deckWithout([...hero, ...board]);
  const need = 5 - board.length;

  const hero7 = new Array<number>(7);
  const vill7 = new Array<number>(7);
  hero7[0] = hero[0];
  hero7[1] = hero[1];
  for (let i = 0; i < board.length; i++) {
    hero7[2 + i] = board[i];
    vill7[2 + i] = board[i];
  }
  const base = 2 + board.length;

  let win = 0;
  let tie = 0;
  let lose = 0;
  let sum = 0;
  let sumSq = 0;

  for (let t = 0; t < trials; t++) {
    const combo = combos[(rng() * combos.length) | 0];
    const v0 = combo[0];
    const v1 = combo[1];
    vill7[0] = v0;
    vill7[1] = v1;

    // Deal the remaining board. We shuffle cards toward the tail of the deck as
    // we pick them, which is a partial Fisher-Yates - it draws without
    // replacement in O(need) instead of reshuffling all 48 cards every trial.
    let filled = 0;
    let pos = deck.length;
    while (filled < need) {
      const j = (rng() * pos) | 0;
      const c = deck[j];
      pos--;
      deck[j] = deck[pos];
      deck[pos] = c;
      if (c === v0 || c === v1) continue; // villain holds it; can't also be on the board
      hero7[base + filled] = c;
      vill7[base + filled] = c;
      filled++;
    }

    const h = evaluate(hero7);
    const v = evaluate(vill7);
    let value: number;
    if (h > v) {
      win++;
      value = 1;
    } else if (h < v) {
      lose++;
      value = 0;
    } else {
      tie++;
      value = 0.5;
    }
    sum += value;
    sumSq += value * value;
  }

  const mean = sum / trials;
  const variance = Math.max(0, sumSq / trials - mean * mean);
  // 1.96 standard errors is the usual 95% confidence interval.
  const margin = 1.96 * Math.sqrt(variance / trials);

  return {
    equity: mean,
    win: win / trials,
    tie: tie / trials,
    lose: lose / trials,
    trials,
    exact: false,
    margin,
  };
}

/**
 * The convenient front door: give it whatever you know and it picks the right
 * method. Exact when exact is cheap, sampled when it isn't.
 */
export function equity(
  hero: Card[],
  villain: Card[] | Card[][],
  board: Card[],
  opts: { trials?: number; seed?: number; forceExact?: boolean } = {}
): EquityResult {
  const isRange = Array.isArray(villain[0]);
  if (!isRange) return exactEquity(hero, villain as Card[], board);
  const range = villain as Card[][];
  if (range.length === 1) return exactEquity(hero, range[0], board);
  return rangeEquity(hero, range, board, opts.trials ?? 8000, opts.seed ?? 12345);
}

/**
 * OUTS - the cards that rescue you.
 *
 * If you're behind right now, an "out" is a single card that would put you in
 * front. Counting outs is the first real skill a poker player learns, because
 * it converts a vague feeling ("I might hit my flush") into a number you can
 * compare against the price you're being asked to pay.
 *
 * We compute them honestly: try all remaining cards one at a time and check
 * which ones flip you from losing to winning.
 */
export function findOuts(hero: Card[], villain: Card[], board: Card[]): Card[] {
  const deck = deckWithout([...hero, ...villain, ...board]);
  const behindNow = evaluate([...hero, ...board]) < evaluate([...villain, ...board]);
  if (!behindNow) return [];
  const outs: Card[] = [];
  for (const c of deck) {
    const nb = [...board, c];
    if (evaluate([...hero, ...nb]) > evaluate([...villain, ...nb])) outs.push(c);
  }
  return outs;
}

/**
 * The "rule of 2 and 4" - the shortcut every poker book teaches.
 *
 * Multiply your outs by 2 for the chance of hitting on the next card, or by 4
 * for the chance of hitting by the river. It's mental arithmetic you can do at
 * a live table in two seconds.
 *
 * We show it side by side with the exact number in the trainer, on purpose. The
 * shortcut is very good for small numbers of outs and drifts high as outs grow
 * (with 15 outs it overshoots by about 5 points). Seeing where your shortcut
 * breaks is more useful than being told to trust it.
 */
export function ruleOf2And4(outs: number, cardsToCome: number): number {
  return Math.min(1, (outs * (cardsToCome === 2 ? 4 : 2)) / 100);
}

/** The true probability of hitting at least one of your outs. */
export function exactOutProbability(outs: number, unseen: number, cardsToCome: number): number {
  if (cardsToCome === 1) return outs / unseen;
  const missBoth = ((unseen - outs) / unseen) * ((unseen - outs - 1) / (unseen - 1));
  return 1 - missBoth;
}

/* ------------------------------------------------------------------ *
 * POT ODDS AND BET SIZING
 *
 * This block is the math behind "should I call?" and "how much should I bet?".
 * Every one of these is a one-line formula, and together they cover most of
 * what separates a losing player from a break-even one.
 * ------------------------------------------------------------------ */

/**
 * How often you need to win for a call to break even.
 *
 * If there's $100 in the pot and they bet $50, you're paying $50 to win $150,
 * so you need to be right 50/150 = 33% of the time. Compare that to your actual
 * equity: more, call; less, fold. That comparison is the single most valuable
 * habit in poker.
 */
export function requiredEquity(toCall: number, potBeforeCall: number): number {
  if (toCall <= 0) return 0;
  return toCall / (potBeforeCall + toCall);
}

/**
 * MINIMUM DEFENSE FREQUENCY - how often you have to keep fighting.
 *
 * If you fold too often against bets, your opponent can bet every single hand
 * and profit with garbage. MDF is the fold rate that makes their pure bluffs
 * exactly break even. Against a half-pot bet you must continue with about 67%
 * of your hands; against a pot-sized bet, only 50%.
 *
 * This is why big bets let people bluff more: they buy the right to be wrong
 * more often.
 */
export function minimumDefenseFrequency(bet: number, potBeforeBet: number): number {
  return potBeforeBet / (potBeforeBet + bet);
}

/**
 * How often a bluff has to work to be free.
 *
 * Bet half pot and it needs to work 33% of the time. Bet the pot and it needs
 * to work 50%. This is the same formula as required equity, seen from the other
 * side of the table.
 */
export function bluffBreakEven(bet: number, potBeforeBet: number): number {
  return bet / (potBeforeBet + bet);
}

export interface BetSizeInfo {
  label: string;
  fraction: number;
  amount: number;
  /** What share of hands the opponent must keep playing to not be exploited. */
  mdf: number;
  /** How often this bet has to work as a pure bluff. */
  bluffBreakEven: number;
}

export const STANDARD_SIZINGS: Array<{ label: string; fraction: number }> = [
  { label: '1/4 pot', fraction: 0.25 },
  { label: '1/3 pot', fraction: 0.333 },
  { label: '1/2 pot', fraction: 0.5 },
  { label: '2/3 pot', fraction: 0.667 },
  { label: '3/4 pot', fraction: 0.75 },
  { label: 'Pot', fraction: 1.0 },
  { label: 'Overbet 1.5x', fraction: 1.5 },
];

/** Build the sizing menu the UI shows, with the theory attached to each option. */
export function sizingOptions(pot: number, maxBet: number): BetSizeInfo[] {
  return STANDARD_SIZINGS.map(({ label, fraction }) => {
    const amount = Math.min(maxBet, Math.round(pot * fraction));
    return {
      label,
      fraction,
      amount,
      mdf: minimumDefenseFrequency(amount, pot),
      bluffBreakEven: bluffBreakEven(amount, pot),
    };
  }).filter((s) => s.amount > 0);
}

/**
 * The version the live interface calls on every redraw.
 *
 * Exact preflop enumeration takes about 200ms - fine for a script, but it would
 * visibly stutter the UI if it ran on every click. After the flop there are at
 * most 990 futures, so exact is instant and we always use it. Before the flop we
 * sample, seeded off the actual cards so the same situation always shows the
 * same number rather than flickering.
 */
export function fastEquity(hero: Card[], villain: Card[], board: Card[]): EquityResult {
  if (board.length >= 3) return exactEquity(hero, villain, board);
  const seed = hero[0] * 53 + hero[1] * 7 + villain[0] * 3 + villain[1] + 1;
  return rangeEquity(hero, [villain], board, 25000, seed);
}
