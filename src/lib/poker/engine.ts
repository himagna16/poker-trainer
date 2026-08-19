/**
 * engine.ts - the rules of heads-up No-Limit Texas Hold'em.
 *
 * This file knows nothing about odds, bots, or the interface. It only knows
 * what is legal, whose turn it is, and who wins. Keeping it that strict is what
 * lets us reuse it three different ways: the table you play on, the drills, and
 * the thousands of invisible simulated hands we run to grade your decisions.
 *
 * WHY HEADS-UP (one opponent) FOR VERSION ONE:
 * Two things get dramatically simpler. There's only ever one pot - with three
 * or more players and different stack sizes you need "side pots", which is the
 * single fiddliest piece of poker rules code. And the decision tree is small
 * enough that we can actually simulate it forward to grade your play, which is
 * the whole point of the app.
 *
 * THE HEADS-UP BLIND RULE PEOPLE ALWAYS GET WRONG:
 * With two players, the button posts the SMALL blind and acts FIRST before the
 * flop - then acts LAST on every street after it. That inversion is not a typo,
 * it's the actual rule, and it's the reason the button is such a strong seat.
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

export interface HandResult {
  /** 0 or 1, or -1 for a split pot. */
  winner: number;
  potWon: number;
  /** Net chip change for each seat over the whole hand. */
  net: [number, number];
  showdown: boolean;
  handDescriptions?: [string, string];
}

export interface HandState {
  stack: number[];
  /** Stacks as they were before the blinds went in, so we can report net win/loss. */
  startStack: number[];
  hole: Card[][];
  /** Chips put in on the CURRENT street. Reset each street. */
  committed: number[];
  /** Chips put in across the whole hand. */
  invested: number[];
  folded: boolean[];
  allIn: boolean[];
  /** Has this seat acted since the last bet or raise? */
  acted: boolean[];

  button: number;
  street: Street;
  board: Card[];
  /** Everything in the middle, including the current street's bets. */
  pot: number;
  toAct: number;
  /** The highest amount committed by anyone this street. */
  betToMatch: number;
  /** Size of the last raise, used to enforce the minimum re-raise. */
  lastRaiseSize: number;
  bigBlind: number;

  deck: Card[];
  deckPos: number;

  complete: boolean;
  result: HandResult | null;
  log: LogEntry[];
}

export interface HandConfig {
  stacks?: [number, number];
  button?: number;
  bigBlind?: number;
  seed?: number;
}

export function seatName(state: HandState, seat: number): string {
  return seat === state.button ? 'Button' : 'Big blind';
}

/** Chips this seat must put in to match the current bet. */
export function toCall(state: HandState, seat: number): number {
  return Math.max(0, Math.min(state.betToMatch - state.committed[seat], state.stack[seat]));
}

/**
 * The most this seat can meaningfully wager.
 *
 * You can never win more than your opponent is able to lose, so a bet is capped
 * at what they could still call. Capping here means we never have to hand chips
 * back mid-hand, which is what keeps us free of side-pot bookkeeping.
 */
export function maxBetTo(state: HandState, seat: number): number {
  const opp = 1 - seat;
  const mine = state.committed[seat] + state.stack[seat];
  const theirs = state.committed[opp] + state.stack[opp];
  return Math.min(mine, theirs);
}

export function newHand(config: HandConfig = {}): HandState {
  const bigBlind = config.bigBlind ?? 2;
  const smallBlind = Math.floor(bigBlind / 2);
  const stacks = config.stacks ?? [200, 200];
  const button = config.button ?? 0;
  const seed = config.seed ?? Math.floor(Math.random() * 2 ** 31);

  const deck = shuffle(makeDeck(), makeRng(seed));
  const state: HandState = {
    stack: [...stacks],
    startStack: [...stacks],
    hole: [[], []],
    committed: [0, 0],
    invested: [0, 0],
    folded: [false, false],
    allIn: [false, false],
    acted: [false, false],
    button,
    street: 0,
    board: [],
    pot: 0,
    toAct: button, // heads-up: the button acts first before the flop
    betToMatch: 0,
    lastRaiseSize: bigBlind,
    bigBlind,
    deck,
    deckPos: 0,
    complete: false,
    result: null,
    log: [],
  };

  state.hole[0] = [deck[state.deckPos++], deck[state.deckPos++]];
  state.hole[1] = [deck[state.deckPos++], deck[state.deckPos++]];

  const bb = 1 - button;
  post(state, button, smallBlind, 'small blind');
  post(state, bb, bigBlind, 'big blind');
  state.betToMatch = bigBlind;

  // Posting a blind isn't a decision, so neither player counts as having acted.
  // This is what gives the big blind the "option" to raise when the button
  // just calls - a rule that surprises people learning the game.
  state.acted = [false, false];
  return state;
}

