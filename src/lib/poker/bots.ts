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
 * Instead each bot is a recognisable TYPE of player. Everyone who has played
 * poker has met all five. Learning to spot which one you're up against, and
 * adjusting, is worth far more at a real table than memorising equilibrium
 * strategy - and it's something the expensive solver tools barely teach at all.
 *
 * There's also a practical payoff. Because we wrote these bots, we know their
 * strategy exactly, so the genuinely best response to them is computable by
 * simulation. That's how the trainer grades your decisions. Against a real
 * opponent "correct play" is unknowable; against ours it's arithmetic.
 *
 * TWO THINGS EVERY BOT ADJUSTS FOR:
 *
 *   POSITION. Acting last is worth real money, so a good player opens maybe 13%
 *   of hands under the gun and 40% on the button. A bot that played one fixed
 *   range from every seat would be teaching you a bad habit.
 *
 *   THE CROWD. The more players still in the pot, the more likely somebody has
 *   something. A hand you'd happily call a single raise with is often a fold
 *   once three people are already in.
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
import { legalActions, toCall, positionQuality, livePlayers } from './engine';

export interface BotPersona {
  id: string;
  name: string;
  /** What this player is like, in plain language. */
  blurb: string;
  /** How to actually beat them. This is the teaching payload. */
  counter: string;
  /** A one-word handle for the seat plaque. */
  tag: string;

  /**
   * Baseline share of starting hands they'd raise with. Scaled by position -
   * this is roughly their middle-position range, widened on the button and
   * tightened up front.
   */
  openPct: number;
  /** Share they'll call a raise with. */
  callPct: number;
  /** Share they'll re-raise with. */
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
    tag: 'Nit',
    blurb:
      'Plays almost nothing, and when they finally play it, they have it. ' +
      'Folds constantly and almost never bluffs.',
    counter:
      'Bet at them relentlessly with anything - they fold far too often. But the ' +
      'moment a Rock raises you, believe them and get out of the way.',
    openPct: 0.12, callPct: 0.10, threeBetPct: 0.03,
    aggression: 0.55, bluffFreq: 0.04, callLooseness: 0.75, betSizing: 0.6,
  },
  {
    id: 'station',
    name: 'The Calling Station',
    tag: 'Station',
    blurb:
      'Cannot fold. Sees a flop with anything and calls you down with bottom ' +
      'pair "just to keep you honest". Rarely raises.',
    counter:
      'Never bluff them - they will call. Instead bet big with real hands, every ' +
      'street. They pay you off. This is the most profitable opponent in poker.',
    openPct: 0.50, callPct: 0.85, threeBetPct: 0.04,
    aggression: 0.20, bluffFreq: 0.05, callLooseness: 2.2, betSizing: 0.45,
  },
  {
    id: 'maniac',
    name: 'The Maniac',
    tag: 'Maniac',
    blurb:
      'Raises everything, all the time, with anything. Enormous swings. ' +
      'Genuinely hard to read because their range is basically every hand.',
    counter:
      'Stop bluffing and start trapping. Let them do the betting for you, then ' +
      'call down much lighter than feels comfortable - most of the time they have nothing.',
    openPct: 0.85, callPct: 0.75, threeBetPct: 0.35,
    aggression: 0.90, bluffFreq: 0.60, callLooseness: 1.25, betSizing: 0.9,
  },
  {
    id: 'tag',
    name: 'The Regular',
    tag: 'Reg',
    blurb:
      'Tight and aggressive - the standard winning style. Plays good hands, ' +
      'bets them hard, bluffs at a believable rate. The toughest of the five.',
    counter:
      'Respect their raises but do not let them run you over. Defend your big ' +
      'blind wider than feels natural, and pick off their river bluffs occasionally.',
    openPct: 0.22, callPct: 0.24, threeBetPct: 0.09,
    aggression: 0.75, bluffFreq: 0.30, callLooseness: 1.0, betSizing: 0.7,
  },
  {
    id: 'lag',
    name: 'The Loose Cannon',
    tag: 'LAG',
    blurb:
      'Plays half the deck, aggressively, and applies constant pressure. ' +
      'A skilled version of the Maniac - the bluffs are picked more carefully.',
    counter:
      'Widen everything. Their range is weak on average, so your medium hands go ' +
      'up in value. Let them bluff into your strong ones rather than raising them off it.',
    openPct: 0.45, callPct: 0.48, threeBetPct: 0.18,
    aggression: 0.80, bluffFreq: 0.45, callLooseness: 1.15, betSizing: 0.75,
  },
];

export function getPersona(id: string): BotPersona {
  return PERSONAS.find((p) => p.id === id) ?? PERSONAS[3];
}

/**
 * A believable mix of opponents for a table of this size.
 *
 * Real tables aren't uniform. Stacking the seats with one of each type is both
 * more realistic and better practice, because the whole skill is noticing that
 * seat 3 folds everything while seat 5 calls everything.
 */
