/**
 * spots.ts - freezing a decision point so it can be replayed later.
 *
 * To show you a mistake again tomorrow we have to store enough to rebuild the
 * exact situation: the cards, the money, who had folded, and - crucially - what
 * we believed each opponent was holding at the time. Without that last part the
 * replay would grade you against a completely different opponent to the one you
 * actually faced, which is worse than not replaying it at all.
 *
 * What we DON'T store is the whole game state. A HandState carries a 52-card
 * deck and a running log, and browser storage is a few megabytes in total. So
 * we keep a compact description and rebuild the rest.
 *
 * The ranges get the same treatment. A range is up to 1,326 weighted
 * combinations, but collapsed to the 169 distinct hand types it's usually a few
 * dozen entries. We lose a little card-removal precision and save roughly forty
 * times the space, which is the right trade for something stored by the hundred.
 */

import type { Card } from './cards';
import { parseCards, cardsToString, deckWithout, handNotation, RANK_CHARS, makeCard } from './cards';
import type { HandState, Street, Action, ActionType } from './engine';
import { newHand } from './engine';
import type { Lineup } from './grade';
import { getPersona } from './bots';
import type { RangeBook, WeightedRange } from './ranges';
import { removeBlocked } from './ranges';

/** A range squashed to hand types: [["AKs", 1], ["77", 0.4], ...]. */
export type PackedRange = Array<[string, number]>;

export interface SpotSnapshot {
  playerCount: number;
  button: number;
  heroSeat: number;
  bigBlind: number;
  startingStack: number;
  /** Hole cards per seat, as "AhKd". */
  holes: string[];
  board: string;
  invested: number[];
  committed: number[];
  folded: boolean[];
  allIn: boolean[];
  street: Street;
  toAct: number;
  /** Persona id per seat; null for the hero. */
  personaIds: Array<string | null>;
  /** What we believed each opponent held. Null for the hero. */
  ranges: Array<PackedRange | null>;
  /** The action that was actually taken here. */
  chosen: { type: ActionType; amount?: number };
}

/* ------------------------------------------------------------------ *
 * Ranges
 * ------------------------------------------------------------------ */

function packRange(range: WeightedRange): PackedRange {
  const totals = new Map<string, { sum: number; n: number }>();
  for (const combo of range) {
    const hand = handNotation(combo.cards[0], combo.cards[1]);
    const entry = totals.get(hand) ?? { sum: 0, n: 0 };
    entry.sum += combo.weight;
    entry.n += 1;
    totals.set(hand, entry);
  }
  const out: PackedRange = [];
  for (const [hand, { sum, n }] of totals) {
    const weight = Math.round((sum / n) * 100) / 100;
    if (weight > 0.01) out.push([hand, weight]);
  }
  return out;
}

function unpackRange(packed: PackedRange, dead: Card[]): WeightedRange {
  const weights = new Map(packed);
  const out: WeightedRange = [];
  for (let a = 0; a < 52; a++) {
    for (let b = a + 1; b < 52; b++) {
      const weight = weights.get(handNotation(a, b));
      if (weight !== undefined) out.push({ cards: [a, b], weight });
    }
  }
  return removeBlocked(out, dead);
}

/* ------------------------------------------------------------------ *
 * Building a state from a description
 * ------------------------------------------------------------------ */

export interface StateSpec {
  playerCount: number;
  button?: number;
  bigBlind?: number;
  startingStack?: number;
  /** Hole cards by seat, as "AsKd". Seats left out get whatever is spare. */
  holes: Record<number, string>;
  board?: string;
  invested: number[];
  committed?: number[];
  folded?: boolean[];
  allIn?: boolean[];
  street: Street;
  toAct: number;
}

/**
 * Assemble an exact situation directly, rather than playing our way into it.
 *
 * We deal a normal hand and then overwrite the cards, stacks and bets. Once
 * that's done everything downstream - legal actions, side pots, grading -
 * behaves exactly as it would in a hand that arrived here naturally.
 */
