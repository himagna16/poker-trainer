/**
 * grade.ts - "was that the right play?"
 *
 * This is the whole reason the app exists. Playing against bots with no
 * feedback is just a poker game; being told what your decision was actually
 * worth is what makes it training.
 *
 * HOW WE KNOW WHAT'S CORRECT
 *
 * Every poker trainer has to answer this, and most answer it with a solver:
 * compute the game-theory-optimal strategy and grade you against that. Solvers
 * are enormously expensive and, more importantly, they grade you against an
 * opponent you will never actually face.
 *
 * We do something different, and for learning it's more useful. Because WE
 * wrote the bots, we know their exact strategy. So we can compute the true best
 * response to them by brute force: take the current situation, try each action
 * you could make, replay the rest of the hand a few hundred times, and see
 * which one makes the most money. No theory required - just counting.
 *
 * That gives an answer that is exactly right for the players in front of you.
 * And learning to beat specific opponent types is closer to what actually wins
 * money at a live table than equilibrium play is.
 *
 * TWO NUMBERS, AND THE GAP BETWEEN THEM IS THE LESSON
 *
 *   EV against their ACTUAL cards - what this decision was worth given what
 *   they really had. Useful when you're learning with the cards face up.
 *
 *   EV against their RANGES - what it was worth against everything they could
 *   have had, weighted by likelihood. This is the honest measure of your play.
 *
 * When those disagree, that IS the lesson. Calling can be clearly correct
 * against a range and still lose to the hand that turns up. Beginners look at
 * the cards and conclude they misplayed it. Learning to trust the range number
 * over the result is most of what separates a thinking player from a
 * superstitious one.
 */

import type { Card } from './cards';
import { deckWithout, shuffle, makeRng } from './cards';
import { evaluate } from './evaluator';
import { requiredEquity, fastEquity } from './equity';
import type { EquityResult } from './equity';
import type { HandState, Action } from './engine';
import {
  cloneState, applyAction, legalActions, netResult, toCall, livePlayers, positionLabel,
} from './engine';
import type { BotPersona } from './bots';
import { botAction, botPolicy, getPersona } from './bots';
import type { RangeBook } from './ranges';
import { makeSampler, rangePercent } from './ranges';

export type Verdict = 'best' | 'fine' | 'mistake' | 'blunder';

/** One persona per seat; the hero's entry is null. */
export type Lineup = (BotPersona | null)[];

