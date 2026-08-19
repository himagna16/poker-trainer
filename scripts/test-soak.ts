/**
 * A soak test of the loop the app actually runs.
 *
 * The other suites test pieces in isolation. This one drives the same sequence
 * the interface does - deal, let the bots act while narrowing their ranges,
 * grade the hero's decision, apply it, repeat - across every table size and a
 * deliberately nasty spread of stack depths.
 *
 * It's looking for the things unit tests miss: a number that comes back NaN, a
 * range that collapses to nothing, a loop that never terminates, an exception
 * thrown three streets deep. Anything that would show up as a frozen or blank
 * screen rather than a wrong answer.
 */
import {
  newHand, applyAction, legalActions, netResult, livePlayers, currentPots,
} from '../src/lib/poker/engine';
import type { HandState } from '../src/lib/poker/engine';
import { getPersona, botAction, tableLineup } from '../src/lib/poker/bots';
import { newRangeBook, updateBookForAction, pruneBook, rangeWidth } from '../src/lib/poker/ranges';
import type { RangeBook } from '../src/lib/poker/ranges';
import { gradeDecision, equityForDisplay } from '../src/lib/poker/grade';
import type { Lineup } from '../src/lib/poker/grade';
import { captureSpot, restoreSpot } from '../src/lib/poker/spots';
import { makeRng } from '../src/lib/poker/cards';

const HERO = 0;
let failed = 0;
const problems: string[] = [];
const fail = (msg: string) => { failed++; if (problems.length < 12) problems.push(msg); };

function finite(name: string, v: number, lo: number, hi: number, ctx: string) {
  if (!Number.isFinite(v)) fail(`${ctx}: ${name} is ${v}`);
  else if (v < lo || v > hi) fail(`${ctx}: ${name} = ${v}, outside [${lo}, ${hi}]`);
}

const rng = makeRng(778899);
const HANDS_PER_SIZE = 220;
let graded = 0;
let snapshots = 0;
let heroAllIns = 0;
let heroFoldedThenWatched = 0;
let emptyRanges = 0;
let maxPots = 1;
let slowestGradeMs = 0;