function post(state: HandState, seat: number, amount: number, label: string): void {
  const put = Math.min(amount, state.stack[seat]);
  state.stack[seat] -= put;
  state.committed[seat] += put;
  state.invested[seat] += put;
  state.pot += put;
  if (state.stack[seat] === 0) state.allIn[seat] = true;
  state.log.push({ street: 0, kind: 'blind', seat, text: `${seatName(state, seat)} posts ${label} ${put}` });
}

/** Everything this seat is allowed to do right now. */
export function legalActions(state: HandState): LegalAction[] {
  if (state.complete) return [];
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

  // A raise has to be at least as big as the last raise. Without that rule you
  // could raise by one chip forever and the hand would never end.
  const max = maxBetTo(state, seat);
  const minTo = Math.min(max, state.betToMatch + Math.max(state.lastRaiseSize, state.bigBlind));
  const canAggress = state.stack[seat] > need && max > state.betToMatch;
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

export function cloneState(state: HandState): HandState {
  return {
    ...state,
    stack: [...state.stack],
    startStack: state.startStack,
    hole: [[...state.hole[0]], [...state.hole[1]]],
    committed: [...state.committed],
    invested: [...state.invested],
    folded: [...state.folded],
    allIn: [...state.allIn],
    acted: [...state.acted],
    board: [...state.board],
    deck: state.deck, // shared: never mutated except by reshuffleUnseen, which copies
    log: state.log,   // shared until something appends; see pushLog
    result: state.result,
  };
}

/** Copy-on-write for the log so cloned states don't scribble on their parent. */
function pushLog(state: HandState, entry: LogEntry): void {
  state.log = [...state.log, entry];
}

/**
 * Apply an action and return the resulting state. The input is left untouched,
 * which is what makes "try every action and see what happens" - the core of our
 * grading engine - safe to do thousands of times.
 */
export function applyAction(state: HandState, action: Action): HandState {
  if (state.complete) return state;
  const s = cloneState(state);
  const seat = s.toAct;
  const opp = 1 - seat;
  const need = toCall(s, seat);

  switch (action.type) {
    case 'fold': {
      s.folded[seat] = true;
      pushLog(s, { street: s.street, kind: 'action', seat, text: `${seatName(s, seat)} folds` });
      return finishByFold(s, opp);
    }
    case 'check': {
      if (need > 0) throw new Error('Cannot check facing a bet');
      s.acted[seat] = true;
      pushLog(s, { street: s.street, kind: 'action', seat, text: `${seatName(s, seat)} checks` });
      break;
    }
    case 'call': {
      const put = Math.min(need, s.stack[seat]);
      s.stack[seat] -= put;
      s.committed[seat] += put;
      s.invested[seat] += put;
      s.pot += put;
      if (s.stack[seat] === 0) s.allIn[seat] = true;
      s.acted[seat] = true;
      pushLog(s, {
        street: s.street, kind: 'action', seat,
        text: `${seatName(s, seat)} calls ${put}${s.allIn[seat] ? ' and is all in' : ''}`,
      });
      break;
    }
    case 'bet':
    case 'raise': {
      const target = Math.min(action.amount ?? 0, maxBetTo(s, seat));
      const put = target - s.committed[seat];
      if (put <= 0 || put > s.stack[seat]) throw new Error(`Illegal raise to ${target}`);
      const raiseSize = target - s.betToMatch;
      s.stack[seat] -= put;
      s.committed[seat] += put;
      s.invested[seat] += put;
      s.pot += put;
      if (s.stack[seat] === 0) s.allIn[seat] = true;
      s.lastRaiseSize = Math.max(raiseSize, s.bigBlind);
      s.betToMatch = target;
      // A raise reopens the betting: the opponent now owes another decision.
      s.acted[seat] = true;
      s.acted[opp] = false;
      pushLog(s, {
        street: s.street, kind: 'action', seat,
        text: `${seatName(s, seat)} ${action.type === 'bet' ? 'bets' : 'raises to'} ${target}${s.allIn[seat] ? ' and is all in' : ''}`,
      });
      break;
    }
  }

  if (bettingRoundComplete(s)) return closeStreet(s);
  s.toAct = opp;
  // If the opponent is already all in they have no decision left; the street is
  // over as soon as the other player has matched them.
  if (s.allIn[s.toAct]) return closeStreet(s);
  return s;
}

function bettingRoundComplete(s: HandState): boolean {
  const live = [0, 1].filter((i) => !s.folded[i]);
  if (live.length < 2) return true;
  const canStillAct = live.filter((i) => !s.allIn[i]);
  if (canStillAct.length === 0) return true;
  if (canStillAct.length === 1) {
    const i = canStillAct[0];
    return s.acted[i] && s.committed[i] >= Math.min(s.betToMatch, s.committed[i] + s.stack[i]);
  }
  return live.every((i) => s.acted[i] && s.committed[i] === s.betToMatch);
}

/** Move to the next street, or to showdown if the river is done. */
function closeStreet(s: HandState): HandState {
  s.committed = [0, 0];
  s.acted = [false, false];
  s.betToMatch = 0;
  s.lastRaiseSize = s.bigBlind;

  const someoneAllIn = s.allIn[0] || s.allIn[1];
  if (s.street === 3 || someoneAllIn) {
    // Nobody has any decisions left, so run the rest of the board and show down.
    while (s.board.length < 5) dealBoardCard(s);
    return showdown(s);
  }

  s.street = (s.street + 1) as Street;
  while (s.board.length < STREET_BOARD_SIZE[s.street]) dealBoardCard(s);
  pushLog(s, {
    street: s.street, kind: 'deal',
    text: `${STREET_NAMES[s.street]}: ${cardsToString(s.board)}`,
  });
  // After the flop the button acts LAST, so the other seat is first to speak.
  s.toAct = 1 - s.button;
  return s;
}

function dealBoardCard(s: HandState): void {
  s.board = [...s.board, s.deck[s.deckPos++]];
}

function finishByFold(s: HandState, winner: number): HandState {
  s.complete = true;
  s.stack[winner] += s.pot;
  s.result = {
    winner,
    potWon: s.pot,
    net: netResult(s),
    showdown: false,
  };
  pushLog(s, { street: s.street, kind: 'result', text: `${seatName(s, winner)} wins ${s.pot} (opponent folded)` });
  return s;
}

function showdown(s: HandState): HandState {
  const score0 = evaluate([...s.hole[0], ...s.board]);
  const score1 = evaluate([...s.hole[1], ...s.board]);
  s.complete = true;

  let winner: number;
  if (score0 > score1) winner = 0;
  else if (score1 > score0) winner = 1;
  else winner = -1;

  if (winner === -1) {
    // Odd chip goes to the seat out of position, matching casino convention.
    const half = Math.floor(s.pot / 2);
    s.stack[0] += half;
    s.stack[1] += s.pot - half;
  } else {
    s.stack[winner] += s.pot;
  }

  s.result = {
    winner,
    potWon: s.pot,
    net: netResult(s),
    showdown: true,
    handDescriptions: [describeHand(score0), describeHand(score1)],
  };
  pushLog(s, {
    street: s.street, kind: 'result',
    text: winner === -1
      ? `Split pot - both have ${describeHand(score0)}`
      : `${seatName(s, winner)} wins ${s.pot} with ${describeHand(winner === 0 ? score0 : score1)}`,
  });
  return s;
}

/**
 * Chips gained or lost this hand, per seat. Simply where you ended up versus
 * where you started. These two numbers always sum to zero - poker moves chips
 * around, it doesn't create them, and that makes a useful sanity check.
 */
export function netResult(s: HandState): [number, number] {
  return [s.stack[0] - s.startStack[0], s.stack[1] - s.startStack[1]];
}

/**
 * Re-randomize every card nobody has seen yet.
 *
 * When we grade a decision we replay the hand from this point thousands of
 * times. If the deck stayed in its original order, every replay would produce
 * the same board and we'd learn nothing. This reshuffles only the undealt
 * cards, leaving hole cards and the visible board exactly as they are.
 */
export function reshuffleUnseen(s: HandState, rng: () => number): void {
  const tail = s.deck.slice(s.deckPos);
  shuffle(tail, rng);
  s.deck = [...s.deck.slice(0, s.deckPos), ...tail];
}

/** The smaller of the two stacks - the most that can actually change hands. */
export function effectiveStack(s: HandState): number {
  return Math.min(s.stack[0] + s.committed[0], s.stack[1] + s.committed[1]);
}

/** Pot size expressed in big blinds, which is how poker players actually talk. */
export function inBB(chips: number, bigBlind: number): number {
  return chips / bigBlind;
}
