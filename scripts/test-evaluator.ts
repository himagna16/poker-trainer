/**
 * The evaluator has to be exactly right - every odds number in the app is built
 * on it. Rather than hand-writing a few dozen example hands and hoping we
 * thought of the tricky ones, we use a test that checks all of them at once.
 *
 * Deal out every possible 5-card hand (there are 2,598,960) and count how many
 * land in each category. Those counts are fixed mathematical facts about a deck
 * of cards, known for centuries. If even one hand is misclassified - one wheel
 * missed, one full-house-over-flush mixed up - the totals shift and the test
 * fails. It is very hard to be wrong in a way this doesn't catch.
 */
import { evaluate, categoryOf, CATEGORY_NAMES, describeHand } from '../src/lib/poker/evaluator';
import { parseCards, cardsToString } from '../src/lib/poker/cards';

const EXPECTED = [
  ['High card', 1302540],
  ['Pair', 1098240],
  ['Two pair', 123552],
  ['Three of a kind', 54912],
  ['Straight', 10200],
  ['Flush', 5108],
  ['Full house', 3744],
  ['Four of a kind', 624],
  ['Straight flush', 40],
] as const;

const counts = new Array(9).fill(0);
const distinct = new Set<number>();
const hand = [0, 0, 0, 0, 0];

for (let a = 0; a < 48; a++) {
  hand[0] = a;
  for (let b = a + 1; b < 49; b++) {
    hand[1] = b;
    for (let c = b + 1; c < 50; c++) {
      hand[2] = c;
      for (let d = c + 1; d < 51; d++) {
        hand[3] = d;
        for (let e = d + 1; e < 52; e++) {
          hand[4] = e;
          const score = evaluate(hand);
          counts[categoryOf(score)]++;
          distinct.add(score);
        }
      }
    }
  }
}

let failed = 0;
console.log('Category               got         expected');
console.log('-------------------------------------------');
for (let i = 8; i >= 0; i--) {
  const [name, want] = EXPECTED[i];
  const got = counts[i];
  const ok = got === want;
  if (!ok) failed++;
  console.log(
    `${name.padEnd(20)} ${String(got).padStart(9)} ${String(want).padStart(15)}  ${ok ? 'ok' : 'FAIL'}`
  );
}

const total = counts.reduce((x, y) => x + y, 0);
console.log('-------------------------------------------');
console.log(`total hands          ${String(total).padStart(9)} ${String(2598960).padStart(15)}  ${total === 2598960 ? 'ok' : 'FAIL'}`);
console.log(`distinct strengths   ${String(distinct.size).padStart(9)} ${String(7462).padStart(15)}  ${distinct.size === 7462 ? 'ok' : 'FAIL'}`);
if (total !== 2598960) failed++;
if (distinct.size !== 7462) failed++;

// A few hands where the rules are easy to get wrong, checked by hand.
console.log('\nTricky cases:');
const CASES: Array<[string, string]> = [
  ['Ah5h4c3d2s', 'wheel straight, ace plays low'],
  ['AhKhQhJhTh', 'royal flush'],
  ['5h4h3h2hAh', 'steel wheel - straight flush, five high'],
  ['KsKhKdQsQh', 'full house, kings full of queens'],
  ['9h9d9s9c2h', 'quads with a deuce kicker'],
  ['AhAdKsKhQc', 'two pair, aces and kings'],
  ['7h6h5h4h3s', 'only four hearts - a plain seven-high straight'],
];
for (const [str, note] of CASES) {
  const cards = parseCards(str);
  console.log(`  ${cardsToString(cards).padEnd(14)} -> ${describeHand(evaluate(cards)).padEnd(42)} (${note})`);
}

/**
 * Traps: hands that contain more than one made hand at the same time. The
 * evaluator has to report the BEST one, which is why it checks categories from
 * strongest to weakest and stops at the first match.
 */
console.log('\nTraps (two made hands in the same seven cards):');
const TRAPS: Array<[string, string, string]> = [
  ['AhKhQhJh9hTdTs', 'Flush, Ace high',
   'a broadway straight AND a flush - the flush has to win'],
  ['9h8h7h6h5h2d2s', 'Straight flush, Nine high',
   'a flush and a straight made of the SAME cards - must read as one straight flush'],
  ['AhAdKsKhQcQd2s', 'Two pair, Aces and Kings',
   'three pairs - play the top two, the odd pair is still a legal kicker'],
  ['9h9d9s4h4d4c2s', 'Full house, Nines full of Fours',
   'two sets of trips - the lower set demotes to the pair half of a boat'],
  ['2h3h4h5h6h7h8h', 'Straight flush, Eight high',
   'seven straight-flush cards - must find the best five, not the first five'],
];
for (const [str, want, note] of TRAPS) {
  const got = describeHand(evaluate(parseCards(str)));
  const ok = got === want;
  if (!ok) failed++;
  console.log(`  ${str.padEnd(14)} -> ${got.padEnd(30)} ${ok ? 'ok  ' : 'FAIL'} (${note})`);
}

// Speed: how many 7-card hands can we score per second? This sets the ceiling
// on how many simulated futures we can afford when computing live odds.
const bench: number[] = [];
for (let i = 0; i < 7; i++) bench.push(i);
const N = 2_000_000;
const t0 = performance.now();
let sink = 0;
for (let i = 0; i < N; i++) {
  bench[0] = i % 52;
  bench[1] = (i * 7 + 3) % 52;
  bench[6] = (i * 13 + 11) % 52;
  sink ^= evaluate(bench);
}
const secs = (performance.now() - t0) / 1000;
console.log(`\nSpeed: ${(N / secs / 1e6).toFixed(2)}M evaluations/sec  (${N.toLocaleString()} in ${secs.toFixed(2)}s, checksum ${sink})`);

console.log(failed === 0 ? '\nALL TESTS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