export function tableLineup(seatCount: number, heroSeat: number): string[] {
  const rotation = ['tag', 'station', 'rock', 'lag', 'maniac', 'tag', 'station', 'rock', 'lag'];
  const out: string[] = [];
  let r = 0;
  for (let i = 0; i < seatCount; i++) {
    out.push(i === heroSeat ? 'hero' : rotation[r++ % rotation.length]);
  }
  return out;
}

/* ------------------------------------------------------------------ *
 * Reading a hand
 * ------------------------------------------------------------------ */

/**
 * How good is this hand right now, on a 0..1 scale?
 *
 * This is deliberately a cheap approximation rather than a real equity
 * calculation. The reason is speed: to grade your decisions we replay the hand
 * thousands of times, and the bots have to decide inside every single replay.
 * If each bot decision ran its own simulation we'd be nesting simulations
 * inside simulations and the interface would freeze.
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

  // Draws are worth real money while cards are still to come, and worth exactly
  // nothing on the river. Beginners systematically overvalue them on the river
  // and undervalue them on the flop.
  if (board.length < 5 && cat < CAT_STRAIGHT) {
    strength += drawBonus(hole, board, board.length === 3 ? 1 : 0.55);
  }

  return Math.min(1, strength);
}

function drawBonus(hole: Card[], board: Card[], weight: number): number {
  const all = [...hole, ...board];
  let bonus = 0;

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
 * Discount a hand's strength for the number of people you have to beat.
 *
 * Top pair is a good hand against one opponent and a mediocre one against four,
 * because it now has to be better than four hands instead of one. Raising the
 * strength to a power greater than one captures that: strong hands barely move,
 * marginal ones fall off a cliff. This is the single biggest adjustment between
 * heads-up and full-table play, and the one beginners most often miss.
 */
export function crowdAdjusted(strength: number, opponents: number): number {
  if (opponents <= 1) return strength;
  return Math.pow(strength, 1 + (opponents - 1) * 0.4);
}

/* ------------------------------------------------------------------ *
 * The strategy itself
 * ------------------------------------------------------------------ */

export interface PolicyOption {
  action: Action;
  /** How often the bot takes this action in this exact spot, 0..1. */
  prob: number;
}

/**
 * The bot's COMPLETE strategy in this spot - every action it might take, and
 * how often it takes each.
 *
 * Returning the whole distribution instead of one sampled action is the key
 * design decision in this file, because it unlocks two separate features:
 *
 *  1. GRADING. To work out what your call is worth we replay the hand from here
 *     thousands of times. Each replay needs a fresh sample from the bot's real
 *     strategy, not one frozen choice.
 *
 *  2. RANGE READING. We can run this BACKWARDS. Given that the bot just bet, we
 *     ask "for each of the 1,326 hands it could hold, how likely was it to bet
 *     that one?" - and that tells us what it probably has. That is exactly the
 *     reasoning a good player does in their head, and here it falls out of the
 *     same function that makes the decision.
 */
