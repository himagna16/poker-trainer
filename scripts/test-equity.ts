/**
 * Testing an odds engine is tricky because the "right answer" isn't obvious by
 * inspection. So we lean on facts that must hold no matter how it's written:
 * equities have to sum to 1, the number of futures examined has to match the
 * combinatorics, and a few famous matchups have published values we can check.
 */
import { parseCards, cardsToString, deckWithout } from '../src/lib/poker/cards';
import {
  exactEquity, rangeEquity, findOuts, ruleOf2And4, exactOutProbability,
  requiredEquity, minimumDefenseFrequency, bluffBreakEven, futureCount,
} from '../src/lib/poker/equity';

let failed = 0;
const pct = (x: number) => (x * 100).toFixed(2) + '%';

function check(name: string, cond: boolean, detail = '') {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '  ' + detail : ''}`);
}

console.log('Exact equity - famous matchups (published values in parens):');
const MATCHUPS: Array<[string, string, string, number]> = [
  ['AsAh', 'KsKh', '', 82.4],
  ['AsKs', 'QcQd', '', 46.2],
  ['AsKh', '2c2d', '', 46.9],
  ['7h2c', 'AsAd', '', 11.8],
  ['JsTs', 'AhKd', '', 41.6],
];
for (const [h, v, b, expected] of MATCHUPS) {
  const hero = parseCards(h), vill = parseCards(v), board = b ? parseCards(b) : [];
  const t0 = performance.now();
  const r = exactEquity(hero, vill, board);
  const ms = performance.now() - t0;
  const close = Math.abs(r.equity * 100 - expected) < 1.0;
  if (!close) failed++;
  console.log(
    `  ${close ? 'ok  ' : 'FAIL'} ${h} vs ${v}: ${pct(r.equity)} (${expected}%)` +
    `  win ${pct(r.win)} tie ${pct(r.tie)}  ${r.trials.toLocaleString()} futures in ${ms.toFixed(0)}ms`
  );
}

console.log('\nStructural checks:');
{
  const a = parseCards('AsAh'), b = parseCards('KsKh');
  const ra = exactEquity(a, b, []);
  const rb = exactEquity(b, a, []);
  check('equities sum to exactly 1', Math.abs(ra.equity + rb.equity - 1) < 1e-12,
    `${ra.equity} + ${rb.equity}`);
  check('preflop enumerates C(48,5) = 1,712,304', ra.trials === 1712304, `got ${ra.trials.toLocaleString()}`);
}
{
  const r = exactEquity(parseCards('AhKh'), parseCards('QsQd'), parseCards('Qh7h2c'));
  check('flop enumerates C(45,2) = 990', r.trials === 990, `got ${r.trials}`);
}
{
  const r = exactEquity(parseCards('AhKh'), parseCards('QsQd'), parseCards('Qh7h2c3d'));
  check('turn enumerates 44', r.trials === 44, `got ${r.trials}`);
}
{
  const r = exactEquity(parseCards('AhKh'), parseCards('QsQd'), parseCards('Qh7h2c3d9s'));
  check('river is a single certain outcome', r.trials === 1 && (r.equity === 0 || r.equity === 1 || r.equity === 0.5),
    `equity ${r.equity}`);
}
check('futureCount agrees with enumeration', futureCount(0, 4) === 1712304 && futureCount(3, 7) === 990);

console.log('\nOuts counting - flush draw against a set:');
{
  // Hero has the nut flush draw. Villain flopped three queens.
  const hero = parseCards('AhKh'), vill = parseCards('QsQd'), board = parseCards('Qh7h2c');
  const outs = findOuts(hero, vill, board);
  console.log(`  outs found: ${outs.map((c) => cardsToString([c])).join(' ')}`);
  // Nine hearts are unaccounted for, but 2h is NOT an out: it pairs the board
  // and upgrades villain from trips to a full house, which beats a flush.
  check('8 outs, not the naive 9', outs.length === 8, `got ${outs.length}`);
  check('2h correctly excluded', !outs.some((c) => cardsToString([c]) === '2h'));

  const unseen = deckWithout([...hero, ...vill, ...board]).length;
  const exact = exactOutProbability(8, unseen, 2);
  const shortcut = ruleOf2And4(8, 2);
  const full = exactEquity(hero, vill, board);
  console.log(`  exact chance to improve: ${pct(exact)}   rule-of-4 shortcut: ${pct(shortcut)}   (shortcut off by ${((shortcut - exact) * 100).toFixed(1)} pts)`);
  console.log(`  true equity for the whole hand: ${pct(full.equity)}`);
  check('rule of 4 is in the right neighbourhood', Math.abs(shortcut - exact) < 0.05);
}

console.log('\nMonte Carlo agrees with exact (single-combo range):');
{
  const hero = parseCards('AsKs'), vill = parseCards('QcQd');
  const truth = exactEquity(hero, vill, []);
  for (const n of [1000, 10000, 100000]) {
    const mc = rangeEquity(hero, [vill, vill], [], n, 7);
    const inside = Math.abs(mc.equity - truth.equity) <= mc.margin * 1.5;
    if (!inside) failed++;
    console.log(
      `  ${inside ? 'ok  ' : 'FAIL'} ${String(n).padStart(6)} trials: ${pct(mc.equity)} +/- ${(mc.margin * 100).toFixed(2)}` +
      `   truth ${pct(truth.equity)}   error ${((mc.equity - truth.equity) * 100).toFixed(2)} pts`
    );
  }
  console.log('  (note the error bar shrinking with the square root of trials - 100x the');
  console.log('   work buys only 10x the precision, which is why we enumerate when we can)');
}

console.log('\nPot odds and bet sizing:');
check('call 50 into a 100 pot needs 33.3%', Math.abs(requiredEquity(50, 100) - 1 / 3) < 1e-9, pct(requiredEquity(50, 100)));
check('half-pot bet: defend 66.7%', Math.abs(minimumDefenseFrequency(50, 100) - 2 / 3) < 1e-9, pct(minimumDefenseFrequency(50, 100)));
check('pot-sized bet: defend 50%', Math.abs(minimumDefenseFrequency(100, 100) - 0.5) < 1e-9, pct(minimumDefenseFrequency(100, 100)));
check('half-pot bluff must work 33.3%', Math.abs(bluffBreakEven(50, 100) - 1 / 3) < 1e-9, pct(bluffBreakEven(50, 100)));
check('pot-sized bluff must work 50%', Math.abs(bluffBreakEven(100, 100) - 0.5) < 1e-9, pct(bluffBreakEven(100, 100)));

console.log(failed === 0 ? '\nALL TESTS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