for (let playerCount = 2; playerCount <= 9; playerCount++) {
  for (let h = 0; h < HANDS_PER_SIZE; h++) {
    // A brutal spread of stack depths: some seats barely cover the blind, some
    // are 200bb deep. This is what produces short all-ins and layered side pots.
    const stacks = Array.from({ length: playerCount }, () =>
      rng() < 0.25 ? 2 * (1 + Math.floor(rng() * 6)) : 2 * (20 + Math.floor(rng() * 180))
    );
    const ids = tableLineup(playerCount, HERO);
    const lineup: Lineup = ids.map((id) => (id === 'hero' ? null : getPersona(id)));
    const ctx = `${playerCount}p hand ${h}`;

    let state: HandState;
    try {
      state = newHand({ playerCount, stacks, button: h % playerCount, bigBlind: 2, seed: (rng() * 2 ** 31) | 0 });
    } catch (e) {
      fail(`${ctx}: newHand threw ${(e as Error).message}`);
      continue;
    }
    let book: RangeBook = newRangeBook(state, HERO);

    let guard = 0;
    let sawHeroTurn = false;

    while (!state.complete && guard++ < 300) {
      const seat = state.toAct;
      if (seat < 0) { fail(`${ctx}: toAct is -1 but hand not complete`); break; }

      if (seat === HERO) {
        sawHeroTurn = true;
        const legal = legalActions(state);
        if (legal.length === 0) { fail(`${ctx}: hero to act with no legal actions`); break; }

        // Everything the interface computes when it's your turn.
        try {
          const eq = equityForDisplay(state, HERO, book, false);
          finite('equity vs ranges', eq.equity, 0, 1, ctx);
          finite('equity margin', eq.margin, 0, 1, ctx);
          const eqActual = equityForDisplay(state, HERO, book, true);
          finite('equity vs hands', eqActual.equity, 0, 1, ctx);
        } catch (e) {
          fail(`${ctx}: equity threw ${(e as Error).message}`);
        }

        const choice = legal[(rng() * legal.length) | 0];
        let amount = choice.amount;
        if (choice.min !== undefined && choice.max !== undefined && choice.max > choice.min) {
          amount = choice.min + Math.floor(rng() * (choice.max - choice.min + 1));
        }
        const action = { type: choice.type, amount };

        try {
          const t0 = performance.now();
          const g = gradeDecision(state, HERO, lineup, book, action, { trials: 90 });
          slowestGradeMs = Math.max(slowestGradeMs, performance.now() - t0);
          if (g) {
            graded++;
            finite('evLostVsRange', g.evLostVsRange, -1e6, 1e6, ctx);
            finite('heroEquityVsRange', g.heroEquityVsRange, 0, 1, ctx);
            finite('heroEquityVsHand', g.heroEquityVsHand, 0, 1, ctx);
            if (g.foldsOut !== null) finite('foldsOut', g.foldsOut, 0, 1, ctx);
            if (g.potOdds !== null) finite('potOdds', g.potOdds, 0, 1, ctx);
            for (const o of g.options) {
              finite(`EV of ${o.label}`, o.evVsRange, -1e6, 1e6, ctx);
              finite(`margin of ${o.label}`, o.marginVsRange, 0, 1e6, ctx);
            }
            if (!g.headline || !g.detail) fail(`${ctx}: grade produced empty text`);
            if (g.detail.includes('undefined') || g.detail.includes('NaN')) {
              fail(`${ctx}: explanation contains a broken value: ${g.detail.slice(0, 90)}`);
            }

            // Saving and replaying a spot is what the review drill does.
            try {
              const snap = captureSpot(state, HERO, lineup, book, action);
              const back = restoreSpot(snap);
              snapshots++;
              if (back.state.pot !== state.pot) fail(`${ctx}: restored pot ${back.state.pot} != ${state.pot}`);
              if (livePlayers(back.state).length !== livePlayers(state).length) {
                fail(`${ctx}: restored a different number of live players`);
              }
              if (legalActions(back.state).length !== legal.length) {
                fail(`${ctx}: restored spot offers different actions`);
              }
            } catch (e) {
              fail(`${ctx}: snapshot round-trip threw ${(e as Error).message}`);
            }
          }
        } catch (e) {
          fail(`${ctx}: gradeDecision threw ${(e as Error).message}`);
        }

        try {
          state = applyAction(state, action);
        } catch (e) {
          fail(`${ctx}: applyAction threw ${(e as Error).message}`);
          break;
        }
      } else {
        const persona = lineup[seat]!;
        const before = state;
        try {
          const action = botAction(state, persona, rng);
          if (!legalActions(state).some((l) => l.type === action.type)) {
            fail(`${ctx}: bot in seat ${seat} chose an illegal ${action.type}`);
            break;
          }
          book = updateBookForAction(book, before, persona, action, seat);
          state = applyAction(state, action);
        } catch (e) {
          fail(`${ctx}: bot turn threw ${(e as Error).message}`);
          break;
        }
      }
      book = pruneBook(book, [...state.hole[HERO], ...state.board]);

      // A range that empties out means we would be grading against nothing.
      for (const seat2 of livePlayers(state)) {
        if (seat2 === HERO) continue;
        if (book[seat2] && book[seat2].length === 0) { emptyRanges++; }
        else if (book[seat2] && rangeWidth(book[seat2]) <= 0) { fail(`${ctx}: seat ${seat2} range has zero total weight`); }
      }
      maxPots = Math.max(maxPots, currentPots(state).length);
    }

    if (guard >= 300) fail(`${ctx}: hand did not terminate`);
    if (!state.complete) fail(`${ctx}: loop exited with hand incomplete`);

    const net = netResult(state);
    if (net.reduce((a, b) => a + b, 0) !== 0) fail(`${ctx}: net does not sum to zero`);
    if (state.stack.reduce((a, b) => a + b, 0) !== stacks.reduce((a, b) => a + b, 0)) {
      fail(`${ctx}: chips not conserved`);
    }
    if (state.allIn[HERO]) heroAllIns++;
    if (state.folded[HERO] && sawHeroTurn) heroFoldedThenWatched++;
  }
}

console.log(`Played ${(220 * 8).toLocaleString()} hands through the app's real loop.\n`);
console.log(`  decisions graded              ${graded.toLocaleString()}`);
console.log(`  snapshots saved and restored  ${snapshots.toLocaleString()}`);
console.log(`  hands where the hero was all in  ${heroAllIns.toLocaleString()}`);
console.log(`  hands the hero folded and watched out  ${heroFoldedThenWatched.toLocaleString()}`);
console.log(`  most simultaneous pots        ${maxPots}`);
console.log(`  slowest single grade          ${slowestGradeMs.toFixed(0)}ms`);
console.log(`  opponent ranges that emptied  ${emptyRanges}`);

if (problems.length) {
  console.log('\nProblems:');
  for (const p of problems) console.log('  ' + p);
}
console.log(failed === 0
  ? '\nNo exceptions, no bad numbers, no stuck hands. SOAK PASSED.'
  : `\n${failed} PROBLEM(S)`);
process.exit(failed === 0 ? 0 : 1);
