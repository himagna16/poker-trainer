/**
 * engine.ts - the rules of No-Limit Texas Hold'em, for two to nine players.
 *
 * This file knows nothing about odds, bots, or the interface. It only knows
 * what is legal, whose turn it is, and who wins. Keeping it that strict is what
 * lets us reuse it three ways: the table you play on, the drills, and the
 * thousands of invisible simulated hands used to grade your decisions.
 *
 * Two parts of this are genuinely hard, and both are where real poker software
 * tends to have bugs:
 *
 *  1. SIDE POTS. If someone is all in for less than everyone else, they can
 *     only win the part of the pot they actually matched. The rest becomes a
 *     separate pot that only the remaining players can win. Get this wrong and
 *     chips appear or vanish. See buildPots().
 *
 *  2. THE HEADS-UP INVERSION. With exactly two players the button posts the
 *     SMALL blind and acts FIRST before the flop, then LAST on every street
 *     after it. This is a real rule, not a special case we invented, and it is
 *     the most commonly miscoded thing in poker engines. Rather than branching
 *     on player count everywhere, we chose formulas below that produce the
 *     right answer for two players on their own.
 */

import type { Card } from './cards';
import { makeDeck, shuffle, makeRng, cardsToString } from './cards';
import { evaluate, describeHand } from './evaluator';

export type Street = 0 | 1 | 2 | 3;
export const STREET_NAMES = ['Preflop', 'Flop', 'Turn', 'River'] as const;
/** How many cards are face up on each street. */
export const STREET_BOARD_SIZE = [0, 3, 4, 5] as const;

export type ActionType = 'fold' | 'check' | 'call' | 'bet' | 'raise';

export interface Action {
  type: ActionType;
  /** For bet/raise this is the TOTAL you're moving to this street, not the increment. */
  amount?: number;
}

export interface LegalAction {
  type: ActionType;
  amount: number;
  label: string;
  /** For bet/raise, the legal window a slider may cover. */
  min?: number;
  max?: number;
}

export interface LogEntry {
  street: Street;
  kind: 'blind' | 'action' | 'deal' | 'result';
  seat?: number;
  text: string;
}

/**
 * Seat labels by distance from the button.
 *
 * Index 0 is the button itself, so the seat holding label `i` is
 * `(button + i) % playerCount`. Short tables simply drop the early seats,
 * which is exactly what happens at a real table as players leave.
 */
const POSITION_LABELS: Record<number, string[]> = {
  2: ['BTN', 'BB'],
  3: ['BTN', 'SB', 'BB'],
  4: ['BTN', 'SB', 'BB', 'CO'],
  5: ['BTN', 'SB', 'BB', 'UTG', 'CO'],
  6: ['BTN', 'SB', 'BB', 'UTG', 'HJ', 'CO'],
  7: ['BTN', 'SB', 'BB', 'UTG', 'MP', 'HJ', 'CO'],
  8: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'HJ', 'CO'],
  9: ['BTN', 'SB', 'BB', 'UTG', 'UTG+1', 'MP', 'LJ', 'HJ', 'CO'],
};

export const POSITION_FULL_NAMES: Record<string, string> = {
  BTN: 'Button',
  SB: 'Small blind',
  BB: 'Big blind',
  UTG: 'Under the gun',
  'UTG+1': 'Under the gun + 1',
  MP: 'Middle position',
  LJ: 'Lojack',
  HJ: 'Hijack',
  CO: 'Cutoff',
};

export interface Pot {
  amount: number;
  /** Seats still in the hand that are allowed to win this pot. */
  eligible: number[];
  /** False for the main pot, true for anything created by a short all-in. */
  isSide: boolean;
}

export interface PotAward {
  pot: Pot;
  winners: number[];
  perWinner: number;
}

export interface HandResult {
  /** Every pot and who took it. Usually one entry; more when someone was all in for less. */
  awards: PotAward[];
  /** Net chip change per seat across the whole hand. Always sums to zero. */
  net: number[];
  showdown: boolean;
  /** Hand descriptions for seats that reached showdown; empty string otherwise. */
  handDescriptions: string[];
}

