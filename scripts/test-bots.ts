/**
 * Do the bots actually play like the players they're named after?
 *
 * We can't check this by reading the code - the only real test is to sit them
 * down against each other for a lot of hands and look at who wins.
 *
 * The scoreboard is in bb/100: big blinds won per 100 hands, which is how poker
 * results are always quoted. A strong live player might make 5-10 bb/100. Losing
 * 50 bb/100 means you are on fire.
 *
 * We also track the standard read-your-opponent stats, because these are the
 * numbers the trainer will show you about your OWN play later:
 *   VPIP - how often they voluntarily put money in before the flop
 *   PFR  - how often they raise before the flop
 *   WTSD - how often they reach a showdown once they've seen a flop
 */
import { newHand, applyAction, netResult, legalActions } from '../src/lib/poker/engine';
import type { HandState } from '../src/lib/poker/engine';
import { PERSONAS, botAction } from '../src/lib/poker/bots';
import type { BotPersona } from '../src/lib/poker/bots';
import { makeRng } from '../src/lib/poker/cards';

const HANDS = 20000;
const BB = 2;

interface Stats { vpip: number; pfr: number; sawFlop: number; showdown: number; hands: number }
const blank = (): Stats => ({ vpip: 0, pfr: 0, sawFlop: 0, showdown: 0, hands: 0 });

function playMatch(a: BotPersona, b: BotPersona, hands: number, seed: number) {
  const rng = makeRng(seed);
  let netA = 0;
  const stats: [Stats, Stats] = [blank(), blank()];
  let illegal = 0;

  for (let h = 0; h < hands; h++) {
    const button = h % 2;
    let s: HandState = newHand({ stacks: [200, 200], button, bigBlind: BB, seed: (rng() * 2 ** 31) | 0 });
    const voluntary = [false, false];
    const raised = [false, false];
    stats[0].hands++;
    stats[1].hands++;

    let guard = 0;
    while (!s.complete && guard++ < 200) {
      const seat = s.toAct;
      const persona = seat === 0 ? a : b;
      const action = botAction(s, persona, rng);
      const legal = legalActions(s);
      if (!legal.some((l) => l.type === action.type)) {
        illegal++;
        break;
      }
      if (s.street === 0) {
        if (action.type === 'call' || action.type === 'raise' || action.type === 'bet') voluntary[seat] = true;
        if (action.type === 'raise' || action.type === 'bet') raised[seat] = true;
      }
      s = applyAction(s, action);
    }

    for (const i of [0, 1]) {
      if (voluntary[i]) stats[i].vpip++;
      if (raised[i]) stats[i].pfr++;
      if (s.board.length >= 3) stats[i].sawFlop++;
    }
    if (s.result?.showdown) {
      stats[0].showdown++;
      stats[1].showdown++;
    }
    netA += netResult(s)[0];
  }

  return { bb100: (netA / BB / hands) * 100, stats, illegal };
}

console.log('Head-to-head results, row player\'s bb/100 (positive = row is winning)\n');
const names = PERSONAS.map((p) => p.name);
const width = Math.max(...names.map((n) => n.length)) + 1;

process.stdout.write(''.padEnd(width + 2));
for (const n of names) process.stdout.write(n.slice(0, 9).padStart(11));
console.log();

let totalIllegal = 0;
const overall: number[] = PERSONAS.map(() => 0);
const grid: (number | null)[][] = PERSONAS.map(() => PERSONAS.map(() => null));

// Play each PAIR once. A beating B by x automatically means B loses x to A, so
// running both directions separately just produces two noisy estimates of the
// same number that disagree with each other.
for (let i = 0; i < PERSONAS.length; i++) {
  for (let j = i + 1; j < PERSONAS.length; j++) {
    const r = playMatch(PERSONAS[i], PERSONAS[j], HANDS, 1000 + i * 31 + j);
    totalIllegal += r.illegal;
    grid[i][j] = r.bb100;
    grid[j][i] = -r.bb100;
    overall[i] += r.bb100;
    overall[j] -= r.bb100;
  }
}

for (let i = 0; i < PERSONAS.length; i++) {
  process.stdout.write(('  ' + names[i]).padEnd(width + 2));
  for (let j = 0; j < PERSONAS.length; j++) {
    const v = grid[i][j];
    process.stdout.write(v === null ? '        -  ' : ((v >= 0 ? '+' : '') + v.toFixed(1)).padStart(11));
  }
  console.log();
}

console.log('\nOverall (sum of bb/100 across all opponents):');
const ranked = PERSONAS.map((p, i) => ({ name: p.name, score: overall[i] })).sort((x, y) => y.score - x.score);
for (const r of ranked) console.log(`  ${r.name.padEnd(width)} ${(r.score >= 0 ? '+' : '') + r.score.toFixed(1)}`);

console.log('\nPlaying-style stats (each bot vs The Regular):');
console.log('  Bot                 VPIP     PFR    WTSD   (real-world reference)');
for (const p of PERSONAS) {
  if (p.id === 'tag') continue;
  const r = playMatch(p, PERSONAS[3], HANDS, 77);
  const s = r.stats[0];
  console.log(
    `  ${p.name.padEnd(20)}${((s.vpip / s.hands) * 100).toFixed(0).padStart(4)}%` +
    `${((s.pfr / s.hands) * 100).toFixed(0).padStart(8)}%` +
    `${((s.showdown / Math.max(1, s.sawFlop)) * 100).toFixed(0).padStart(8)}%`
  );
}
console.log('\n  For scale: a tight live player runs about 20/16, a maniac 80/60,');
console.log('  and a calling station shows a huge gap between VPIP and PFR.');

console.log(totalIllegal === 0
  ? '\nNo illegal actions attempted across all matchups.'
  : `\nWARNING: ${totalIllegal} illegal actions attempted.`);
process.exit(totalIllegal === 0 ? 0 : 1);
