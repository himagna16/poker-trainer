/**
 * testing.ts - build a specific poker situation directly.
 *
 * Playing our way into an exact spot would take thousands of random hands, so
 * for tests and drills we assemble the state by hand instead: deal a normal
 * hand, then overwrite the cards, stacks and bets with what we want. Everything
 * downstream - legal actions, side pots, grading - then behaves exactly as it
 * would in a real hand.
 */

import { newHand } from './engine';
import type { HandState, Street } from './engine';
import { parseCards, deckWithout } from './cards';
import type { Card } from './cards';
import { getPersona } from './bots';
import type { Lineup } from './grade';
import { newRangeBook, topPercentRange, removeBlocked } from './ranges';
import type { RangeBook } from './ranges';

export interface SpotSpec {
  playerCount: number;
  heroSeat?: number;
  button?: number;
  /** Hole cards by seat, written as "AsKd". Missing seats get random cards. */
  holes: Record<number, string>;
  board?: string;
  /** Total chips each seat has put in this hand. */
  invested: number[];
  /** Chips each seat has put in on the current street. */
  committed?: number[];
  folded?: boolean[];
  street: Street;
  toAct: number;
  startingStack?: number;
  bigBlind?: number;
}

export function buildSpot(spec: SpotSpec): HandState {
  const n = spec.playerCount;
  const stack0 = spec.startingStack ?? 200;
  const s = newHand({
    playerCount: n,
    startingStack: stack0,
    button: spec.button ?? 0,
    bigBlind: spec.bigBlind ?? 2,
    seed: 1234,
  });

  const board = spec.board ? parseCards(spec.board) : [];
  const used: Card[] = [...board];
  for (const key of Object.keys(spec.holes)) {
    const cards = parseCards(spec.holes[Number(key)]);
    s.hole[Number(key)] = cards;
    used.push(...cards);
  }
  // Any seat we didn't specify gets whatever is left, so the deck stays legal.
  const spare = deckWithout(used);
  let si = 0;
  for (let seat = 0; seat < n; seat++) {
    if (spec.holes[seat] === undefined) {
      s.hole[seat] = [spare[si++], spare[si++]];
    }
  }

  s.board = board;
  s.street = spec.street;
  s.invested = [...spec.invested];
  s.committed = spec.committed ? [...spec.committed] : new Array(n).fill(0);
  s.folded = spec.folded ? [...spec.folded] : new Array(n).fill(false);
  s.allIn = new Array(n).fill(false);
  s.acted = new Array(n).fill(false);
  s.frozen = new Array(n).fill(false);
  s.stack = spec.invested.map((v) => stack0 - v);
  s.pot = spec.invested.reduce((a, b) => a + b, 0);
  s.betToMatch = Math.max(...s.committed);
  s.lastRaiseSize = s.bigBlind;
  s.toAct = spec.toAct;
  s.complete = false;
  s.result = null;
  s.log = [];

  const dealt: Card[] = [];
  for (const h of s.hole) dealt.push(...h);
  s.deck = [...dealt, ...board, ...deckWithout([...dealt, ...board])];
  s.deckPos = dealt.length + board.length;
  return s;
}

/** Everyone except the hero plays the given style. */
export function uniformLineup(playerCount: number, heroSeat: number, personaId: string): Lineup {
  return Array.from({ length: playerCount }, (_, seat) =>
    seat === heroSeat ? null : getPersona(personaId)
  );
}

/** Give every opponent the same range, as a share of all starting hands. */
export function uniformBook(
  state: HandState,
  heroSeat: number,
  topPercent: number
): RangeBook {
  const dead = [...state.hole[heroSeat], ...state.board];
  const range = removeBlocked(topPercentRange(topPercent), dead);
  return Array.from({ length: state.playerCount }, (_, seat) =>
    seat === heroSeat ? [] : range
  );
}

export { newRangeBook };
