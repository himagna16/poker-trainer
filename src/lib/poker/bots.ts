/**
 * bots.ts - the opponents you practise against.
 *
 * A DELIBERATE DESIGN CHOICE: these bots are not trying to be unbeatable.
 *
 * The strongest poker bots in the world play a "game theory optimal" strategy -
 * unexploitable, but also unable to punish your mistakes, and enormously
 * expensive to compute. That's the wrong opponent for learning. Nobody at a
 * live table plays like that.
 *
 * Instead each bot is a recognisable TYPE of bad player. Everyone who has
 * played poker has met all five of them. Learning to notice which one you're
 * up against, and adjusting, is worth far more at a real table than memorising
 * equilibrium strategy - and it's a skill the expensive solver tools barely
 * teach at all.
 *
 * There's also a practical payoff. Because we wrote these bots, we know their
 * strategy exactly. That means we can compute the genuinely best response to
 * them by simulation, which is how the trainer grades your decisions. Against a
 * real opponent "correct play" is unknowable; against ours it's just arithmetic.
 */

import type { Card } from './cards';
import { rankOf, suitOf, handNotation } from './cards';
import {
  evaluate, categoryOf, kickerOf, straightHighFromMask,
  CAT_HIGH_CARD, CAT_PAIR, CAT_STRAIGHT,
} from './evaluator';
import { preflopPercentile } from './preflopStrength';
import { requiredEquity } from './equity';
import type { Action, HandState } from './engine';
import { legalActions, toCall, maxBetTo } from './engine';

export interface BotPersona {
  id: string;
  name: string;
  /** What this player is like, in plain language. */
  blurb: string;
  /** How to actually beat them. This is the teaching payload. */
  counter: string;
  colour: string;

  /** Fraction of starting hands they'll raise with when first in. */
  openPct: number;
  /** Fraction they'll call a raise with. */
  callPct: number;
  /** Fraction they'll re-raise with. */
  threeBetPct: number;

  /** How readily they bet a decent hand after the flop, 0..1. */
  aggression: number;
  /** How often they bet with nothing at all, 0..1. */
  bluffFreq: number;
  /**
   * Multiplier on how loose their calls are. Above 1 means they call when the
   * pot odds say fold - the defining sin of a calling station.
   */
  callLooseness: number;
  /** Typical bet as a fraction of the pot. */
  betSizing: number;
}

export const PERSONAS: BotPersona[] = [
  {
    id: 'rock',
    name: 'The Rock',
    blurb:
      'Plays almost nothing, and when they finally play it, they have it. ' +
      'Folds constantly and almost never bluffs.',
    counter:
      'Bet at them relentlessly with anything - they fold far too often. But the ' +
      'moment a Rock raises you, believe them and get out of the way.',
    colour: '#7c9cbf',
    openPct: 0.12, callPct: 0.10, threeBetPct: 0.03,
    aggression: 0.55, bluffFreq: 0.04, callLooseness: 0.75, betSizing: 0.6,
  },
  {
    id: 'station',
    name: 'The Calling Station',
    blurb:
      'Cannot fold. Sees a flop with anything and calls you down with bottom ' +
      'pair "just to keep you honest". Rarely raises.',
    counter:
      'Never bluff them - they will call. Instead bet big with real hands, every ' +
      'street. They pay you off. This is the most profitable opponent in poker.',
    colour: '#84a98c',
    openPct: 0.50, callPct: 0.85, threeBetPct: 0.04,
    aggression: 0.20, bluffFreq: 0.05, callLooseness: 1.7, betSizing: 0.45,
  },
  {
    id: 'maniac',
    name: 'The Maniac',
    blurb:
      'Raises everything, all the time, with anything. Enormous swings. ' +
      'Genuinely hard to read because their range is basically every hand.',
    counter:
      'Stop bluffing and start trapping. Let them do the betting for you, then ' +
      'call down much lighter than feels comfortable - most of the time they have nothing.',
    colour: '#d08770',
    openPct: 0.85, callPct: 0.75, threeBetPct: 0.35,
    aggression: 0.90, bluffFreq: 0.60, callLooseness: 1.25, betSizing: 0.9,
  },
  {
    id: 'tag',
    name: 'The Regular',
    blurb:
      'Tight and aggressive - the standard winning style. Plays good hands, ' +
      'bets them hard, bluffs at a believable rate. The toughest of the five.',
    counter:
      'Respect their raises but do not let them run you over. Defend your big ' +
      'blind wider than feels natural, and pick off their river bluffs occasionally.',
    colour: '#b48ead',
    openPct: 0.22, callPct: 0.24, threeBetPct: 0.09,
    aggression: 0.75, bluffFreq: 0.30, callLooseness: 1.0, betSizing: 0.7,
  },
  {
    id: 'lag',
    name: 'The Loose Cannon',
    blurb:
      'Plays half the deck, aggressively, and applies constant pressure. ' +
      'Skilled version of the Maniac - the bluffs are picked more carefully.',
    counter:
      'Widen everything. Their range is weak on average, so your medium hands go ' +
      'up in value. Let them bluff into your strong ones rather than raising them off it.',
    colour: '#ebcb8b',
    openPct: 0.45, callPct: 0.48, threeBetPct: 0.18,
    aggression: 0.80, bluffFreq: 0.45, callLooseness: 1.15, betSizing: 0.75,
  },
];

