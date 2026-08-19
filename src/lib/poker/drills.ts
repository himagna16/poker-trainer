/**
 * drills.ts - high-repetition practice.
 *
 * Playing full hands is the fun part, but it is a slow way to learn. A hand
 * takes a minute and contains maybe three decisions, most of them easy. A drill
 * gives you the hard decision on its own, over and over, so you get two hundred
 * repetitions in the time one table session would give you twenty.
 *
 * Each drill generates a random situation, takes your answer, and grades it
 * with the same engine the table uses - so a drill and a real hand agree about
 * what the right play was.
 */

import type { Card } from './cards';
import { makeRng, shuffle, makeDeck } from './cards';
import { newHand, applyAction, toCall } from './engine';
import type { HandState } from './engine';
import { getPersona, botAction, PERSONAS } from './bots';
import type { BotPersona } from './bots';
import { fullRange, removeBlocked, updateRangeWithAction } from './ranges';
import type { WeightedRange } from './ranges';
import { exactEquity, fastEquity, findOuts } from './equity';
import { evaluate } from './evaluator';

export const HERO = 0;

export type DrillId = 'preflop' | 'potodds' | 'outs' | 'equity';

export interface DrillMeta {
  id: DrillId;
  name: string;
  blurb: string;
  teaches: string;
}

export const DRILLS: DrillMeta[] = [
  {
    id: 'preflop',
    name: 'Play or fold',
    blurb: 'You are dealt two cards. Fold, call, or raise?',
    teaches:
      'Which starting hands are worth playing, and from which seat. Most losing players lose ' +
      'most of their money by playing too many hands before the flop, so this is the highest-value drill there is.',
  },
  {
    id: 'potodds',
    name: 'Price check',
    blurb: 'Someone bet at you after the flop. Is calling worth it?',
    teaches:
      'Comparing what you must pay against how often you win. Once this is automatic you stop ' +
      'making the two most common errors at once: calling too wide, and folding when you are getting a bargain.',
  },
  {
    id: 'outs',
    name: 'Count the outs',
    blurb: 'You are behind. How many cards would save you?',
    teaches:
      'Counting outs, including the traps - cards that complete your hand while handing your ' +
      'opponent a better one do not count.',
  },
  {
    id: 'equity',
    name: 'Guess the odds',
    blurb: 'Two hands, face up. What are your chances?',
    teaches:
      'Calibrating your instinct against the real numbers. Most people are badly wrong about how ' +
      'often a big pair beats two overcards, and about how much a draw is really worth.',
  },
];

/** A spot generated from a real hand, so the grader applies unchanged. */
export interface PlaySpot {
  kind: 'preflop' | 'potodds';
  state: HandState;
  range: WeightedRange;
  persona: BotPersona;
}

export interface OutsSpot {
  kind: 'outs';
  hero: Card[];
  villain: Card[];
  board: Card[];
  outs: Card[];
  equity: number;
}

export interface EquitySpot {
  kind: 'equity';
  hero: Card[];
  villain: Card[];
  board: Card[];
  equity: number;
}

export type DrillSpot = PlaySpot | OutsSpot | EquitySpot;

/**
 * Deal hands until we land in the kind of situation this drill is about.
 *
 * Generating a real hand and playing forward, rather than inventing a board out
 * of thin air, keeps the spots realistic: the pot sizes, the ranges and the
 * betting all hang together the way they would at a table.
 */
function dealUntilSpot(
  seed: number,
  persona: BotPersona,
  accept: (s: HandState) => boolean,
  maxAttempts = 400
): { state: HandState; range: WeightedRange } | null {
  const rng = makeRng(seed);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let state = newHand({
      stacks: [200, 200],
      button: attempt % 2,
      bigBlind: 2,
      seed: Math.floor(rng() * 2 ** 31),
    });
    let range = removeBlocked(fullRange(), state.hole[HERO]);

    let guard = 0;
    while (!state.complete && guard++ < 40) {
      if (state.toAct === HERO) {
        if (accept(state)) return { state, range };
        // Not the spot we want - keep the hand moving by playing it out sensibly.
        const action = botAction(state, getPersona('tag'), rng);
        state = applyAction(state, action);
      } else {
        const before = state;
        const action = botAction(state, persona, rng);
        range = updateRangeWithAction(range, before, persona, action);
        state = applyAction(state, action);
      }
      range = removeBlocked(range, [...state.hole[HERO], ...state.board]);
    }
  }
  return null;
}

export function makePreflopSpot(seed: number, personaId?: string): PlaySpot | null {
  const persona = getPersona(personaId ?? PERSONAS[(seed >>> 3) % PERSONAS.length].id);
  const found = dealUntilSpot(seed, persona, (s) => s.street === 0);
  if (!found) return null;
  return { kind: 'preflop', ...found, persona };
}

export function makePotOddsSpot(seed: number, personaId?: string): PlaySpot | null {
  const persona = getPersona(personaId ?? PERSONAS[(seed >>> 3) % PERSONAS.length].id);
  const found = dealUntilSpot(seed, persona, (s) => s.street >= 1 && toCall(s, HERO) > 0);
  if (!found) return null;
  return { kind: 'potodds', ...found, persona };
}

/**
 * Build a spot where the hero is currently losing but can still get there.
 *
 * We deal at random and keep only the hands where you're behind with somewhere
 * between two and fifteen outs - the range where counting them actually changes
 * your decision.
 */
export function makeOutsSpot(seed: number): OutsSpot | null {
  const rng = makeRng(seed);
  for (let attempt = 0; attempt < 600; attempt++) {
    const deck = shuffle(makeDeck(), rng);
    const hero = [deck[0], deck[1]];
    const villain = [deck[2], deck[3]];
    const boardLength = rng() < 0.65 ? 3 : 4;
    const board = deck.slice(4, 4 + boardLength);

    if (evaluate([...hero, ...board]) >= evaluate([...villain, ...board])) continue;
    const outs = findOuts(hero, villain, board);
    if (outs.length < 2 || outs.length > 15) continue;

    return {
      kind: 'outs',
      hero, villain, board, outs,
      equity: exactEquity(hero, villain, board).equity,
    };
  }
  return null;
}

export function makeEquitySpot(seed: number): EquitySpot {
  const rng = makeRng(seed);
  const deck = shuffle(makeDeck(), rng);
  const hero = [deck[0], deck[1]];
  const villain = [deck[2], deck[3]];
  const r = rng();
  const boardLength = r < 0.4 ? 0 : r < 0.75 ? 3 : 4;
  const board = deck.slice(4, 4 + boardLength);
  // fastEquity enumerates exactly once there's a flop, and samples before it.
  // Preflop the exact answer means 1.7 million runouts and a visible pause; a
  // sampled answer is accurate to a few tenths of a point, which is far finer
  // than anyone's guess in this drill.
  return {
    kind: 'equity',
    hero, villain, board,
    equity: fastEquity(hero, villain, board).equity,
  };
}

export function makeSpot(drill: DrillId, seed: number): DrillSpot | null {
  switch (drill) {
    case 'preflop': return makePreflopSpot(seed);
    case 'potodds': return makePotOddsSpot(seed);
    case 'outs': return makeOutsSpot(seed);
    case 'equity': return makeEquitySpot(seed);
  }
}

/** Scoring for the numeric drills, where "close" deserves partial credit. */
export function scoreGuess(guess: number, truth: number, tolerance: number): {
  correct: boolean; close: boolean; error: number;
} {
  const error = Math.abs(guess - truth);
  return { correct: error <= tolerance, close: error <= tolerance * 2.5, error };
}