export interface ActionEV {
  action: Action;
  label: string;
  /** Chips won or lost from this point forward, against their actual hands. */
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
  heroEquityVsRange: number;
  heroEquityVsHand: number;
  potOdds: number | null;
  /** Chance that every remaining opponent folds to the action taken. */
  foldsOut: number | null;
  /** How wide each live opponent's range is, as a share of all hands. */
  opponentRanges: Array<{ seat: number; label: string; percent: number }>;
  opponentCount: number;
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

/* ------------------------------------------------------------------ *
 * Dealing out an imagined table
 * ------------------------------------------------------------------ */

/**
 * Give every opponent a plausible hand, drawn from what we believe they hold.
 *
 * The awkward part is that the hands have to be consistent with each other.
 * Two players cannot both hold the ace of spades, so we deal them one at a
 * time and re-draw whenever a card is already taken. With eight opponents and
 * tight ranges that can occasionally fail, in which case we give up on this
 * replay rather than quietly deal an impossible table.
 */
function sampleTable(
  state: HandState,
  heroSeat: number,
  book: RangeBook,
  samplers: Array<((u: number) => Card[]) | null>,
  rng: () => number
): Card[][] | null {
  const used = new Uint8Array(52);
  for (const c of state.hole[heroSeat]) used[c] = 1;
  for (const c of state.board) used[c] = 1;

  const holes: Card[][] = new Array(state.playerCount);
  holes[heroSeat] = state.hole[heroSeat];

  for (const seat of livePlayers(state)) {
    if (seat === heroSeat) continue;
    const sampler = samplers[seat];
    if (!sampler) return null;
    let combo: Card[] | null = null;
    for (let attempt = 0; attempt < 30; attempt++) {
      const c = sampler(rng());
      if (!used[c[0]] && !used[c[1]]) { combo = c; break; }
    }
    if (!combo) return null;
    used[combo[0]] = 1;
    used[combo[1]] = 1;
    holes[seat] = combo;
  }

  // Folded seats are out of the hand, so what they hold cannot matter. We fill
  // them from whatever is left purely so the deck stays a legal 52 cards.
  const leftovers: Card[] = [];
  for (let c = 0; c < 52; c++) if (!used[c]) leftovers.push(c);
  let li = 0;
  for (let seat = 0; seat < state.playerCount; seat++) {
    if (holes[seat]) continue;
    holes[seat] = [leftovers[li++], leftovers[li++]];
  }
  return holes;
}

/**
 * Set up one replay of the hand.
 *
 * Hole cards and the visible board stay as they are - those are facts, or in
 * the opponents' case a guess we've committed to. Everything still in the deck
 * gets reshuffled, so each replay sees a different future. Without this, every
 * replay would deal the identical board and repeating it would teach us nothing.
 */
function prepareRollout(
  state: HandState,
  holes: Card[][],
  rng: () => number
): HandState {
  const s = cloneState(state);
  s.hole = holes.map((h) => [...h]);

  const dealt: Card[] = [];
  for (const h of s.hole) dealt.push(...h);
  const rest = deckWithout([...dealt, ...s.board]);
  shuffle(rest, rng);

  s.deck = [...dealt, ...s.board, ...rest];
  s.deckPos = dealt.length + s.board.length;
  return s;
}

/** Play one replay to the end and report what the hero gained or lost. */
function playOut(
  start: HandState,
  heroSeat: number,
  first: Action,
  lineup: Lineup,
  heroStyle: BotPersona,
  rng: () => number,
  baseline: number
): number {
  let s = applyAction(start, first);
  let guard = 0;
  while (!s.complete && guard++ < 160) {
    const persona = s.toAct === heroSeat ? heroStyle : (lineup[s.toAct] ?? heroStyle);
    s = applyAction(s, botAction(s, persona, rng));
  }
  return netResult(s)[heroSeat] - baseline;
}

/* ------------------------------------------------------------------ *
 * Equity against a whole table
 * ------------------------------------------------------------------ */

/**
 * How often does the hero end up with the best hand?
 *
 * Against one opponent this is the familiar equity number. Against four it is a
 * much harsher number, and that difference is the point: a hand only has to be
 * beaten once. Top pair is a favourite heads-up and an underdog five ways, and
 * beginners lose a great deal of money not knowing that.
 */
function equityVsField(
  state: HandState,
  heroSeat: number,
  samplers: Array<((u: number) => Card[]) | null>,
  book: RangeBook,
  trials: number,
  rng: () => number
): number {
  const opponents = livePlayers(state).filter((s) => s !== heroSeat);
  if (opponents.length === 0) return 1;

  const hero = state.hole[heroSeat];
  let total = 0;
  let counted = 0;

  for (let t = 0; t < trials; t++) {
    const holes = sampleTable(state, heroSeat, book, samplers, rng);
    if (!holes) continue;

    const dealt: Card[] = [];
    for (const seat of [heroSeat, ...opponents]) dealt.push(...holes[seat]);
    const rest = deckWithout([...dealt, ...state.board]);
    const board = [...state.board];
    while (board.length < 5) {
      const j = (rng() * rest.length) | 0;
      board.push(rest[j]);
      rest.splice(j, 1);
    }

    const mine = evaluate([...hero, ...board]);
    let better = 0;
    let equal = 0;
    for (const seat of opponents) {
      const theirs = evaluate([...holes[seat], ...board]);
      if (theirs > mine) { better++; break; }
      if (theirs === mine) equal++;
    }
    total += better > 0 ? 0 : 1 / (1 + equal);
    counted++;
  }
  return counted > 0 ? total / counted : 0;
}

/** Same question, but against the hands they are actually holding. */
function equityVsActual(state: HandState, heroSeat: number, trials: number, rng: () => number): number {
  const opponents = livePlayers(state).filter((s) => s !== heroSeat);
  if (opponents.length === 0) return 1;
  if (opponents.length === 1 && state.board.length >= 3) {
    return fastEquity(state.hole[heroSeat], state.hole[opponents[0]], state.board).equity;
  }

  const hero = state.hole[heroSeat];
  const known: Card[] = [...hero];
  for (const seat of opponents) known.push(...state.hole[seat]);

  let total = 0;
  for (let t = 0; t < trials; t++) {
    const rest = deckWithout([...known, ...state.board]);
    const board = [...state.board];
    while (board.length < 5) {
      const j = (rng() * rest.length) | 0;
      board.push(rest[j]);
      rest.splice(j, 1);
    }
    const mine = evaluate([...hero, ...board]);
    let better = 0;
    let equal = 0;
    for (const seat of opponents) {
      const theirs = evaluate([...state.hole[seat], ...board]);
      if (theirs > mine) { better++; break; }
      if (theirs === mine) equal++;
    }
    total += better > 0 ? 0 : 1 / (1 + equal);
  }
  return total / trials;
}

/**
 * Hero's equity right now, packaged for display.
 *
 * Which question we answer depends on whether the training wheels are on. With
 * their cards visible we compute it against those exact hands. With them
 * hidden, the honest question is "against everything they could have", which we
 * sample - so it comes back with an error bar attached.
 */
export function equityForDisplay(
  state: HandState,
  heroSeat: number,
  book: RangeBook,
  againstActualHands: boolean,
  seed = 31337
): EquityResult {
  const rng = makeRng(seed);
  const trials = 3000;
  const value = againstActualHands
    ? equityVsActual(state, heroSeat, trials, rng)
    : equityVsField(state, heroSeat, buildSamplers(book), book, trials, rng);
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

function buildSamplers(book: RangeBook): Array<((u: number) => Card[]) | null> {
  return book.map((range) => (range && range.length > 0 ? makeSampler(range) : null));
}

/* ------------------------------------------------------------------ *
 * Fold equity
 * ------------------------------------------------------------------ */

/**
 * The chance that this bet simply takes the pot down.
 *
 * This is "fold equity", and it's the missing half of why betting works. A bet
 * wins two different ways: everyone folds, or you get called and still have the
 * best hand. Equity alone measures only the second, which is why a hand with
 * poor equity can still be a profitable bet.
 *
 * Multiway it gets harsh fast. Each opponent has to fold independently, so
 * against four players even a 70%-per-player fold rate only clears the field
 * about a quarter of the time. That's the arithmetic behind "don't bluff into a
 * crowd", and seeing the number is more convincing than being told the rule.
 */
export function foldsOutProbability(
  state: HandState,
  heroSeat: number,
  lineup: Lineup,
  book: RangeBook,
  action: Action
): number | null {
  if (action.type === 'fold' || action.type === 'check') return null;

  let s: HandState;
  try {
    s = applyAction(state, action);
  } catch {
    return null;
  }

  let probability = 1;
  let guard = 0;
  while (!s.complete && s.toAct !== heroSeat && guard++ < 12) {
    const seat = s.toAct;
    const persona = lineup[seat];
    const range = book[seat];
    if (!persona || !range || range.length === 0) return null;

    let folds = 0;
    let total = 0;
    for (const combo of range) {
      let p = 0;
      for (const option of botPolicy(s, persona, combo.cards)) {
        if (option.action.type === 'fold') p += option.prob;
      }
      folds += combo.weight * p;
      total += combo.weight;
    }
    if (total === 0) return null;
    probability *= folds / total;
    s = applyAction(s, { type: 'fold' });
  }
  return probability;
}

/* ------------------------------------------------------------------ *
 * The grade
 * ------------------------------------------------------------------ */

export function gradeDecision(
  state: HandState,
  heroSeat: number,
  lineup: Lineup,
  book: RangeBook,
  chosenAction: Action | null = null,
  opts: GradeOptions = {}
): DecisionGrade | null {
  if (state.complete || state.toAct !== heroSeat) return null;

  const trials = opts.trials ?? 700;
  const heroStyle = opts.heroContinuation ?? getPersona('tag');
  const candidates = candidateActions(state);
  if (candidates.length === 0) return null;

  const baseline = state.stack[heroSeat] - state.startStack[heroSeat];
  const samplers = buildSamplers(book);
  const options: ActionEV[] = [];

  for (const { action, label } of candidates) {
    // The same seed for every candidate. This is "common random numbers": each
    // action faces an identical sequence of boards and opponent decisions, so
    // the DIFFERENCE between two options is measured far more precisely than
    // either option's absolute value. It costs nothing, and it's why we can
    // separate options that differ by a fraction of a big blind.
    const rngHand = makeRng((opts.seed ?? 4242) + 1);
    const rngRange = makeRng((opts.seed ?? 4242) + 2);

    let sumH = 0, sumSqH = 0, nH = 0;
    let sumR = 0, sumSqR = 0, nR = 0;

    for (let t = 0; t < trials; t++) {
      const vsHand = playOut(
        prepareRollout(state, state.hole, rngHand),
        heroSeat, action, lineup, heroStyle, rngHand, baseline
      );
      sumH += vsHand; sumSqH += vsHand * vsHand; nH++;

      const holes = sampleTable(state, heroSeat, book, samplers, rngRange);
      if (holes) {
        const vsRange = playOut(
          prepareRollout(state, holes, rngRange),
          heroSeat, action, lineup, heroStyle, rngRange, baseline
        );
        sumR += vsRange; sumSqR += vsRange * vsRange; nR++;
      }
    }

    const meanH = nH > 0 ? sumH / nH : 0;
    const meanR = nR > 0 ? sumR / nR : meanH;
    options.push({
      action,
      label,
      evVsHand: meanH,
      evVsRange: meanR,
      marginVsHand: nH > 0 ? 1.96 * Math.sqrt(Math.max(0, sumSqH / nH - meanH * meanH) / nH) : 0,
      marginVsRange: nR > 0 ? 1.96 * Math.sqrt(Math.max(0, sumSqR / nR - meanR * meanR) / nR) : 0,
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
  const heroEquityVsRange = equityVsField(state, heroSeat, samplers, book, 1200, eqRng);
  const heroEquityVsHand = equityVsActual(state, heroSeat, 1200, eqRng);

  const need = toCall(state, heroSeat);
  const potOdds = need > 0 ? requiredEquity(need, state.pot) : null;
  const opponents = livePlayers(state).filter((s) => s !== heroSeat);
  const foldsOut = foldsOutProbability(
    state, heroSeat, lineup, book, chosen?.action ?? bestVsRange.action
  );

  const verdict = verdictFor(evLostVsRange);
  const { headline, detail } = explain({
    state, chosen, bestVsRange, evLostVsRange, evLostVsHand,
    heroEquityVsRange, heroEquityVsHand, potOdds, verdict, lineup,
    foldsOut, trials, toCall: need, opponentCount: opponents.length,
  });

  return {
    options, bestVsRange, bestVsHand, chosen,
    evLostVsRange, evLostVsHand, verdict, headline, detail,
    heroEquityVsRange, heroEquityVsHand, potOdds, foldsOut,
    opponentRanges: opponents.map((seat) => ({
      seat,
      label: positionLabel(state, seat),
      percent: rangePercent(book[seat] ?? []),
    })),
    opponentCount: opponents.length,
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
  chosen: ActionEV | null;
  bestVsRange: ActionEV;
  evLostVsRange: number;
  evLostVsHand: number;
  heroEquityVsRange: number;
  heroEquityVsHand: number;
  potOdds: number | null;
  verdict: Verdict;
  lineup: Lineup;
  foldsOut: number | null;
  trials: number;
  toCall: number;
  opponentCount: number;
}

/**
 * Turn the numbers into a sentence you can act on.
 *
 * The explanation has to match the decision that was actually made. Telling
 * someone about pot odds after they raised is confusing noise - a raise is
 * about fold equity, a call is about price, a check is about pot control.
 */
function explain(a: ExplainArgs): { headline: string; detail: string } {
  const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
  const bb = (x: number) => `${Math.abs(x).toFixed(2)} bb`;
  const type = a.chosen?.action.type ?? a.bestVsRange.action.type;
  const many = a.opponentCount > 1;
  const them = many ? `all ${a.opponentCount} opponents` : 'they';
  const parts: string[] = [];

  if (type === 'call' || type === 'fold') {
    if (a.potOdds !== null) {
      parts.push(
        `Calling costs ${a.toCall} to win a pot of ${a.state.pot}, so you need to be right ` +
        `${pct(a.potOdds)} of the time. Against ${many ? 'the range of everyone still in' : 'their range'} ` +
        `you have the best hand ${pct(a.heroEquityVsRange)} of the time. ` +
        (a.heroEquityVsRange >= a.potOdds
          ? `That clears the price, so folding gives up something profitable.`
          : `That falls short of the price, so calling loses money over time even on the occasions it works.`)
      );
    } else {
      parts.push(`You have the best hand ${pct(a.heroEquityVsRange)} of the time here.`);
    }
  } else if (type === 'bet' || type === 'raise') {
    if (a.foldsOut !== null) {
      parts.push(
        `${many ? `The chance that ${them} fold` : 'They fold'} to this ${many ? 'is' : ''} ${pct(a.foldsOut)}. ` +
        `When you do get called you still have the best hand ${pct(a.heroEquityVsRange)} of the time. ` +
        `That is why betting can beat checking even with a weak hand - it wins two ways, either ` +
        `everyone gives up now or you are still good at showdown.` +
        (many && a.foldsOut < 0.35
          ? ` With this many players left, though, somebody usually has something, which is why bluffing into a crowd is so much worse than bluffing one person.`
          : '')
      );
    } else {
      parts.push(`You have the best hand ${pct(a.heroEquityVsRange)} of the time against the hands still out there.`);
    }
  } else {
    parts.push(
      `Checking keeps the pot small and buys a free look at the next card. ` +
      `Against ${many ? 'the field' : 'their range'} your hand is best ${pct(a.heroEquityVsRange)} of the time.`
    );
  }

  // The most important lesson in the app: a good decision and a good outcome
  // are different things.
  if (a.evLostVsRange <= 0.08 && a.evLostVsHand > 0.5) {
    parts.push(
      `Worth noticing: against the exact hands they turned out to have, this was the wrong move by ` +
      `${bb(a.evLostVsHand)}. But you could not see their cards, and against everything they could ` +
      `have had, it was right. Judge the decision, not the result.`
    );
  } else if (a.evLostVsRange > 0.5 && a.evLostVsHand <= 0.08) {
    parts.push(
      `This one happened to work against the cards they held, which makes it easy to miss - against ` +
      `their ranges as a whole it still cost you ${bb(a.evLostVsRange)}.`
    );
  }

  parts.push(`(Worked out by replaying this exact spot ${a.trials.toLocaleString()} times against their real strategies.)`);

  const headline =
    a.verdict === 'best' ? `Best play - ${a.chosen?.label ?? a.bestVsRange.label}`
    : a.verdict === 'fine' ? `Close - ${a.chosen!.label} costs ${bb(a.evLostVsRange)}`
    : a.verdict === 'mistake' ? `Mistake - ${a.bestVsRange.label} was better by ${bb(a.evLostVsRange)}`
    : `Blunder - ${a.bestVsRange.label} was better by ${bb(a.evLostVsRange)}`;

  return { headline, detail: parts.join(' ') };
}
