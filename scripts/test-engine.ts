/**
 * Fuzz test for the rules engine.
 *
 * Rather than write out example hands by hand, we play a hundred thousand of
 * them making random legal choices, and after each one check facts that must be
 * true of ANY poker hand. Random play reaches strange corners - all-ins for
 * less than a full raise, min-raise wars, everyone checking down - far faster
 * than we would think to write them out.
 *
 * The strongest invariant is chip conservation. Poker moves chips between
 * players, it never creates or destroys them. If the two stacks at the end
 * don't add up to the two stacks at the start, we have a bug, full stop.
 */
import { newHand, legalActions, applyAction, netResult, STREET_BOARD_SIZE } from '../src/lib/poker/engine';
import type { HandState } from '../src/lib/poker/engine';
import { makeRng } from '../src/lib/poker/cards';

const HANDS = 100_000;
const rng = makeRng(20260818);
let failed = 0;
const problems: string[] = [];

function fail(msg: string) {
  failed++;
  if (problems.length < 10) problems.push(msg);
}

const streetCounts = [0, 0, 0, 0];
const endings = { fold: 0, showdown: 0, split: 0 };
let maxActions = 0;
let totalActions = 0;

for (let h = 0; h < HANDS; h++) {
  // Vary stack depth so we exercise short-stack all-ins as well as deep play.
  const depth = 4 + Math.floor(rng() * 200);
  const stacks: [number, number] = [depth * 2, (4 + Math.floor(rng() * 200)) * 2];
  const startTotal = stacks[0] + stacks[1];

  let s: HandState = newHand({ stacks, button: rng() < 0.5 ? 0 : 1, bigBlind: 2, seed: (rng() * 2 ** 31) | 0 });
  let steps = 0;

  while (!s.complete) {
    const legal = legalActions(s);
    if (legal.length === 0) {
      fail(`hand ${h}: no legal actions but hand not complete (street ${s.street})`);
      break;
    }
    const pick = legal[(rng() * legal.length) | 0];
    let amount = pick.amount;
    // For bet/raise, choose a random legal size in the window.
    if (pick.min !== undefined && pick.max !== undefined && pick.max > pick.min) {
      amount = pick.min + Math.floor(rng() * (pick.max - pick.min + 1));
    }
    s = applyAction(s, { type: pick.type, amount });

    if (s.stack[0] < 0 || s.stack[1] < 0) { fail(`hand ${h}: negative stack`); break; }
    if (s.pot < 0) { fail(`hand ${h}: negative pot`); break; }
    if (!s.complete && s.board.length !== STREET_BOARD_SIZE[s.street]) {
      fail(`hand ${h}: board has ${s.board.length} cards on ${s.street}`);
      break;
    }
    if (++steps > 200) { fail(`hand ${h}: hand did not terminate`); break; }
  }

  totalActions += steps;
  if (steps > maxActions) maxActions = steps;

  const endTotal = s.stack[0] + s.stack[1];
  if (endTotal !== startTotal) {
    fail(`hand ${h}: chips not conserved - started ${startTotal}, ended ${endTotal}`);
  }
  const net = netResult(s);
  if (net[0] + net[1] !== 0) fail(`hand ${h}: net doesn't sum to zero (${net[0]}, ${net[1]})`);
  if (!s.result) { fail(`hand ${h}: completed with no result`); continue; }

  // Nobody can win more than the smaller starting stack allowed.
  if (Math.abs(net[0]) > Math.min(stacks[0], stacks[1])) {
    fail(`hand ${h}: won more than the effective stack (${net[0]} vs ${Math.min(...stacks)})`);
  }

  streetCounts[s.street]++;
  if (!s.result.showdown) endings.fold++;
  else if (s.result.winner === -1) endings.split++;
  else endings.showdown++;

  // Any hand that reaches a showdown must have a full five-card board.
  if (s.result.showdown && s.board.length !== 5) {
    fail(`hand ${h}: showdown with ${s.board.length} board cards`);
  }
}

console.log(`Played ${HANDS.toLocaleString()} hands with random legal actions.\n`);
console.log(`  average actions per hand : ${(totalActions / HANDS).toFixed(1)}`);
console.log(`  longest hand             : ${maxActions} actions`);
console.log(`  ended preflop            : ${((streetCounts[0] / HANDS) * 100).toFixed(1)}%`);
console.log(`  ended on the flop        : ${((streetCounts[1] / HANDS) * 100).toFixed(1)}%`);
console.log(`  ended on the turn        : ${((streetCounts[2] / HANDS) * 100).toFixed(1)}%`);
console.log(`  ended on the river       : ${((streetCounts[3] / HANDS) * 100).toFixed(1)}%`);
console.log(`  won by fold              : ${((endings.fold / HANDS) * 100).toFixed(1)}%`);
console.log(`  went to showdown         : ${((endings.showdown / HANDS) * 100).toFixed(1)}%`);
console.log(`  split pots               : ${((endings.split / HANDS) * 100).toFixed(2)}%`);

if (failed) {
  console.log(`\n${failed} FAILURES. First few:`);
  for (const p of problems) console.log('  ' + p);
} else {
  console.log('\nChips conserved in every hand. ALL INVARIANTS HELD.');
}
process.exit(failed === 0 ? 0 : 1);
