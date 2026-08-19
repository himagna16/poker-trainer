/**
 * grade.ts - "was that the right play?"
 *
 * This is the whole reason the app exists. Playing against a bot with no
 * feedback is just a poker game; being told what your decision was actually
 * worth is what makes it training.
 *
 * HOW WE KNOW WHAT'S CORRECT
 *
 * This is the question every poker trainer has to answer, and most of them
 * answer it with a solver: compute the game-theory-optimal strategy and grade
 * you against that. Solvers are enormously expensive and, more importantly,
 * they grade you against an opponent you will never actually face.
 *
 * We do something different, and in some ways more useful. Because WE wrote the
 * bot, we know its exact strategy. So we can compute the true best response to
 * it by brute force: take the current situation, try each action you could make,
 * replay the rest of the hand a few thousand times, and see which action makes
 * the most money. No theory required - just counting.
 *
 * That gives an answer that is exactly correct for the opponent in front of
 * you. And learning to beat a specific opponent type is closer to what actually
 * wins money at a live table than equilibrium play is.
 *
 * TWO NUMBERS, AND THE DIFFERENCE BETWEEN THEM IS THE LESSON
 *
 *   EV against their ACTUAL cards - what this decision was worth given what
 *   they really had. Useful when you're learning with the cards face up.
 *
 *   EV against their RANGE - what it was worth against everything they could
 *   have had, weighted by likelihood. This is the honest measure of your play.
 *
 * When those two disagree, that IS the lesson. Calling can be clearly correct
 * against their range and still lose to the hand they happened to show up with.
 * Beginners look at the cards and conclude they misplayed it. Learning to trust
 * the range number over the result is most of what separates a thinking player
 * from a superstitious one.
 */

import type { Card } from './cards';
import { deckWithout, shuffle, makeRng } from './cards';
import { evaluate } from './evaluator';
import { requiredEquity, fastEquity } from './equity';
import type { EquityResult } from './equity';
import type { HandState, Action } from './engine';
import { cloneState, applyAction, legalActions, netResult, toCall } from './engine';
import type { BotPersona } from './bots';
import { botAction, botPolicy, getPersona } from './bots';
import type { WeightedRange } from './ranges';
import { makeSampler, rangePercent } from './ranges';

export type Verdict = 'best' | 'fine' | 'mistake' | 'blunder';

export interface ActionEV {
  action: Action;
  label: string;
  /** Chips won or lost from this point forward, against their actual hand. */
  evVsHand: number;
  /** Same, against everything they could be holding. */
  evVsRange: number;
  /** 95% confidence half-widths, in chips. */
  marginVsHand: number;
  marginVsRange: number;
}

export interface DecisionGrade {
  options: ActionEV[];
  bestVsRange: ActionEV;
  bestVsHand: ActionEV;
  chosen: ActionEV | null;
  /** Big blinds given up versus the best available action. */
  evLostVsRange: number;
  evLostVsHand: number;
  verdict: Verdict;
  headline: string;
  detail: string;
  /** Context we show alongside the verdict. */
  heroEquityVsRange: number;
  heroEquityVsHand: number;
  potOdds: number | null;
  /** How often the opponent folds to the action taken, if it was a bet or raise. */
  foldFrequency: number | null;
  villainRangePercent: number;
  trials: number;
}

export interface GradeOptions {
  trials?: number;
  seed?: number;
  /**
   * How we assume YOU play for the rest of the hand after this decision.
   *
   * We have to assume something: the value of calling here depends on what you
   * do on later streets. We use a solid, straightforward style. So read every
   * number as "what this decision is worth if you play sensibly from here" -
   * which is the right question anyway.
   */
  heroContinuation?: BotPersona;
}

/**
 * The actions worth evaluating. Rather than a continuous range of bet sizes -
 * where nearly identical amounts would clutter the display - we test the sizes
 * people actually use and talk about.
 */
export function candidateActions(state: HandState): Array<{ action: Action; label: string }> {
  const out: Array<{ action: Action; label: string }> = [];
  for (const l of legalActions(state)) {
    if (l.type === 'bet' || l.type === 'raise') {
      const verb = l.type === 'bet' ? 'Bet' : 'Raise to';
      const seen = new Set<number>();
      for (const { frac, name } of [
        { frac: 0.33, name: '1/3 pot' },
        { frac: 0.5, name: '1/2 pot' },
        { frac: 0.75, name: '3/4 pot' },
        { frac: 1.0, name: 'pot' },
      ]) {
        const target = Math.max(l.min!, Math.min(l.max!, Math.round(state.betToMatch + state.pot * frac)));
        if (seen.has(target)) continue;
        seen.add(target);
        out.push({ action: { type: l.type, amount: target }, label: `${verb} ${target} (${name})` });
      }
      if (!seen.has(l.max!)) {
        out.push({ action: { type: l.type, amount: l.max! }, label: `All in (${l.max})` });
      }
    } else {
      out.push({ action: { type: l.type, amount: l.amount }, label: l.label });
    }
  }
  return out;
}