export function botPolicy(state: HandState, persona: BotPersona, hole?: Card[]): PolicyOption[] {
  const seat = state.toAct;
  if (seat < 0) return [];
  const cards = hole ?? state.hole[seat];
  const legal = legalActions(state);
  if (legal.length === 0) return [];

  const need = toCall(state, seat);
  const canRaise = legal.find((a) => a.type === 'bet' || a.type === 'raise');
  const opponents = Math.max(1, livePlayers(state).length - 1);

  const sized = (fraction: number): Action => {
    const target = Math.round(state.betToMatch + state.pot * fraction);
    return {
      type: canRaise!.type,
      amount: Math.max(canRaise!.min!, Math.min(canRaise!.max!, target)),
    };
  };

  // ---------- Before the flop ----------
  if (state.street === 0) {
    const pct = preflopPercentile(handNotation(cards[0], cards[1]));

    // Position. This turns a 22% baseline into roughly 17% under the gun and
    // 44% on the button - close to the ranges a solid player actually opens.
    const openTop = Math.min(0.95, persona.openPct * (0.5 + positionQuality(state, seat) * 2.0));

    // The crowd. Each extra live player shrinks what's worth continuing with.
    const crowd = Math.pow(0.85, Math.max(0, opponents - 1));

    // Heads-up, the button posts the small blind and acts FIRST before the flop,
    // so it's always nominally "facing a bet" even though nobody has raised.
    // That's an OPENING decision, not a call-or-fold one. We tell them apart by
    // checking whether the bet has grown past the big blind.
    const facingRaise = state.betToMatch > state.bigBlind;

    if (need === 0) {
      // Big blind with the option after limps.
      if (pct <= openTop && canRaise) return [{ action: sized(persona.betSizing), prob: 1 }];
      return [{ action: { type: 'check' }, prob: 1 }];
    }

    if (!facingRaise) {
      if (pct <= openTop && canRaise) return [{ action: sized(persona.betSizing), prob: 1 }];
      // Limping - flat-calling the big blind - is a passive player's move.
      // Aggressive types raise or fold, so only passive personas do it.
      const limpTop = persona.aggression < 0.4 ? persona.callPct * crowd : 0;
      if (pct <= limpTop) return [{ action: { type: 'call' }, prob: 1 }];
      return [{ action: { type: 'fold' }, prob: 1 }];
    }

    // THE PRICE. A 3bb raise is cheap and worth calling wide; a 100bb shove is
    // not. Without this, even a calling station would call off its whole stack
    // with 85% of hands, and the trainer would happily recommend shoving a
    // hundred big blinds with ace-ten - correct against a bot that broken, and
    // ruinous advice at a real table.
    //
    // The exponent is gentle rather than a cliff, so loose players stay loose:
    // facing 10bb a station still calls about 40% of hands, facing 100bb about
    // 13%, while a tight regular drops to roughly 4% - which is about right.
    const costInBB = need / state.bigBlind;
    const priceFactor = Math.min(1, Math.pow(3 / Math.max(1, costInBB), 0.55));

    if (pct <= persona.threeBetPct * crowd * priceFactor && canRaise) {
      return [{ action: sized(persona.betSizing), prob: 1 }];
    }
    // Getting in cheap is worth stretching for - a limp or a min-raise costs
    // almost nothing to see a flop.
    const priceBonus = need <= state.bigBlind ? 0.15 : 0;
    if (pct <= persona.callPct * crowd * priceFactor + priceBonus) {
      return [{ action: { type: 'call' }, prob: 1 }];
    }
    return [{ action: { type: 'fold' }, prob: 1 }];
  }

  // ---------- After the flop ----------
  const raw = handStrength(cards, state.board);
  const strength = crowdAdjusted(raw, opponents);
  const out: PolicyOption[] = [];

  if (need === 0) {
    let pBet: number;
    if (strength >= 0.55) {
      pBet = persona.aggression; // betting for value
    } else if (strength >= 0.30) {
      // A semi-bluff: might win right now, and still has outs if called. This is
      // the most profitable kind of bluff there is.
      const semi = persona.aggression * 0.45;
      pBet = semi + (1 - semi) * persona.bluffFreq;
    } else {
      pBet = persona.bluffFreq; // nothing at all, pure bluff
    }
    // Bluffing into a crowd rarely works - somebody always has something.
    if (opponents > 1 && strength < 0.55) pBet *= Math.pow(0.7, opponents - 1);
    if (!canRaise) pBet = 0;

    if (pBet > 0) {
      out.push({
        action: sized(strength >= 0.55 ? persona.betSizing : persona.betSizing * 0.75),
        prob: pBet,
      });
    }
    out.push({ action: { type: 'check' }, prob: 1 - pBet });
    return out.filter((o) => o.prob > 1e-9);
  }

  // Facing a bet.
  let pRaise = 0;
  if (strength >= 0.80) pRaise = persona.aggression;
  else if (strength >= 0.35 && strength < 0.55) pRaise = persona.bluffFreq * 0.4;
  if (opponents > 1 && strength < 0.8) pRaise *= Math.pow(0.7, opponents - 1);
  if (!canRaise) pRaise = 0;
  if (pRaise > 0) out.push({ action: sized(persona.betSizing), prob: pRaise });

  // Whether the rest of the time is a call or a fold comes down to the price.
  // callLooseness above 1 is what makes a calling station call when the pot
  // odds say they shouldn't.
  const priceNeeded = requiredEquity(need, state.pot);
  const continues = strength * persona.callLooseness >= priceNeeded;
  out.push({ action: continues ? { type: 'call' } : { type: 'fold' }, prob: 1 - pRaise });
  return out.filter((o) => o.prob > 1e-9);
}

/** Sample one action from the bot's strategy. */
export function botAction(state: HandState, persona: BotPersona, rng: () => number): Action {
  const policy = botPolicy(state, persona);
  if (policy.length === 0) return { type: 'check' };
  let r = rng();
  for (const option of policy) {
    r -= option.prob;
    if (r <= 0) return option.action;
  }
  return policy[policy.length - 1].action;
}

/**
 * How likely was this bot to take the action it just took, holding these exact
 * cards? Feeding this through every possible holding is how we read its range.
 */
export function actionProbability(
  state: HandState,
  persona: BotPersona,
  hole: Card[],
  taken: Action
): number {
  let p = 0;
  for (const option of botPolicy(state, persona, hole)) {
    if (option.action.type === taken.type) p += option.prob;
  }
  return p;
}