export interface HandState {
  playerCount: number;
  stack: number[];
  /** Stacks before the blinds went in, so we can report net win/loss. */
  startStack: number[];
  hole: Card[][];
  /** Chips put in on the CURRENT street. Reset each street. */
  committed: number[];
  /** Chips put in across the whole hand. This is what side pots are built from. */
  invested: number[];
  folded: boolean[];
  allIn: boolean[];
  /** Has this seat acted since the last bet or raise? */
  acted: boolean[];
  /**
   * Set when a player faces an all-in raise too small to count as a full raise.
   * They may call or fold but not re-raise - a real rule that stops a tiny
   * all-in from reopening a betting round that was effectively closed.
   */
  frozen: boolean[];

  button: number;
  street: Street;
  board: Card[];
  /** Everything in the middle, including the current street's bets. */
  pot: number;
  toAct: number;
  /** The highest amount committed by anyone this street. */
  betToMatch: number;
  /** Size of the last full raise, used to enforce the minimum re-raise. */
  lastRaiseSize: number;
  bigBlind: number;
  smallBlind: number;

  deck: Card[];
  deckPos: number;

  complete: boolean;
  result: HandResult | null;
  log: LogEntry[];
}

export interface HandConfig {
  playerCount?: number;
  stacks?: number[];
  /** Used for every seat when `stacks` is omitted. */
  startingStack?: number;
  button?: number;
  bigBlind?: number;
  seed?: number;
}

/* ------------------------------------------------------------------ *
 * Positions
 * ------------------------------------------------------------------ */

/** How many seats clockwise this seat sits from the button. */
export function seatsFromButton(state: HandState, seat: number): number {
  return (seat - state.button + state.playerCount) % state.playerCount;
}

/** Short label: BTN, CO, UTG and so on. */
export function positionLabel(state: HandState, seat: number): string {
  const labels = POSITION_LABELS[state.playerCount] ?? POSITION_LABELS[9];
  return labels[seatsFromButton(state, seat)] ?? `Seat ${seat + 1}`;
}

export function positionName(state: HandState, seat: number): string {
  return POSITION_FULL_NAMES[positionLabel(state, seat)] ?? positionLabel(state, seat);
}

export function smallBlindSeat(state: HandState): number {
  // With two players the button IS the small blind. With three or more it's the
  // seat to the button's left.
  return state.playerCount === 2 ? state.button : (state.button + 1) % state.playerCount;
}

export function bigBlindSeat(state: HandState): number {
  return state.playerCount === 2
    ? (state.button + 1) % 2
    : (state.button + 2) % state.playerCount;
}

/**
 * How good this seat's position is, from 0 (worst) to 1 (best).
 *
 * Two different things both count as "position", and they don't agree:
 *
 *   BEFORE THE FLOP, what matters is how many players still have to act behind
 *   you. The small blind is nearly last to speak, so on that measure it looks
 *   great.
 *
 *   AFTER THE FLOP, the order flips: the small blind acts FIRST on every
 *   remaining street and the button acts LAST. That's three streets of acting
 *   blind versus three streets of acting with full information.
 *
 * The button is the best seat in poker precisely because it wins on the measure
 * that matters more. So we blend the two, weighted toward the preflop count for
 * the immediate decision but with enough postflop weight that the button ends
 * up opening widest - which is what every real chart does.
 */
export function positionQuality(state: HandState, seat: number): number {
  const n = state.playerCount;
  if (n <= 2) return seat === state.button ? 0.75 : 0.35;

  // Preflop: how few players speak after you.
  const behind = (bigBlindSeat(state) - seat + n) % n;
  const preflop = 1 - behind / (n - 1);

  // Postflop: distance from the button, where the button acts last and the
  // small blind acts first.
  const fromButton = seatsFromButton(state, seat);
  const postflop = fromButton === 0 ? 1 : (fromButton - 1) / (n - 1);

  return 0.65 * preflop + 0.35 * postflop;
}

/** @deprecated kept as an alias while callers migrate. */
export const preflopLateness = positionQuality;

export function livePlayers(state: HandState): number[] {
  const out: number[] = [];
  for (let i = 0; i < state.playerCount; i++) if (!state.folded[i]) out.push(i);
  return out;
}

