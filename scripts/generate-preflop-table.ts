/**
 * Precompute how strong each of the 169 starting hands is.
 *
 * You can be dealt 1,326 different two-card combinations, but only 169 that
 * play differently - the ace-king of hearts and the ace-king of spades are the
 * same hand. This measures each one and writes the results out as a plain table
 * the app imports.
 *
 * WHY WE RANK BY EQUITY AGAINST A STRONG RANGE, NOT AGAINST A RANDOM HAND
 *
 * The obvious measure is "how often does this hand beat a random hand". It's
 * also wrong, and wrong in a way that would teach bad habits.
 *
 * Against a random hand, K5o wins about 51% and 76s about 46% - so the naive
 * ranking says K5o is the better hand. Every real preflop chart disagrees, and
 * they're right. You almost never play a pot against a random hand. You play it
 * against someone who chose to put money in, and that person has good cards.
 *
 * Against that kind of range, K5o is a disaster: when a king flops you are
 * beaten by AK, KQ and KJ, so the hand's own "strength" is what loses you money.
 * 76s has no such problem - it either makes a straight or a flush that nobody
 * sees coming, or it folds cheaply.
 *
 * So we rank by equity against the top quarter of hands. That single change
 * moves suited connectors and small pairs up, pushes dominated offsuit high
 * cards down, and lands close to the charts serious players actually use.
 */
import { makeDeck, handNotation, RANK_CHARS, makeCard } from '../src/lib/poker/cards';
import { rangeEquity } from '../src/lib/poker/equity';
import { writeFileSync } from 'node:fs';

const TRIALS_RANDOM = 40000;
const TRIALS_STRONG = 60000;
/** The share of hands we treat as "someone who is actually in this pot". */
const CONTINUING_RANGE = 0.25;

const deck = makeDeck();
const allCombos: number[][] = [];
for (let i = 0; i < 52; i++) for (let j = i + 1; j < 52; j++) allCombos.push([deck[i], deck[j]]);

/** One representative combination of each hand, plus how many exist. */
function representative(hand: string): { cards: number[]; combos: number } {
  const r1 = RANK_CHARS.indexOf(hand[0]);
  const r2 = RANK_CHARS.indexOf(hand[1]);
  if (r1 === r2) return { cards: [makeCard(r1, 0), makeCard(r2, 1)], combos: 6 };
  return hand[2] === 's'
    ? { cards: [makeCard(r1, 0), makeCard(r2, 0)], combos: 4 }
    : { cards: [makeCard(r1, 0), makeCard(r2, 1)], combos: 12 };
}

/** Every combination of a hand, needed to build a range out of it. */
function allCombosOf(hand: string): number[][] {
  const r1 = RANK_CHARS.indexOf(hand[0]);
  const r2 = RANK_CHARS.indexOf(hand[1]);
  const out: number[][] = [];
  if (r1 === r2) {
    for (let a = 0; a < 4; a++) for (let b = a + 1; b < 4; b++) out.push([makeCard(r1, a), makeCard(r2, b)]);
  } else if (hand[2] === 's') {
    for (let s = 0; s < 4; s++) out.push([makeCard(r1, s), makeCard(r2, s)]);
  } else {
    for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) if (a !== b) out.push([makeCard(r1, a), makeCard(r2, b)]);
  }
  return out;
}

const hands: string[] = [];
for (let i = 12; i >= 0; i--) {
  for (let j = 12; j >= 0; j--) {
    if (i === j) hands.push(RANK_CHARS[i] + RANK_CHARS[j]);
    else if (i > j) hands.push(RANK_CHARS[i] + RANK_CHARS[j] + 's');
    else hands.push(RANK_CHARS[j] + RANK_CHARS[i] + 'o');
  }
}
const unique = [...new Set(hands)];

// --- Pass one: equity against a random hand. Not used for ranking, but it's
// the number people recognise ("aces win 85%") so we keep it for display.
console.log(`Pass 1: ${unique.length} hands against a random hand...`);
const t0 = performance.now();
const randomEquity = new Map<string, number>();
const comboCount = new Map<string, number>();
for (const hand of unique) {
  const { cards, combos } = representative(hand);
  randomEquity.set(hand, rangeEquity(cards, allCombos, [], TRIALS_RANDOM, 999).equity);
  comboCount.set(hand, combos);
}