/**
 * Set up one replay of the hand.
 *
 * Hole cards and the visible board stay exactly as they are - those are facts.
 * Everything still in the deck gets reshuffled, so each replay sees a different
 * future. Without this every replay would deal the identical board and we'd
 * learn nothing from repeating it.
 */
function prepareRollout(
  state: HandState,
  heroSeat: number,
  villainHole: Card[] | null,
  rng: () => number
): HandState {
  const s = cloneState(state);
  const villainSeat = 1 - heroSeat;
  if (villainHole) s.hole[villainSeat] = [...villainHole];

  const rest = deckWithout([...s.hole[0], ...s.hole[1], ...s.board]);
  shuffle(rest, rng);
  s.deck = [
    s.hole[0][0], s.hole[0][1],
    s.hole[1][0], s.hole[1][1],
    ...s.board,
    ...rest,
  ];
  s.deckPos = 4 + s.board.length;
  return s;
}

/** Play one replay to the end and report what the hero gained or lost. */
function playOut(
  start: HandState,
  heroSeat: number,
  first: Action,
  villain: BotPersona,
  hero: BotPersona,
  rng: () => number,
  baseline: number
): number {
  let s = applyAction(start, first);
  let guard = 0;
  while (!s.complete && guard++ < 60) {
    const persona = s.toAct === heroSeat ? hero : villain;
    s = applyAction(s, botAction(s, persona, rng));
  }
  return netResult(s)[heroSeat] - baseline;
}

/** Hero's raw chance of winning, sampled against the opponent's range. */
function equityVsRange(
  state: HandState,
  heroSeat: number,
  range: WeightedRange,
  trials: number,
  rng: () => number
): number {
  if (range.length === 0) return 0;
  const sample = makeSampler(range);
  const hero = state.hole[heroSeat];
  let total = 0;
  for (let t = 0; t < trials; t++) {
    const villain = sample(rng());
    const rest = deckWithout([...hero, ...villain, ...state.board]);
    const board = [...state.board];
    while (board.length < 5) {
      const j = (rng() * rest.length) | 0;
      board.push(rest[j]);
      rest.splice(j, 1);
    }
    const h = evaluate([...hero, ...board]);
    const v = evaluate([...villain, ...board]);
    total += h > v ? 1 : h < v ? 0 : 0.5;
  }
  return total / trials;
}

/** Hero's chance of winning against the exact hand they hold. */
function equityVsActual(state: HandState, heroSeat: number, trials: number, rng: () => number): number {
  const hero = state.hole[heroSeat];
  const villain = state.hole[1 - heroSeat];
  let total = 0;
  for (let t = 0; t < trials; t++) {
    const rest = deckWithout([...hero, ...villain, ...state.board]);
    const board = [...state.board];
    while (board.length < 5) {
      const j = (rng() * rest.length) | 0;
      board.push(rest[j]);
      rest.splice(j, 1);
    }
    const h = evaluate([...hero, ...board]);
    const v = evaluate([...villain, ...board]);
    total += h > v ? 1 : h < v ? 0 : 0.5;
  }
  return total / trials;
}

/**
 * Hero's equity right now, packaged for display.
 *
 * Which question we answer depends on whether the training wheels are on. With
 * their cards visible we can compute the exact answer against that exact hand.
 * With them hidden, the honest question is "against everything they could have",
 * which we sample - so it comes back with an error bar attached.
 */
export function equityForDisplay(
  state: HandState,
  heroSeat: number,
  range: WeightedRange,
  againstActualHand: boolean,
  seed = 31337
): EquityResult {
  if (againstActualHand) {
    return fastEquity(state.hole[heroSeat], state.hole[1 - heroSeat], state.board);
  }
  const rng = makeRng(seed);
  const trials = 4000;
  const value = equityVsRange(state, heroSeat, range, trials, rng);
  const variance = Math.max(0, value * (1 - value));
  return {
    equity: value,
    win: value,
    tie: 0,
    lose: 1 - value,
    trials,
    exact: false,
    margin: 1.96 * Math.sqrt(variance / trials),
  };
}

/**
 * How often does the opponent fold to this bet?
 *
 * This is "fold equity", and it's the missing half of why betting works. A bet
 * wins two different ways: they fold immediately, or they call and you win at
 * showdown. Equity alone only measures the second one, which is why a hand with
 * poor equity can still be a profitable bet.
 *
 * We compute it exactly: play the bet out, then ask the opponent's own strategy
 * how often it folds each holding still in its range, weighted by likelihood.
 */