export function buildState(spec: StateSpec): HandState {
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
  const spare = deckWithout(used);
  let si = 0;
  for (let seat = 0; seat < n; seat++) {
    if (spec.holes[seat] === undefined) s.hole[seat] = [spare[si++], spare[si++]];
  }

  s.board = board;
  s.street = spec.street;
  s.invested = [...spec.invested];
  s.committed = spec.committed ? [...spec.committed] : new Array(n).fill(0);
  s.folded = spec.folded ? [...spec.folded] : new Array(n).fill(false);
  s.allIn = spec.allIn ? [...spec.allIn] : new Array(n).fill(false);
  s.acted = new Array(n).fill(false);
  s.frozen = new Array(n).fill(false);
  s.stack = spec.invested.map((v) => stack0 - v);
  s.pot = spec.invested.reduce((a, b) => a + b, 0);
  s.betToMatch = Math.max(0, ...s.committed);
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

/* ------------------------------------------------------------------ *
 * Capture and restore
 * ------------------------------------------------------------------ */

export function captureSpot(
  state: HandState,
  heroSeat: number,
  lineup: Lineup,
  book: RangeBook,
  chosen: Action
): SpotSnapshot {
  return {
    playerCount: state.playerCount,
    button: state.button,
    heroSeat,
    bigBlind: state.bigBlind,
    startingStack: state.startStack[heroSeat],
    holes: state.hole.map((h) => cardsToString(h)),
    board: cardsToString(state.board),
    invested: [...state.invested],
    committed: [...state.committed],
    folded: [...state.folded],
    allIn: [...state.allIn],
    street: state.street,
    toAct: state.toAct,
    personaIds: lineup.map((p) => p?.id ?? null),
    ranges: book.map((r, seat) => (seat === heroSeat || !r || r.length === 0 ? null : packRange(r))),
    chosen: { type: chosen.type, amount: chosen.amount },
  };
}

export interface RestoredSpot {
  state: HandState;
  heroSeat: number;
  lineup: Lineup;
  book: RangeBook;
  chosen: Action;
}

export function restoreSpot(snapshot: SpotSnapshot): RestoredSpot {
  const holes: Record<number, string> = {};
  snapshot.holes.forEach((h, seat) => { holes[seat] = h; });

  const state = buildState({
    playerCount: snapshot.playerCount,
    button: snapshot.button,
    bigBlind: snapshot.bigBlind,
    startingStack: snapshot.startingStack,
    holes,
    board: snapshot.board,
    invested: snapshot.invested,
    committed: snapshot.committed,
    folded: snapshot.folded,
    allIn: snapshot.allIn,
    street: snapshot.street,
    toAct: snapshot.toAct,
  });

  const dead = [...state.hole[snapshot.heroSeat], ...state.board];
  return {
    state,
    heroSeat: snapshot.heroSeat,
    lineup: snapshot.personaIds.map((id) => (id ? getPersona(id) : null)),
    book: snapshot.ranges.map((packed) => (packed ? unpackRange(packed, dead) : [])),
    chosen: snapshot.chosen,
  };
}

/** Short human label for a saved spot: "A♥K♥ · Button · Flop". */
export function describeSnapshot(snapshot: SpotSnapshot): {
  hand: string;
  street: string;
  seats: number;
} {
  const hero = parseCards(snapshot.holes[snapshot.heroSeat]);
  return {
    hand: handNotation(hero[0], hero[1]),
    street: ['Preflop', 'Flop', 'Turn', 'River'][snapshot.street],
    seats: snapshot.playerCount,
  };
}

/** Every combination of a written hand like "AKs". Used when building ranges. */
export function combosOf(hand: string): Card[][] {
  const r1 = RANK_CHARS.indexOf(hand[0]);
  const r2 = RANK_CHARS.indexOf(hand[1]);
  const out: Card[][] = [];
  if (r1 === r2) {
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) out.push([makeCard(r1, a), makeCard(r2, b)]);
  } else if (hand[2] === 's') {
    for (let s = 0; s < 4; s++) out.push([makeCard(r1, s), makeCard(r2, s)]);
  } else {
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if (a !== b) out.push([makeCard(r1, a), makeCard(r2, b)]);
  }
  return out;
}
