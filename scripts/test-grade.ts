/**
 * The grader is the heart of the app, so it has to reproduce things we already
 * know are true about poker.
 *
 * Two tests carry most of the weight. The first is that an identical bluff
 * should be PROFITABLE against a player who folds too much and UNPROFITABLE
 * against one who never folds - same cards, same board, opposite answer. The
 * second is that the same bluff should fall apart as opponents are added,
 * because each one has to fold independently. If the grader gets both right,
 * it's genuinely modelling the table rather than just measuring hand strength.
 */
import { buildSpot, uniformLineup, uniformBook } from '../src/lib/poker/testing';
import { gradeDecision, foldsOutProbability } from '../src/lib/poker/grade';
import { getPersona, botPolicy } from '../src/lib/poker/bots';
import { legalActions } from '../src/lib/poker/engine';

let failed = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '   ' + detail : ''}`);
};
const bb = (x: number) => `${x >= 0 ? '+' : ''}${(x / 2).toFixed(2)}bb`;

/* ---------------------------------------------------------------- */
console.log('1. Folding is worth exactly zero from the current decision point.');
console.log('   You give up what you already put in either way, so folding is the');
console.log('   natural zero every other option gets measured against.\n');
{
  const s = buildSpot({
    playerCount: 6, heroSeat: 0, button: 0, street: 1,
    holes: { 0: '7h2c', 3: 'AsAd' }, board: 'Kh9s4d',
    invested: [10, 0, 0, 40, 0, 0], committed: [10, 0, 0, 40, 0, 0],
    folded: [false, true, true, false, true, true], toAct: 0,
  });
  const g = gradeDecision(s, 0, uniformLineup(6, 0, 'tag'), uniformBook(s, 0, 0.3), null, { trials: 300 })!;
  const fold = g.options.find((o) => o.action.type === 'fold')!;
  check('fold EV is exactly 0.00 against their hand', fold.evVsHand === 0, `${fold.evVsHand}`);
  check('fold EV is exactly 0.00 against their range', fold.evVsRange === 0, `${fold.evVsRange}`);
}

/* ---------------------------------------------------------------- */
console.log('\n2. THE OPPONENT TEST - the same bluff against opposite players.\n');
{
  const spot = () => buildSpot({
    playerCount: 2, heroSeat: 0, button: 0, street: 1,
    holes: { 0: '7h2c', 1: 'Qs9d' }, board: 'Kh8s4d',
    invested: [20, 20], committed: [0, 0], toAct: 0,
  });
  const out: Record<string, { bet: number; check: number; best: string }> = {};
  for (const id of ['rock', 'station']) {
    const s = spot();
    const g = gradeDecision(s, 0, uniformLineup(2, 0, id), uniformBook(s, 0, 0.45), null, { trials: 1200 })!;
    const chk = g.options.find((o) => o.action.type === 'check')!;
    const bestBet = g.options.filter((o) => o.action.type === 'bet')
      .reduce((a, b) => (b.evVsRange > a.evVsRange ? b : a));
    out[id] = { bet: bestBet.evVsRange, check: chk.evVsRange, best: g.bestVsRange.label };
    console.log(
      `   vs ${getPersona(id).name.padEnd(20)} best bluff ${bb(bestBet.evVsRange).padStart(9)}   ` +
      `check ${bb(chk.evVsRange).padStart(8)}   -> ${g.bestVsRange.label}`
    );
  }
  console.log();
  const gap = (out.rock.bet - out.rock.check) - (out.station.bet - out.station.check);
  check('bluffing gains far more against the folder', gap > 5, `edge is ${bb(gap)} larger vs the rock`);
  check('the recommendation changes with the opponent', out.rock.best !== out.station.best,
    `"${out.rock.best}" vs "${out.station.best}"`);
}

/* ---------------------------------------------------------------- */
console.log('\n3. THE CROWD TEST - the same bluff against more and more players.\n');
console.log('   Identical cards and board, and a half-pot bet every time so the');
console.log('   comparison is fair. Each opponent has to fold independently, so');
console.log('   the chance of taking it down compounds downwards fast.\n');
{
  const results: Array<{ n: number; folds: number; perPlayer: number; bet: number; check: number }> = [];
  for (const opponents of [1, 2, 3, 5]) {
    const n = opponents + 1;
    const s = buildSpot({
      playerCount: n, heroSeat: 0, button: 0, street: 1,
      holes: { 0: '7h2c' }, board: 'Kh8s4d',
      invested: new Array(n).fill(20), committed: new Array(n).fill(0),
      folded: new Array(n).fill(false), toAct: 0,
    });
    const lineup = uniformLineup(n, 0, 'tag');
    const book = uniformBook(s, 0, 0.4);

    // Hold the bet size constant at half pot. Measuring each case's own best bet
    // would compare a small bet against a shove and tell us nothing about the
    // effect of adding players.
    const betOption = legalActions(s).find((a) => a.type === 'bet')!;
    const halfPot = Math.max(betOption.min!, Math.min(betOption.max!, Math.round(s.pot * 0.5)));
    const action = { type: 'bet' as const, amount: halfPot };

    const g = gradeDecision(s, 0, lineup, book, action, { trials: 800 })!;
    const chk = g.options.find((o) => o.action.type === 'check')!;
    const folds = foldsOutProbability(s, 0, lineup, book, action) ?? 0;
    // The nth root recovers what each individual player does, so we can see that
    // the collapse is compounding rather than each player getting tighter.
    const perPlayer = Math.pow(folds, 1 / opponents);
    results.push({ n: opponents, folds, perPlayer, bet: g.chosen!.evVsRange, check: chk.evVsRange });
    console.log(
      `   ${String(opponents).padStart(2)} opponent(s): each folds ${(perPlayer * 100).toFixed(0)}%, ` +
      `so all of them fold ${(folds * 100).toFixed(0).padStart(3)}%   ` +
      `bet ${bb(g.chosen!.evVsRange).padStart(9)}   check ${bb(chk.evVsRange).padStart(8)}`
    );
  }
  console.log();
  check('the chance of everyone folding falls with each extra opponent',
    results.every((r, i) => i === 0 || r.folds < results[i - 1].folds),
    results.map((r) => `${(r.folds * 100).toFixed(0)}%`).join(' -> '));
  check('bluffing gets worse relative to checking as players are added',
    (results[0].bet - results[0].check) > (results[results.length - 1].bet - results[results.length - 1].check),
    `${bb(results[0].bet - results[0].check)} heads-up vs ${bb(results[results.length - 1].bet - results[results.length - 1].check)} five-handed`);
}

/* ---------------------------------------------------------------- */
console.log('\n4. Equity drops as opponents are added - a hand only has to be beaten once.\n');
{
  for (const opponents of [1, 2, 4]) {
    const n = opponents + 1;
    const s = buildSpot({
      playerCount: n, heroSeat: 0, button: 0, street: 1,
      holes: { 0: 'AhKd' }, board: 'Kc7s2h',
      invested: new Array(n).fill(20), committed: new Array(n).fill(0),
      folded: new Array(n).fill(false), toAct: 0,
    });
    const g = gradeDecision(s, 0, uniformLineup(n, 0, 'tag'), uniformBook(s, 0, 0.35), null, { trials: 200 })!;
    console.log(`   top pair, top kicker vs ${opponents} opponent(s): best ${(g.heroEquityVsRange * 100).toFixed(0)}% of the time`);
  }
}

/* ---------------------------------------------------------------- */
console.log('\n5. A monster wants money in; junk facing a big bet does not.\n');
{
  const s = buildSpot({
    playerCount: 6, heroSeat: 0, button: 0, street: 1,
    holes: { 0: 'AsAd' }, board: 'Ac7s2h',
    invested: [10, 10, 10, 0, 0, 0], committed: [0, 0, 0, 0, 0, 0],
    folded: [false, false, false, true, true, true], toAct: 0,
  });
  const g = gradeDecision(s, 0, uniformLineup(6, 0, 'station'), uniformBook(s, 0, 0.5), null, { trials: 400 })!;
  const chk = g.options.find((o) => o.action.type === 'check')!;
  console.log(`   flopped top set, three-handed vs stations -> ${g.bestVsRange.label} (${bb(g.bestVsRange.evVsRange)}), check ${bb(chk.evVsRange)}`);
  check('betting beats checking with the nuts', g.bestVsRange.evVsRange > chk.evVsRange + 0.5);
}
{
  const s = buildSpot({
    playerCount: 3, heroSeat: 0, button: 0, street: 1,
    holes: { 0: '7h2c', 1: 'AsAd' }, board: 'Kh9s4d',
    invested: [10, 90, 0], committed: [10, 90, 0], folded: [false, false, true], toAct: 0,
  });
  const g = gradeDecision(s, 0, uniformLineup(3, 0, 'rock'), uniformBook(s, 0, 0.12), { type: 'call' }, { trials: 400 })!;
  console.log(`   seven-high facing a huge bet from a rock -> best is ${g.bestVsRange.label}, calling graded "${g.verdict}"`);
  check('folding is best with nothing facing a big bet', g.bestVsRange.action.type === 'fold');
  check('calling is graded a mistake or worse', g.verdict === 'mistake' || g.verdict === 'blunder');
}

/* ---------------------------------------------------------------- */
console.log('\n6. Price sensitivity before the flop.\n');
console.log('   How wide each type continues has to depend on what the raise COSTS.');
console.log('   A bot that called 85% of hands whether facing 3bb or 100bb would make');
console.log('   the trainer recommend shoving a hundred big blinds with ace-ten, which');
console.log('   is correct against a bot that broken and ruinous at a real table.\n');
{
  const RANKS = '23456789TJQKA';
  const widths: Record<string, number[]> = { station: [], tag: [], rock: [] };
  console.log('   raise to     Station   Regular      Rock');
  for (const raiseTo of [4, 20, 200]) {
    const row: string[] = [];
    for (const id of ['station', 'tag', 'rock']) {
      const s = buildSpot({
        playerCount: 2, heroSeat: 0, button: 0, street: 0,
        holes: {}, invested: [1, raiseTo], committed: [1, raiseTo], toAct: 0,
      });
      let cont = 0;
      let total = 0;
      for (let i = 0; i < 13; i++) for (let j = 0; j < 13; j++) {
        const weight = i === j ? 6 : i > j ? 4 : 12;
        const cards = i === j ? [i * 4, i * 4 + 1] : i > j ? [i * 4, j * 4] : [i * 4, j * 4 + 1];
        total += weight;
        if (!botPolicy(s, getPersona(id), cards).some((o) => o.action.type === 'fold')) cont += weight;
      }
      widths[id].push(cont / total);
      row.push(`${((cont / total) * 100).toFixed(0)}%`.padStart(9));
    }
    console.log(`   ${String(raiseTo).padStart(4)} (${String(Math.round(raiseTo / 2)).padStart(3)}bb) ${row.join('  ')}`);
  }
  console.log();
  for (const id of ['station', 'tag', 'rock']) {
    check(`${getPersona(id).name} tightens up as the raise grows`,
      widths[id].every((w, i) => i === 0 || w < widths[id][i - 1]),
      widths[id].map((w) => `${(w * 100).toFixed(0)}%`).join(' -> '));
  }
  check('a calling station still calls far wider than a rock',
    widths.station[0] > widths.rock[0] * 4);
}
{
  const s = buildSpot({
    playerCount: 2, heroSeat: 0, button: 0, street: 0,
    holes: { 0: 'AcTd' }, invested: [1, 2], committed: [1, 2], toAct: 0,
  });
  const g = gradeDecision(s, 0, uniformLineup(2, 0, 'station'), uniformBook(s, 0, 0.85), null, { trials: 900 })!;
  const shove = g.options.find((o) => o.action.type === 'raise' && o.action.amount === 200);
  console.log(`   ace-ten heads-up vs a station -> recommends ${g.bestVsRange.label}` +
    (shove ? `, shoving 100bb is ${bb(shove.evVsRange)}` : ''));
  check('does not recommend shoving 100bb with ace-ten',
    g.bestVsRange.action.type !== 'raise' || (g.bestVsRange.action.amount ?? 0) < 100);
  if (shove) check('shoving 100bb with ace-ten is not profitable', shove.evVsRange < 0, bb(shove.evVsRange));
}

/* ---------------------------------------------------------------- */
console.log('\n7. Speed - grading has to keep up with clicking.\n');
{
  for (const n of [2, 6, 9]) {
    const s = buildSpot({
      playerCount: n, heroSeat: 0, button: 0, street: 1,
      holes: { 0: 'AhKh' }, board: 'Kd8s4d',
      invested: new Array(n).fill(20), committed: new Array(n).fill(0),
      folded: new Array(n).fill(false), toAct: 0,
    });
    const t0 = performance.now();
    const g = gradeDecision(s, 0, uniformLineup(n, 0, 'tag'), uniformBook(s, 0, 0.4), null, { trials: 700 })!;
    const ms = performance.now() - t0;
    const ok = ms < 900;
    if (!ok) failed++;
    console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${n}-handed: ${g.options.length} options x ${g.trials} replays in ${ms.toFixed(0)}ms  -> ${g.bestVsRange.label}`);
  }
}

console.log(failed === 0 ? '\nALL TESTS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