// --- Build the continuing range: the strongest quarter of all hands, by combo
// count rather than by list position, since pairs are 6 combos and offsuit
// hands are 12.
const byRandom = [...unique].sort((a, b) => randomEquity.get(b)! - randomEquity.get(a)!);
const strongRange: number[][] = [];
let weight = 0;
const strongHands: string[] = [];
for (const hand of byRandom) {
  if (weight / 1326 >= CONTINUING_RANGE) break;
  strongRange.push(...allCombosOf(hand));
  strongHands.push(hand);
  weight += comboCount.get(hand)!;
}
console.log(`  continuing range: top ${((weight / 1326) * 100).toFixed(0)}% of hands (${strongHands.length} hand types, ${strongRange.length} combos)`);
console.log(`  ${strongHands.slice(0, 18).join(' ')} ...`);

// --- Pass two: equity against that range. This is what we rank by.
console.log(`\nPass 2: ${unique.length} hands against the continuing range...`);
const strongEquity = new Map<string, number>();
for (const hand of unique) {
  const { cards } = representative(hand);
  strongEquity.set(hand, rangeEquity(cards, strongRange, [], TRIALS_STRONG, 4242).equity);
}
console.log(`Done in ${((performance.now() - t0) / 1000).toFixed(1)}s\n`);

const rows = unique
  .map((hand) => ({
    hand,
    eq: randomEquity.get(hand)!,
    vs: strongEquity.get(hand)!,
    combos: comboCount.get(hand)!,
  }))
  .sort((a, b) => b.vs - a.vs);

let cumulative = 0;
const table: Record<string, { eq: number; vs: number; pct: number }> = {};
for (const row of rows) {
  cumulative += row.combos;
  table[row.hand] = {
    eq: Math.round(row.eq * 10000) / 10000,
    vs: Math.round(row.vs * 10000) / 10000,
    pct: Math.round((cumulative / 1326) * 10000) / 10000,
  };
}

console.log('Strongest fifteen:');
for (const r of rows.slice(0, 15)) {
  console.log(`  ${r.hand.padEnd(4)} vs strong ${(r.vs * 100).toFixed(1)}%   vs random ${(r.eq * 100).toFixed(1)}%   top ${(table[r.hand].pct * 100).toFixed(1)}%`);
}
console.log('\nThe hands this ranking fixes:');
for (const h of ['76s', 'K5o', '98s', '22', 'J9o', '65s', 'Q6o', 'T9s', 'K2o']) {
  const t = table[h];
  if (t) console.log(`  ${h.padEnd(4)} vs strong ${(t.vs * 100).toFixed(1)}%   vs random ${(t.eq * 100).toFixed(1)}%   top ${(t.pct * 100).toFixed(1)}%`);
}

const out = `/**
 * AUTO-GENERATED by scripts/generate-preflop-table.ts - do not edit by hand.
 *
 * For each of the 169 distinct starting hands:
 *   eq  = equity against a completely random hand. The familiar number, kept
 *         for display ("aces win 85% of the time").
 *   vs  = equity against the top ${(CONTINUING_RANGE * 100).toFixed(0)}% of hands - roughly what someone who
 *         has voluntarily put money in actually holds.
 *   pct = where the hand ranks when sorted by \`vs\`, weighted by how many
 *         combinations of it exist. pct 0.15 means "top 15% of hands dealt".
 *
 * We rank by \`vs\`, not \`eq\`. Against a random hand K5o beats 76s; against a
 * range of real hands it's the other way round, because K5o is dominated by
 * every better king while 76s makes hands nobody sees coming. Ranking by \`eq\`
 * would have the app teaching the opposite of every serious preflop chart.
 */
export interface PreflopEntry { eq: number; vs: number; pct: number }

export const PREFLOP_STRENGTH: Record<string, PreflopEntry> = ${JSON.stringify(table, null, 2)};

/** Equity against a completely random hand, 0..1. */
export function preflopEquity(hand: string): number {
  return PREFLOP_STRENGTH[hand]?.eq ?? 0.35;
}

/** Equity against the range of hands that actually continue against you, 0..1. */
export function preflopEquityVsRange(hand: string): number {
  return PREFLOP_STRENGTH[hand]?.vs ?? 0.3;
}

/** 0..1, smaller is stronger. 0.05 means the top 5% of starting hands. */
export function preflopPercentile(hand: string): number {
  return PREFLOP_STRENGTH[hand]?.pct ?? 1;
}
`;
writeFileSync('src/lib/poker/preflopStrength.ts', out);
console.log('\nWrote src/lib/poker/preflopStrength.ts');
