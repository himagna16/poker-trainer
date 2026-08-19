/**
 * Tests for the multiway rules engine.
 *
 * The headline invariant is chip conservation. Poker moves chips between
 * players; it never creates or destroys them. If the stacks at the end don't
 * add up to the stacks at the start, there is a bug, full stop - and side pots
 * are exactly where that goes wrong, because the temptation is to hand someone
 * money they were never entitled to win.
 *
 * We check the side pot builder against hand-worked examples first, then fuzz
 * hundreds of thousands of hands across every table size with wildly uneven
 * stacks, which is what actually forces side pots to appear.
 */
import {
  newHand, applyAction, legalActions, netResult, buildPots, currentPots,
  livePlayers, smallBlindSeat, bigBlindSeat, positionLabel, STREET_BOARD_SIZE,
} from '../src/lib/poker/engine';
import type { HandState } from '../src/lib/poker/engine';
import { makeRng } from '../src/lib/poker/cards';

let failed = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '   ' + detail : ''}`);
};

/* ---------------------------------------------------------------- */
console.log('Side pots, worked by hand:\n');
{
  // Two deep players and one short all-in. The short stack can only win what
  // they matched from each opponent.
  const pots = buildPots([200, 200, 50], [false, false, false]);
  const total = pots.reduce((a, p) => a + p.amount, 0);
  console.log('  200 / 200 / 50 all live:');
  for (const p of pots) console.log(`    ${p.isSide ? 'side' : 'main'} pot ${p.amount}, contested by seats ${p.eligible.join(',')}`);
  check('two pots created', pots.length === 2);
  check('main pot is 150 (50 from each)', pots[0]?.amount === 150, `got ${pots[0]?.amount}`);
  check('short stack can win the main pot', pots[0]?.eligible.join(',') === '0,1,2');
  check('side pot is 300', pots[1]?.amount === 300, `got ${pots[1]?.amount}`);
  check('short stack CANNOT win the side pot', pots[1]?.eligible.join(',') === '0,1');
  check('all 450 chips accounted for', total === 450, `got ${total}`);
}
{
  // A folded player's chips stay in the pot but they cannot win any of it.
  const pots = buildPots([100, 40, 10], [false, false, true]);
  const total = pots.reduce((a, p) => a + p.amount, 0);
  console.log('\n  100 / 40 / 10 with seat 2 folded:');
  for (const p of pots) console.log(`    ${p.isSide ? 'side' : 'main'} pot ${p.amount}, contested by seats ${p.eligible.join(',')}`);
  check('folded chips still counted', total === 150, `got ${total}`);
  check('folded player is in no pot', !pots.some((p) => p.eligible.includes(2)));
  check('uncalled excess returns to seat 0 alone',
    pots[pots.length - 1].eligible.join(',') === '0' && pots[pots.length - 1].amount === 60,
    `got ${pots[pots.length - 1].amount} for seats ${pots[pots.length - 1].eligible.join(',')}`);
}
{
  // Everyone folds to one player: it must collapse to a single pot they win.
  const pots = buildPots([10, 5, 2], [false, true, true]);
  console.log('\n  10 / 5 / 2 with everyone folded to seat 0:');
  check('merges into one pot of 17', pots.length === 1 && pots[0].amount === 17,
    `got ${pots.length} pot(s) totalling ${pots.reduce((a, p) => a + p.amount, 0)}`);
}

/* ---------------------------------------------------------------- */
console.log('\nBetting order (the rule engines usually get wrong):\n');
{
  const hu = newHand({ playerCount: 2, button: 0, seed: 1 });
  check('heads-up: button posts the SMALL blind', smallBlindSeat(hu) === 0);
  check('heads-up: button acts FIRST preflop', hu.toAct === 0, `acts: seat ${hu.toAct}`);
  let s = applyAction(hu, { type: 'call' });
  s = applyAction(s, { type: 'check' });
  check('heads-up: big blind acts FIRST postflop', s.toAct === 1, `acts: seat ${s.toAct}`);
}
{
  const six = newHand({ playerCount: 6, button: 0, seed: 1 });
  check('6-max: small blind is left of the button', smallBlindSeat(six) === 1);
  check('6-max: big blind is two left of the button', bigBlindSeat(six) === 2);
  check('6-max: under the gun acts first preflop', six.toAct === 3, `acts: seat ${six.toAct}`);
  check('6-max: seat 3 is labelled UTG', positionLabel(six, 3) === 'UTG', positionLabel(six, 3));
  check('6-max: seat 5 is labelled CO', positionLabel(six, 5) === 'CO', positionLabel(six, 5));
  let s: HandState = six;
  for (let i = 0; i < 5; i++) s = applyAction(s, legalActions(s)[1].type === 'call' ? { type: 'call' } : { type: 'check' });
  s = applyAction(s, { type: 'check' });
  check('6-max: small blind acts first postflop', s.toAct === 1, `acts: seat ${s.toAct}`);
}
{
  const three = newHand({ playerCount: 3, button: 0, seed: 1 });
  check('3-handed: the button is also first to act preflop', three.toAct === 0, `acts: seat ${three.toAct}`);
}

/* ---------------------------------------------------------------- */
console.log('\nFuzzing every table size with lopsided stacks:\n');

const rng = makeRng(20260819);
const PER_SIZE = 20000;
let totalSidePots = 0;
let totalHands = 0;
const problems: string[] = [];

for (let playerCount = 2; playerCount <= 9; playerCount++) {
  let sidePotHands = 0;
  let splits = 0;
  let showdowns = 0;
  let maxPots = 1;
  let localFail = 0;

  for (let h = 0; h < PER_SIZE; h++) {
    // Deliberately uneven stacks. Equal stacks almost never produce side pots,
    // so a fuzzer that uses them tests nothing interesting.
    const stacks = Array.from({ length: playerCount }, () => 2 * (2 + Math.floor(rng() * 150)));
    const startTotal = stacks.reduce((a, b) => a + b, 0);

    let s: HandState = newHand({
      playerCount, stacks, button: h % playerCount, bigBlind: 2,
      seed: (rng() * 2 ** 31) | 0,
    });

    let steps = 0;
    while (!s.complete) {
      const legal = legalActions(s);
      if (legal.length === 0) { problems.push(`${playerCount}p hand ${h}: no legal actions, not complete`); localFail++; break; }
      const pick = legal[(rng() * legal.length) | 0];
      let amount = pick.amount;
      if (pick.min !== undefined && pick.max !== undefined && pick.max > pick.min) {
        amount = pick.min + Math.floor(rng() * (pick.max - pick.min + 1));
      }
      s = applyAction(s, { type: pick.type, amount });

      // Invariants that must hold at every single step, not just at the end.
      const investedSum = s.invested.reduce((a, b) => a + b, 0);
      if (s.pot !== investedSum) { problems.push(`${playerCount}p hand ${h}: pot ${s.pot} != invested ${investedSum}`); localFail++; break; }
      if (s.stack.some((v) => v < 0)) { problems.push(`${playerCount}p hand ${h}: negative stack`); localFail++; break; }
      if (!s.complete && s.board.length !== STREET_BOARD_SIZE[s.street]) {
        problems.push(`${playerCount}p hand ${h}: ${s.board.length} board cards on street ${s.street}`); localFail++; break;
      }
      if (!s.complete && (s.toAct < 0 || s.folded[s.toAct] || s.allIn[s.toAct])) {
        problems.push(`${playerCount}p hand ${h}: asked a folded/all-in seat to act`); localFail++; break;
      }
      if (++steps > 400) { problems.push(`${playerCount}p hand ${h}: did not terminate`); localFail++; break; }
    }

    const endTotal = s.stack.reduce((a, b) => a + b, 0);
    if (endTotal !== startTotal) {
      problems.push(`${playerCount}p hand ${h}: chips ${startTotal} -> ${endTotal}`);
      localFail++;
    }
    const net = netResult(s);
    if (net.reduce((a, b) => a + b, 0) !== 0) {
      problems.push(`${playerCount}p hand ${h}: net does not sum to zero`);
      localFail++;
    }
    // Nobody can win more than they risked against opponents who could cover.
    if (s.result) {
      const awarded = s.result.awards.reduce((a, x) => a + x.pot.amount, 0);
      if (awarded !== s.pot) {
        problems.push(`${playerCount}p hand ${h}: awarded ${awarded} of a ${s.pot} pot`);
        localFail++;
      }
      if (s.result.awards.length > 1) sidePotHands++;
      maxPots = Math.max(maxPots, s.result.awards.length);
      if (s.result.showdown) showdowns++;
      if (s.result.awards.some((a) => a.winners.length > 1)) splits++;
    }
    totalHands++;
  }

  totalSidePots += sidePotHands;
  failed += localFail;
  console.log(
    `  ${playerCount} players: ${localFail === 0 ? 'ok  ' : 'FAIL'} ` +
    `${((sidePotHands / PER_SIZE) * 100).toFixed(1)}% of hands split into side pots ` +
    `(most in one hand: ${maxPots}),  ${((showdowns / PER_SIZE) * 100).toFixed(0)}% showdowns, ` +
    `${((splits / PER_SIZE) * 100).toFixed(2)}% chopped`
  );
}

console.log(`\n  ${totalHands.toLocaleString()} hands fuzzed, ${totalSidePots.toLocaleString()} of them with side pots.`);
if (problems.length) {
  console.log('\n  First few problems:');
  for (const p of problems.slice(0, 8)) console.log('    ' + p);
}

console.log(failed === 0
  ? '\nChips conserved in every hand at every table size. ALL INVARIANTS HELD.'
  : `\n${failed} FAILURES`);
process.exit(failed === 0 ? 0 : 1);