export function foldFrequency(
  state: HandState,
  heroSeat: number,
  persona: BotPersona,
  range: WeightedRange,
  action: Action
): number | null {
  if (action.type === 'fold' || action.type === 'check') return null;
  let after: HandState;
  try {
    after = applyAction(state, action);
  } catch {
    return null;
  }
  if (after.complete || after.toAct === heroSeat) return null;

  let weighted = 0;
  let total = 0;
  for (const combo of range) {
    let pFold = 0;
    for (const option of botPolicy(after, persona, combo.cards)) {
      if (option.action.type === 'fold') pFold += option.prob;
    }
    weighted += combo.weight * pFold;
    total += combo.weight;
  }
  return total > 0 ? weighted / total : null;
}

/**
 * Grade the decision facing the hero right now.
 *
 * `chosenAction` is optional: pass it to score a move you already made, or omit
 * it to preview what every option is worth before you commit.
 */
export function gradeDecision(
  state: HandState,
  heroSeat: number,
  villainPersona: BotPersona,
  villainRange: WeightedRange,
  chosenAction: Action | null = null,
  opts: GradeOptions = {}
): DecisionGrade | null {
  if (state.complete || state.toAct !== heroSeat) return null;

  const trials = opts.trials ?? 900;
  const heroStyle = opts.heroContinuation ?? getPersona('tag');
  const candidates = candidateActions(state);
  if (candidates.length === 0) return null;

  const baseline = state.stack[heroSeat] - state.startStack[heroSeat];
  const sample = villainRange.length > 0 ? makeSampler(villainRange) : null;
  const options: ActionEV[] = [];

  for (let i = 0; i < candidates.length; i++) {
    const { action, label } = candidates[i];

    // Same seed for every candidate. This is "common random numbers": each
    // action faces the identical sequence of boards and opponent decisions, so
    // the DIFFERENCE between two options is measured far more precisely than
    // either option's absolute value. It costs nothing and it's the reason we
    // can tell apart options that differ by a fraction of a big blind.
    const rngHand = makeRng((opts.seed ?? 4242) + 1);
    const rngRange = makeRng((opts.seed ?? 4242) + 2);

    let sumH = 0, sumSqH = 0, sumR = 0, sumSqR = 0;
    for (let t = 0; t < trials; t++) {
      const vsHand = playOut(
        prepareRollout(state, heroSeat, null, rngHand),
        heroSeat, action, villainPersona, heroStyle, rngHand, baseline
      );
      sumH += vsHand;
      sumSqH += vsHand * vsHand;

      const villainHole = sample ? sample(rngRange()) : null;
      const vsRange = playOut(
        prepareRollout(state, heroSeat, villainHole, rngRange),
        heroSeat, action, villainPersona, heroStyle, rngRange, baseline
      );
      sumR += vsRange;
      sumSqR += vsRange * vsRange;
    }

    const meanH = sumH / trials;
    const meanR = sumR / trials;
    options.push({
      action,
      label,
      evVsHand: meanH,
      evVsRange: meanR,
      marginVsHand: 1.96 * Math.sqrt(Math.max(0, sumSqH / trials - meanH * meanH) / trials),
      marginVsRange: 1.96 * Math.sqrt(Math.max(0, sumSqR / trials - meanR * meanR) / trials),
    });
  }

  const bestVsRange = options.reduce((a, b) => (b.evVsRange > a.evVsRange ? b : a));
  const bestVsHand = options.reduce((a, b) => (b.evVsHand > a.evVsHand ? b : a));

  let chosen: ActionEV | null = null;
  if (chosenAction) {
    chosen =
      options.find((o) => o.action.type === chosenAction.type && o.action.amount === chosenAction.amount) ??
      options.find((o) => o.action.type === chosenAction.type) ??
      null;
  }

  const bb = state.bigBlind;
  const evLostVsRange = chosen ? (bestVsRange.evVsRange - chosen.evVsRange) / bb : 0;
  const evLostVsHand = chosen ? (bestVsHand.evVsHand - chosen.evVsHand) / bb : 0;

  const eqRng = makeRng((opts.seed ?? 4242) + 9);
  const heroEquityVsRange = equityVsRange(state, heroSeat, villainRange, 1500, eqRng);
  const heroEquityVsHand = equityVsActual(state, heroSeat, 1500, eqRng);

  const need = toCall(state, heroSeat);
  const potOdds = need > 0 ? requiredEquity(need, state.pot) : null;

  const actionForFolds = chosen?.action ?? bestVsRange.action;
  const folds = foldFrequency(state, heroSeat, villainPersona, villainRange, actionForFolds);

  const verdict = verdictFor(evLostVsRange);
  const { headline, detail } = explain({
    state, heroSeat, chosen, bestVsRange, evLostVsRange, evLostVsHand,
    heroEquityVsRange, heroEquityVsHand, potOdds, verdict, villainPersona,
    foldFrequency: folds, trials, toCall: need,
  });

  return {
    options,
    bestVsRange,
    bestVsHand,
    chosen,
    evLostVsRange,
    evLostVsHand,
    verdict,
    headline,
    detail,
    heroEquityVsRange,
    heroEquityVsHand,
    potOdds,
    foldFrequency: folds,
    villainRangePercent: rangePercent(villainRange),
    trials,
  };
}