export function getPersona(id: string): BotPersona {
  return PERSONAS.find((p) => p.id === id) ?? PERSONAS[3];
}

/**
 * How good is this hand right now, on a 0..1 scale?
 *
 * This is deliberately a cheap approximation rather than a real equity
 * calculation. The reason is speed: to grade your decisions we replay the hand
 * thousands of times, and the bots have to decide inside every single replay.
 * If each bot decision ran its own simulation we'd be nesting simulations
 * inside simulations, and the interface would freeze.
 *
 * So we read the hand the way a person does - what did I make, how does it
 * compare to the board, am I drawing to something - and turn that into a number.
 */
export function handStrength(hole: Card[], board: Card[]): number {
  if (board.length === 0) {
    // Before the flop, "top 10% of hands" is a better strength signal than raw
    // equity, because every hand's equity against a random hand is squeezed
    // into the narrow 32%-85% band and the differences look smaller than they are.
    return 1 - preflopPercentile(handNotation(hole[0], hole[1]));
  }

  const score = evaluate([...hole, ...board]);
  const cat = categoryOf(score);

  // Rough value of each category. These are not equities, they're the relative
  // worth of holding that hand type when the money goes in.
  const BASE = [0.10, 0.42, 0.72, 0.85, 0.90, 0.93, 0.97, 0.995, 1.0];
  let strength = BASE[cat];

  const boardRanks = board.map(rankOf).sort((a, b) => b - a);

  if (cat === CAT_PAIR) {
    // "A pair" spans everything from an overpair to the board (very strong) to
    // bottom pair with no kicker (nearly worthless). Which pair it is matters
    // far more than the fact that it's a pair.
    const pairRank = kickerOf(score, 0);
    if (pairRank > boardRanks[0]) strength = 0.62;                    // overpair
    else if (pairRank === boardRanks[0]) strength = 0.55;             // top pair
    else if (boardRanks.length > 1 && pairRank >= boardRanks[1]) strength = 0.38;
    else strength = 0.26;                                             // bottom pair
  } else if (cat === CAT_HIGH_CARD) {
    // Ace-high still wins sometimes; seven-high never does.
    strength = 0.05 + (kickerOf(score, 0) / 12) * 0.12;
  }

  // Draws are worth real money when there are cards still to come, and worth
  // exactly nothing on the river. Beginners systematically overvalue them on
  // the river and undervalue them on the flop.
  if (board.length < 5 && cat < CAT_STRAIGHT) {
    strength += drawBonus(hole, board, board.length === 3 ? 1 : 0.55);
  }

  return Math.min(1, strength);
}