/** Seats that still have chips and a decision left to make. */
export function actablePlayers(state: HandState): number[] {
  const out: number[] = [];
  for (let i = 0; i < state.playerCount; i++) {
    if (!state.folded[i] && !state.allIn[i]) out.push(i);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Dealing
 * ------------------------------------------------------------------ */

export function newHand(config: HandConfig = {}): HandState {
  // Infer the table size from explicit stacks when they're given, so a caller
  // can't accidentally hand us six seats' worth of state and two stacks.
  const playerCount = Math.max(2, Math.min(9, config.playerCount ?? config.stacks?.length ?? 6));
  const bigBlind = config.bigBlind ?? 2;
  const smallBlind = Math.max(1, Math.floor(bigBlind / 2));
  const startingStack = config.startingStack ?? 200;
  const stacks = config.stacks ?? new Array(playerCount).fill(startingStack);
  if (stacks.length !== playerCount) {
    throw new Error(`newHand: ${stacks.length} stacks given for ${playerCount} players`);
  }
  const button = (config.button ?? 0) % playerCount;
  const seed = config.seed ?? Math.floor(Math.random() * 2 ** 31);

  const deck = shuffle(makeDeck(), makeRng(seed));

  const state: HandState = {
    playerCount,
    stack: [...stacks],
    startStack: [...stacks],
    hole: [],
    committed: new Array(playerCount).fill(0),
    invested: new Array(playerCount).fill(0),
    folded: new Array(playerCount).fill(false),
    allIn: new Array(playerCount).fill(false),
    acted: new Array(playerCount).fill(false),
    frozen: new Array(playerCount).fill(false),
    button,
    street: 0,
    board: [],
    pot: 0,
    toAct: 0,
    betToMatch: 0,
    lastRaiseSize: bigBlind,
    bigBlind,
    smallBlind,
    deck,
    deckPos: 0,
    complete: false,
    result: null,
    log: [],
  };

  // Seat i takes deck[2i] and deck[2i+1]; the board starts right after. Fixing
  // the layout like this lets the grader rebuild a deck from a known position
  // when it replays the hand.
  for (let i = 0; i < playerCount; i++) {
    state.hole.push([deck[state.deckPos++], deck[state.deckPos++]]);
  }

  post(state, smallBlindSeat(state), smallBlind, 'small blind');
  post(state, bigBlindSeat(state), bigBlind, 'big blind');
  state.betToMatch = bigBlind;

  // Posting a blind is forced, not a decision, so nobody counts as having acted.
  // That's what gives the big blind the option to raise when everyone limps.
  state.acted.fill(false);

  // Preflop, action starts to the big blind's left. With two players that
  // formula lands back on the button, which is exactly right.
  const first = nextActor(state, bigBlindSeat(state));
  state.toAct = first < 0 ? bigBlindSeat(state) : first;
  return state;
}

function contribute(state: HandState, seat: number, amount: number): number {
  const put = Math.max(0, Math.min(amount, state.stack[seat]));
  state.stack[seat] -= put;
  state.committed[seat] += put;
  state.invested[seat] += put;
  state.pot += put;
  if (state.stack[seat] === 0) state.allIn[seat] = true;
  return put;
}

function post(state: HandState, seat: number, amount: number, label: string): void {
  const put = contribute(state, seat, amount);
  state.log.push({
    street: 0,
    kind: 'blind',
    seat,
    text: `${positionLabel(state, seat)} posts ${label} ${put}`,
  });
}

/** Next seat clockwise that still has a decision to make, or -1 if none. */
function nextActor(state: HandState, from: number): number {
  for (let i = 1; i <= state.playerCount; i++) {
    const seat = (from + i) % state.playerCount;
    if (!state.folded[seat] && !state.allIn[seat]) return seat;
  }
  return -1;
}

/* ------------------------------------------------------------------ *
 * Legal actions
 * ------------------------------------------------------------------ */

export function toCall(state: HandState, seat: number): number {
  return Math.max(0, Math.min(state.betToMatch - state.committed[seat], state.stack[seat]));
}

/**
 * The largest bet worth making.
 *
 * You can never win more than an opponent is able to lose, so there's no point
 * betting beyond what the richest remaining player could call. Anything above
 * that just gets handed straight back at showdown.
 */
export function maxUsefulBet(state: HandState, seat: number): number {
  const mine = state.committed[seat] + state.stack[seat];
  let richestOpponent = 0;
  for (let i = 0; i < state.playerCount; i++) {
    if (i === seat || state.folded[i]) continue;
    richestOpponent = Math.max(richestOpponent, state.committed[i] + state.stack[i]);
  }
  return Math.min(mine, Math.max(richestOpponent, state.betToMatch));
}

export function legalActions(state: HandState): LegalAction[] {
  if (state.complete || state.toAct < 0) return [];
  const seat = state.toAct;
  const need = toCall(state, seat);
  const out: LegalAction[] = [];

  if (need > 0) {
    out.push({ type: 'fold', amount: 0, label: 'Fold' });
    const callAmount = Math.min(need, state.stack[seat]);
    out.push({
      type: 'call',
      amount: callAmount,
      label: callAmount >= state.stack[seat] ? `Call ${callAmount} (all in)` : `Call ${callAmount}`,
    });
  } else {
    out.push({ type: 'check', amount: 0, label: 'Check' });
  }

  // A raise must be at least as large as the last one. Without that rule you
  // could raise a single chip forever and the hand would never end.
  const max = maxUsefulBet(state, seat);
  const minTo = Math.min(max, state.betToMatch + Math.max(state.lastRaiseSize, state.bigBlind));
  const canAggress = !state.frozen[seat] && state.stack[seat] > need && max > state.betToMatch;

  if (canAggress) {
    const isRaise = state.betToMatch > 0;
    out.push({
      type: isRaise ? 'raise' : 'bet',
      amount: minTo,
      label: isRaise ? `Raise to ${minTo}` : `Bet ${minTo}`,
      min: minTo,
      max,
    });
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Applying actions
 * ------------------------------------------------------------------ */

export function cloneState(state: HandState): HandState {
  return {
    ...state,
    stack: [...state.stack],
    startStack: state.startStack,
    hole: state.hole.map((h) => [...h]),
    committed: [...state.committed],
    invested: [...state.invested],
    folded: [...state.folded],
    allIn: [...state.allIn],
    acted: [...state.acted],
    frozen: [...state.frozen],
    board: [...state.board],
    deck: state.deck,
    log: state.log,
    result: state.result,
  };
}

/** Copy-on-write so cloned states don't scribble on their parent's log. */
function pushLog(state: HandState, entry: LogEntry): void {
  state.log = [...state.log, entry];
}

/**
 * Apply an action and return the resulting state. The input is left untouched,
 * which is what makes "try every action and see what happens" - the heart of
 * the grader - safe to do thousands of times.
 */
export function applyAction(state: HandState, action: Action): HandState {
  if (state.complete) return state;
  const s = cloneState(state);
  const seat = s.toAct;
  const need = toCall(s, seat);

  switch (action.type) {
    case 'fold': {
      s.folded[seat] = true;
      s.acted[seat] = true;
      pushLog(s, { street: s.street, kind: 'action', seat, text: `${positionLabel(s, seat)} folds` });
      break;
    }
    case 'check': {
      if (need > 0) throw new Error('Cannot check facing a bet');
      s.acted[seat] = true;
      pushLog(s, { street: s.street, kind: 'action', seat, text: `${positionLabel(s, seat)} checks` });
      break;
    }
    case 'call': {
      const put = contribute(s, seat, need);
      s.acted[seat] = true;
      pushLog(s, {
        street: s.street, kind: 'action', seat,
        text: `${positionLabel(s, seat)} calls ${put}${s.allIn[seat] ? ' and is all in' : ''}`,
      });
      break;
    }
    case 'bet':
    case 'raise': {
      const target = Math.min(action.amount ?? 0, s.committed[seat] + s.stack[seat]);
      const put = target - s.committed[seat];
      if (put <= 0 || put > s.stack[seat]) throw new Error(`Illegal raise to ${target}`);
      const raiseSize = target - s.betToMatch;
      contribute(s, seat, put);

      // An all-in for less than a full raise does NOT reopen betting for anyone
      // who has already acted - they may call or fold, but not re-raise. Players
      // who have not spoken yet are unaffected.
      const isFullRaise = raiseSize >= Math.max(s.lastRaiseSize, s.bigBlind);
      if (isFullRaise) s.lastRaiseSize = raiseSize;

      s.betToMatch = target;
      s.acted[seat] = true;
      for (let i = 0; i < s.playerCount; i++) {
        if (i === seat || s.folded[i] || s.allIn[i]) continue;
        if (s.committed[i] < s.betToMatch) {
          if (!isFullRaise && s.acted[i]) s.frozen[i] = true;
          s.acted[i] = false;
        }
      }
      pushLog(s, {
        street: s.street, kind: 'action', seat,
        text: `${positionLabel(s, seat)} ${action.type === 'bet' ? 'bets' : 'raises to'} ${target}` +
          `${s.allIn[seat] ? ' and is all in' : ''}`,
      });
      break;
    }
  }

  // Everyone else folded - the last player standing takes it without showing.
  if (livePlayers(s).length === 1) return settle(s, false);

  if (bettingRoundComplete(s)) return closeStreet(s);

  const next = nextActor(s, seat);
  if (next < 0) return closeStreet(s);
  s.toAct = next;
  return s;
}

function bettingRoundComplete(s: HandState): boolean {
  const live = livePlayers(s);
  if (live.length <= 1) return true;
  const canAct = actablePlayers(s);
  if (canAct.length === 0) return true;
  return canAct.every((i) => s.acted[i] && s.committed[i] === s.betToMatch);
}

function closeStreet(s: HandState): HandState {
  s.committed = new Array(s.playerCount).fill(0);
  s.acted = new Array(s.playerCount).fill(false);
  s.frozen = new Array(s.playerCount).fill(false);
  s.betToMatch = 0;
  s.lastRaiseSize = s.bigBlind;

  // If at most one player can still act, nobody has decisions left. Run the rest
  // of the board out and show down.
  if (s.street === 3 || actablePlayers(s).length <= 1) {
    while (s.board.length < 5) s.board = [...s.board, s.deck[s.deckPos++]];
    return settle(s, true);
  }

  s.street = (s.street + 1) as Street;
  while (s.board.length < STREET_BOARD_SIZE[s.street]) {
    s.board = [...s.board, s.deck[s.deckPos++]];
  }
  pushLog(s, {
    street: s.street, kind: 'deal',
    text: `${STREET_NAMES[s.street]}: ${cardsToString(s.board)}`,
  });

  // After the flop, action starts to the button's left, so the button always
  // speaks last. With two players that lands on the big blind, which is right.
  const first = nextActor(s, s.button);
  if (first < 0) return settle(s, true);
  s.toAct = first;
  return s;
}

/* ------------------------------------------------------------------ *
 * Side pots
 * ------------------------------------------------------------------ */

/**
 * Split the money into pots that the right people can win.
 *
 * WHY THIS IS NEEDED. Three players: you put in 200, I put in 200, and someone
 * short shoves for 50. They can only win 50 from each of us - 150 in total. The
 * other 300 is ours to fight over and they have no claim on it at all. So the
 * money has to be cut into layers.
 *
 * THE METHOD. Look at the distinct amounts people put in - here 50 and 200 -
 * and walk them from smallest up. Each level forms one pot containing that
 * slice from everyone who reached it. Anyone who put in at least that much and
 * has not folded can win it.
 *
 * Folded players' chips still go into the pots; they just cannot win any.
 *
 * This also handles uncalled bets with no extra code. If you bet 100 and
 * everyone folds, you're the only player eligible for the top layer, so it
 * comes straight back to you.
 */
export function buildPots(invested: number[], folded: boolean[]): Pot[] {
  const levels = [...new Set(invested.filter((v) => v > 0))].sort((a, b) => a - b);
  const pots: Pot[] = [];
  let previous = 0;

  for (const level of levels) {
    let amount = 0;
    const eligible: number[] = [];
    for (let i = 0; i < invested.length; i++) {
      // This player's slice of the band between `previous` and `level`.
      amount += Math.min(invested[i], level) - Math.min(invested[i], previous);
      if (invested[i] >= level && !folded[i]) eligible.push(i);
    }
    if (amount > 0) pots.push({ amount, eligible, isSide: pots.length > 0 });
    previous = level;
  }

  // Consecutive layers with identical eligibility are really one pot. Merging
  // them keeps the display honest - players should see "pot 340", not three
  // separate pots that nobody can tell apart.
  const merged: Pot[] = [];
  for (const pot of pots) {
    const last = merged[merged.length - 1];
    if (last && sameSeats(last.eligible, pot.eligible)) last.amount += pot.amount;
    else merged.push({ ...pot, isSide: merged.length > 0 });
  }
  return merged;
}

function sameSeats(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * Work out who wins what, move the chips, and close the hand.
 *
 * `showdown` is false when everyone folded - nobody has to reveal anything, so
 * we skip evaluating hands entirely.
 */
function settle(s: HandState, showdown: boolean): HandState {
  const pots = buildPots(s.invested, s.folded);
  const awards: PotAward[] = [];
  const descriptions = new Array<string>(s.playerCount).fill('');

  const scores = new Array<number>(s.playerCount).fill(-1);
  if (showdown) {
    for (const seat of livePlayers(s)) {
      scores[seat] = evaluate([...s.hole[seat], ...s.board]);
      descriptions[seat] = describeHand(scores[seat]);
    }
  }

  for (const pot of pots) {
    const contenders = pot.eligible.filter((i) => !s.folded[i]);
    if (contenders.length === 0) continue;

    let winners: number[];
    if (!showdown || contenders.length === 1) {
      winners = [contenders[0]];
    } else {
      const best = Math.max(...contenders.map((i) => scores[i]));
      winners = contenders.filter((i) => scores[i] === best);
    }

    const perWinner = Math.floor(pot.amount / winners.length);
    let remainder = pot.amount - perWinner * winners.length;
    for (const seat of winners) s.stack[seat] += perWinner;

    // Odd chips that won't divide evenly go to the first winner clockwise from
    // the button, which is what a real dealer does.
    const ordered = [...winners].sort(
      (a, b) => seatsFromButton(s, a) - seatsFromButton(s, b)
    );
    let idx = 0;
    while (remainder > 0) {
      s.stack[ordered[idx % ordered.length]] += 1;
      remainder--;
      idx++;
    }

    awards.push({ pot, winners, perWinner });
  }

  s.complete = true;
  s.toAct = -1;
  s.result = {
    awards,
    net: s.stack.map((v, i) => v - s.startStack[i]),
    showdown,
    handDescriptions: descriptions,
  };

  for (const award of awards) {
    const names = award.winners.map((w) => positionLabel(s, w)).join(' and ');
    pushLog(s, {
      street: s.street,
      kind: 'result',
      text: showdown
        ? `${names} ${award.winners.length > 1 ? 'split' : 'wins'} ${award.pot.amount}` +
          `${award.pot.isSide ? ' (side pot)' : ''}` +
          (descriptions[award.winners[0]] ? ` with ${descriptions[award.winners[0]]}` : '')
        : `${names} wins ${award.pot.amount} (everyone folded)`,
    });
  }
  return s;
}

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** Chips gained or lost this hand, per seat. Always sums to zero. */
export function netResult(s: HandState): number[] {
  return s.stack.map((v, i) => v - s.startStack[i]);
}

/**
 * Re-randomize every card nobody has seen yet.
 *
 * When we grade a decision we replay the hand from this point thousands of
 * times. If the deck kept its order every replay would deal the same board and
 * we would learn nothing. This reshuffles only the undealt cards, leaving hole
 * cards and the visible board exactly as they are.
 */
export function reshuffleUnseen(s: HandState, rng: () => number): void {
  const tail = s.deck.slice(s.deckPos);
  shuffle(tail, rng);
  s.deck = [...s.deck.slice(0, s.deckPos), ...tail];
}

/** The smallest stack among players still in the hand. */
export function effectiveStack(s: HandState): number {
  const live = livePlayers(s);
  if (live.length === 0) return 0;
  return Math.min(...live.map((i) => s.stack[i] + s.committed[i]));
}

export function inBB(chips: number, bigBlind: number): number {
  return chips / bigBlind;
}

/** Current pot layers, for display while the hand is still running. */
export function currentPots(s: HandState): Pot[] {
  return buildPots(s.invested, s.folded);
}