function verdictFor(evLostBB: number): Verdict {
  if (evLostBB <= 0.08) return 'best';
  if (evLostBB <= 0.5) return 'fine';
  if (evLostBB <= 2.0) return 'mistake';
  return 'blunder';
}

interface ExplainArgs {
  state: HandState;
  heroSeat: number;
  chosen: ActionEV | null;
  bestVsRange: ActionEV;
  evLostVsRange: number;
  evLostVsHand: number;
  heroEquityVsRange: number;
  heroEquityVsHand: number;
  potOdds: number | null;
  verdict: Verdict;
  villainPersona: BotPersona;
  foldFrequency: number | null;
  trials: number;
  toCall: number;
}

/**
 * Turn the numbers into a sentence you can act on.
 *
 * The explanation has to match the decision that was actually made. Telling
 * someone about pot odds after they raised is confusing noise - a raise is
 * about fold equity, a call is about price, and a check is about pot control.
 */
function explain(a: ExplainArgs): { headline: string; detail: string } {
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  const bb = (x: number) => `${Math.abs(x).toFixed(2)} bb`;
  const type = a.chosen?.action.type ?? a.bestVsRange.action.type;
  const parts: string[] = [];

  if (type === 'call' || type === 'fold') {
    if (a.potOdds !== null) {
      parts.push(
        `Calling costs ${a.toCall} to win a pot of ${a.state.pot}, so you need to be right ` +
        `${pct(a.potOdds)} of the time. Against ${a.villainPersona.name}'s range you win ` +
        `${pct(a.heroEquityVsRange)}. ` +
        (a.heroEquityVsRange >= a.potOdds
          ? `That clears the price, so folding gives up something profitable.`
          : `That falls short of the price, so calling loses money over time even on the occasions it works.`)
      );
    } else {
      parts.push(`Against their range your hand is best ${pct(a.heroEquityVsRange)} of the time.`);
    }
  } else if (type === 'bet' || type === 'raise') {
    if (a.foldFrequency !== null) {
      parts.push(
        `${a.villainPersona.name} folds ${pct(a.foldFrequency)} of the time to this. ` +
        `When they do call, you still win ${pct(a.heroEquityVsRange)}. ` +
        `That is why betting can beat checking even with a weak hand - it wins two different ways, ` +
        `either they give up now or you are still good at showdown.`
      );
    } else {
      parts.push(`You win ${pct(a.heroEquityVsRange)} against the hands they can have here.`);
    }
  } else {
    parts.push(
      `Checking keeps the pot small and gives you a free look at the next card. ` +
      `Against their range your hand is good ${pct(a.heroEquityVsRange)} of the time.`
    );
  }

  // The most important lesson in the app: the difference between a good decision
  // and a good outcome.
  if (a.evLostVsRange <= 0.08 && a.evLostVsHand > 0.5) {
    parts.push(
      `Worth noticing: against the exact hand they turned out to have, this was the wrong move by ` +
      `${bb(a.evLostVsHand)}. But you could not see their cards, and against everything they could ` +
      `have had, it was right. Judge the decision, not the result.`
    );
  } else if (a.evLostVsRange > 0.5 && a.evLostVsHand <= 0.08) {
    parts.push(
      `This one happened to work out against the hand they had, which makes it easy to miss - ` +
      `against their range as a whole it still cost you ${bb(a.evLostVsRange)}.`
    );
  }

  parts.push(`(Worked out by replaying this exact spot ${a.trials.toLocaleString()} times against their real strategy.)`);

  const headline =
    a.verdict === 'best' ? `Best play - ${a.chosen?.label ?? a.bestVsRange.label}`
    : a.verdict === 'fine' ? `Close - ${a.chosen!.label} costs ${bb(a.evLostVsRange)}`
    : a.verdict === 'mistake' ? `Mistake - ${a.bestVsRange.label} was better by ${bb(a.evLostVsRange)}`
    : `Blunder - ${a.bestVsRange.label} was better by ${bb(a.evLostVsRange)}`;

  return { headline, detail: parts.join(' ') };
}