function drawBonus(hole: Card[], board: Card[], weight: number): number {
  const all = [...hole, ...board];
  let bonus = 0;

  // Four to a flush.
  const suitCount = [0, 0, 0, 0];
  for (const c of all) suitCount[suitOf(c)]++;
  if (Math.max(...suitCount) === 4) bonus += 0.20;

  // Count how many different ranks would complete a straight. Two or more means
  // an open-ended draw (eight outs); exactly one is a gutshot (four outs).
  let mask = 0;
  for (const c of all) mask |= 1 << rankOf(c);
  if (straightHighFromMask(mask) < 0) {
    let completing = 0;
    for (let r = 0; r < 13; r++) {
      if (mask & (1 << r)) continue;
      if (straightHighFromMask(mask | (1 << r)) >= 0) completing++;
    }
    if (completing >= 2) bonus += 0.16;
    else if (completing === 1) bonus += 0.07;
  }

  return bonus * weight;
}

/**
 * Pick this bot's action. Deterministic given the same random source, which is
 * what lets the grader replay the same situation reproducibly.
 */
export function botAction(state: HandState, persona: BotPersona, rng: () => number): Action {
  const seat = state.toAct;
  const legal = legalActions(state);
  if (legal.length === 0) return { type: 'check' };

  const need = toCall(state, seat);
  const canRaise = legal.find((a) => a.type === 'bet' || a.type === 'raise');
  const strength = handStrength(state.hole[seat], state.board);

  const raiseTo = (fraction: number): Action => {
    if (!canRaise) return need > 0 ? { type: 'call' } : { type: 'check' };
    const target = Math.round(state.betToMatch + state.pot * fraction);
    const clamped = Math.max(canRaise.min!, Math.min(canRaise.max!, target));
    return { type: canRaise.type, amount: clamped };
  };

  if (state.street === 0) {
    const pct = preflopPercentile(handNotation(state.hole[seat][0], state.hole[seat][1]));

    // Heads-up, the button posts the small blind and acts FIRST before the flop.
    // So the button is always technically "facing a bet" - the big blind - even
    // though nobody has actually raised. Treating that as a call-or-fold spot is
    // wrong: it's an OPENING decision, and it's the single most common preflop
    // spot in the game. We separate the two by looking at whether the bet has
    // grown beyond the big blind.
    const facingRaise = state.betToMatch > state.bigBlind;

    if (need === 0) {
      // Big blind with the option after a limp: raise our opening range or check.
      if (pct <= persona.openPct && canRaise) return raiseTo(persona.betSizing);
      return { type: 'check' };
    }

    if (!facingRaise) {
      if (pct <= persona.openPct && canRaise) return raiseTo(persona.betSizing);
      // Limping - just calling the big blind - is a passive player's move.
      // Aggressive types raise or fold, so only the passive personas do it.
      const limpTop = persona.aggression < 0.4 ? persona.callPct : 0;
      if (pct <= limpTop) return { type: 'call' };
      return { type: 'fold' };
    }

    // Now we really are facing a raise.
    if (pct <= persona.threeBetPct && canRaise) return raiseTo(persona.betSizing);
    const priceBonus = need <= state.bigBlind ? 0.15 : 0;
    if (pct <= persona.callPct + priceBonus) return { type: 'call' };
    return { type: 'fold' };
  }

  // --- After the flop ---
  if (need === 0) {
    if (strength >= 0.55 && rng() < persona.aggression) return raiseTo(persona.betSizing);
    // Betting with a draw is a "semi-bluff": you might win right now, and if
    // called you still have a way to win later. It's the best kind of bluff.
    if (strength >= 0.30 && strength < 0.55 && rng() < persona.aggression * 0.45) {
      return raiseTo(persona.betSizing * 0.7);
    }
    if (rng() < persona.bluffFreq) return raiseTo(persona.betSizing * 0.8);
    return { type: 'check' };
  }

  // Facing a bet. Compare what we think we have against the price being asked.
  const need_ = requiredEquity(need, state.pot);
  const adjusted = strength * persona.callLooseness;

  if (strength >= 0.80 && canRaise && rng() < persona.aggression) return raiseTo(persona.betSizing);
  if (strength >= 0.35 && strength < 0.55 && canRaise && rng() < persona.bluffFreq * 0.4) {
    return raiseTo(persona.betSizing); // semi-bluff raise with a draw
  }
  if (adjusted >= need_) return { type: 'call' };
  return { type: 'fold' };
}
