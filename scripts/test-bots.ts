/**
 * Do the bots play like the players they're named after, and do they adjust to
 * position and to the size of the table?
 *
 * Reading the code can't answer that. The only real test is to sit them down
 * against each other for a lot of hands and look at the numbers.
 *
 * Results are in bb/100 - big blinds won per 100 hands, how poker results are
 * always quoted. A strong live player makes 5-10 bb/100.
 */
import { newHand, applyAction, netResult, legalActions, positionLabel } from '../src/lib/poker/engine';
import type { HandState } from '../src/lib/poker/engine';
import { PERSONAS, botAction, botPolicy, getPersona, crowdAdjusted } from '../src/lib/poker/bots';
import type { BotPersona } from '../src/lib/poker/bots';
import { makeRng, parseCards } from '../src/lib/poker/cards';

const BB = 2;
let failed = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '   ' + detail : ''}`);
};

/* ---------------------------------------------------------------- */
console.log('Position awareness - the same hand, from every seat at a 6-max table.\n');
{
  // A hand that is a clear fold up front and a clear open on the button.
  const hand = parseCards('9s8s');
  const persona = getPersona('tag');
  const opens: string[] = [];
  let openCount = 0;

  for (let seat = 0; seat < 6; seat++) {
    // Build a table where everyone before this seat has folded.
    let s: HandState = newHand({ playerCount: 6, button: 0, bigBlind: BB, seed: 99 });
    let guard = 0;
    while (s.toAct !== seat && !s.complete && guard++ < 10) {
      s = applyAction(s, { type: 'fold' });
    }
    if (s.complete || s.toAct !== seat) continue;
    const policy = botPolicy(s, persona, hand);
    const raises = policy.some((o) => o.action.type === 'raise' || o.action.type === 'bet');
    if (raises) openCount++;
    opens.push(`    ${positionLabel(s, seat).padEnd(4)} ${raises ? 'raises' : policy[0].action.type}`);
  }
  for (const line of opens) console.log(line);
  check('98 suited is played from some seats but not others', openCount > 0 && openCount < opens.length,
    `opened from ${openCount} of ${opens.length} seats`);
}

console.log('\nOpening frequency by seat (The Regular, 6-max, folded to them):\n');
{
  const persona = getPersona('tag');
  const rng = makeRng(7);
  const counts = new Array(6).fill(0);
  const totals = new Array(6).fill(0);
  const labels = new Array(6).fill('');
  const N = 4000;

  for (let seat = 0; seat < 6; seat++) {
    for (let h = 0; h < N; h++) {
      let s: HandState = newHand({ playerCount: 6, button: 0, bigBlind: BB, seed: (rng() * 2 ** 31) | 0 });
      let guard = 0;
      while (s.toAct !== seat && !s.complete && guard++ < 10) s = applyAction(s, { type: 'fold' });
      if (s.complete || s.toAct !== seat) continue;
      labels[seat] = positionLabel(s, seat);
      totals[seat]++;
      const policy = botPolicy(s, persona);
      if (policy.some((o) => o.action.type === 'raise' || o.action.type === 'bet')) counts[seat]++;
    }
  }
  // Seats in order of when they speak preflop, ending at the button. The small
  // blind is deliberately listed apart: it speaks late preflop but acts FIRST
  // on every street afterwards, so a good player opens it TIGHTER than the
  // button despite being later in the preflop order. A test that demanded a
  // straight line through the small blind would be demanding a mistake.
  const order = [3, 4, 5, 0];
  const pcts: number[] = [];
  for (const seat of order) {
    if (!totals[seat]) continue;
    const pct = (counts[seat] / totals[seat]) * 100;
    pcts.push(pct);
    console.log(`    ${labels[seat].padEnd(4)} opens ${pct.toFixed(0).padStart(3)}% of hands`);
  }
  const sbPct = totals[1] ? (counts[1] / totals[1]) * 100 : 0;
  console.log(`    ${labels[1].padEnd(4)} opens ${sbPct.toFixed(0).padStart(3)}% of hands  (tighter than the button on purpose - out of position postflop)`);
  console.log('    (a solid live player runs about 15% UTG, 26% CO, 42% BTN)');
  check('opening range widens steadily from under the gun to the button',
    pcts.every((v, i) => i === 0 || v > pcts[i - 1]),
    pcts.map((p) => p.toFixed(0) + '%').join(' -> '));
  check('button opens widest of all seats', pcts[pcts.length - 1] > sbPct,
    `BTN ${pcts[pcts.length - 1].toFixed(0)}% vs SB ${sbPct.toFixed(0)}%`);
}

/* ---------------------------------------------------------------- */
console.log('\nCrowd awareness - the same flopped top pair against more opponents.\n');
{
  const topPair = 0.55;
  const values = [1, 2, 3, 5].map((n) => crowdAdjusted(topPair, n));
  for (let i = 0; i < values.length; i++) {
    console.log(`    vs ${[1, 2, 3, 5][i]} opponent(s): strength ${values[i].toFixed(2)}`);
  }
  check('top pair is worth steadily less against more players',
    values.every((v, i) => i === 0 || v < values[i - 1]));
}

/* ---------------------------------------------------------------- */
console.log('\nHead-to-head, heads-up, 20,000 hands per pairing.\n');

function playMatch(a: BotPersona, b: BotPersona, hands: number, seed: number) {
  const rng = makeRng(seed);
  let netA = 0;
  let illegal = 0;
  const stats = [
    { vpip: 0, pfr: 0, sawFlop: 0, showdown: 0, hands: 0 },
    { vpip: 0, pfr: 0, sawFlop: 0, showdown: 0, hands: 0 },
  ];

  for (let h = 0; h < hands; h++) {
    let s: HandState = newHand({
      playerCount: 2, startingStack: 200, button: h % 2, bigBlind: BB,
      seed: (rng() * 2 ** 31) | 0,
    });
    const voluntary = [false, false];
    const raised = [false, false];
    stats[0].hands++; stats[1].hands++;

    let guard = 0;
    while (!s.complete && guard++ < 200) {
      const seat = s.toAct;
      const action = botAction(s, seat === 0 ? a : b, rng);
      if (!legalActions(s).some((l) => l.type === action.type)) { illegal++; break; }
      if (s.street === 0) {
        if (action.type !== 'fold' && action.type !== 'check') voluntary[seat] = true;
        if (action.type === 'raise' || action.type === 'bet') raised[seat] = true;
      }
      s = applyAction(s, action);
    }
    for (const i of [0, 1]) {
      if (voluntary[i]) stats[i].vpip++;
      if (raised[i]) stats[i].pfr++;
      if (s.board.length >= 3) stats[i].sawFlop++;
    }
    if (s.result?.showdown) { stats[0].showdown++; stats[1].showdown++; }
    netA += netResult(s)[0];
  }
  return { bb100: (netA / BB / hands) * 100, stats, illegal };
}

const names = PERSONAS.map((p) => p.name);
const width = Math.max(...names.map((n) => n.length)) + 1;
const grid: (number | null)[][] = PERSONAS.map(() => PERSONAS.map(() => null));
const overall = PERSONAS.map(() => 0);
let totalIllegal = 0;

// Each pair plays once; A beating B by x means B loses x to A, so running both
// directions separately would just give two noisy estimates that disagree.
for (let i = 0; i < PERSONAS.length; i++) {
  for (let j = i + 1; j < PERSONAS.length; j++) {
    const r = playMatch(PERSONAS[i], PERSONAS[j], 20000, 1000 + i * 31 + j);
    totalIllegal += r.illegal;
    grid[i][j] = r.bb100; grid[j][i] = -r.bb100;
    overall[i] += r.bb100; overall[j] -= r.bb100;
  }
}

process.stdout.write(''.padEnd(width + 2));
for (const n of names) process.stdout.write(n.slice(0, 9).padStart(11));
console.log();
for (let i = 0; i < PERSONAS.length; i++) {
  process.stdout.write(('  ' + names[i]).padEnd(width + 2));
  for (let j = 0; j < PERSONAS.length; j++) {
    const v = grid[i][j];
    process.stdout.write(v === null ? '        -  ' : ((v >= 0 ? '+' : '') + v.toFixed(1)).padStart(11));
  }
  console.log();
}
console.log('\n  Overall:');
for (const r of PERSONAS.map((p, i) => ({ name: p.name, score: overall[i] })).sort((x, y) => y.score - x.score)) {
  console.log(`    ${r.name.padEnd(width)} ${(r.score >= 0 ? '+' : '') + r.score.toFixed(1)}`);
}

/* ---------------------------------------------------------------- */
console.log('\nSix-handed table, all five types plus a second Regular, 40,000 hands.\n');
{
  const lineup = ['tag', 'station', 'rock', 'lag', 'maniac', 'tag'].map(getPersona);
  const rng = makeRng(4242);
  const net = new Array(6).fill(0);
  const vpip = new Array(6).fill(0);
  const pfr = new Array(6).fill(0);
  const HANDS = 40000;
  let illegal = 0;

  for (let h = 0; h < HANDS; h++) {
    let s: HandState = newHand({
      playerCount: 6, startingStack: 200, button: h % 6, bigBlind: BB,
      seed: (rng() * 2 ** 31) | 0,
    });
    const voluntary = new Array(6).fill(false);
    const raised = new Array(6).fill(false);
    let guard = 0;
    while (!s.complete && guard++ < 300) {
      const seat = s.toAct;
      const action = botAction(s, lineup[seat], rng);
      if (!legalActions(s).some((l) => l.type === action.type)) { illegal++; break; }
      if (s.street === 0) {
        if (action.type !== 'fold' && action.type !== 'check') voluntary[seat] = true;
        if (action.type === 'raise' || action.type === 'bet') raised[seat] = true;
      }
      s = applyAction(s, action);
    }
    const r = netResult(s);
    for (let i = 0; i < 6; i++) {
      net[i] += r[i];
      if (voluntary[i]) vpip[i]++;
      if (raised[i]) pfr[i]++;
    }
  }

  console.log('    Seat  Player                bb/100    VPIP   PFR');
  for (let i = 0; i < 6; i++) {
    const rate = (net[i] / BB / HANDS) * 100;
    console.log(
      `    ${String(i + 1).padEnd(6)}${lineup[i].name.padEnd(22)}` +
      `${((rate >= 0 ? '+' : '') + rate.toFixed(1)).padStart(7)}` +
      `${((vpip[i] / HANDS) * 100).toFixed(0).padStart(8)}%` +
      `${((pfr[i] / HANDS) * 100).toFixed(0).padStart(6)}%`
    );
  }
  const sum = net.reduce((a, b) => a + b, 0);
  check('six-handed chips sum to zero across the table', sum === 0, `${sum}`);
  check('no illegal actions at a full table', illegal === 0, `${illegal}`);
  const rockVpip = vpip[2] / HANDS;
  const maniacVpip = vpip[4] / HANDS;
  check('the rock plays far fewer hands than the maniac', rockVpip < maniacVpip * 0.4,
    `${(rockVpip * 100).toFixed(0)}% vs ${(maniacVpip * 100).toFixed(0)}%`);
}

check('no illegal actions across all heads-up matchups', totalIllegal === 0, `${totalIllegal}`);
console.log(failed === 0 ? '\nALL BOT CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
