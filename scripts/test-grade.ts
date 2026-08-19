/**
 * The grader is the heart of the app, so it needs to reproduce things we
 * already know are true about poker.
 *
 * The decisive test is the last pair. Holding nothing at all, betting should be
 * PROFITABLE against a player who folds too much, and UNPROFITABLE against a
 * player who never folds - same cards, same board, opposite correct answer. If
 * the grader gets that flip right, it's genuinely modelling the opponent rather
 * than just measuring hand strength.
 */
import { newHand, applyAction } from '../src/lib/poker/engine';
import type { HandState, Street } from '../src/lib/poker/engine';
import { parseCards, deckWithout } from '../src/lib/poker/cards';
import { getPersona } from '../src/lib/poker/bots';
import { fullRange, topPercentRange, removeBlocked } from '../src/lib/poker/ranges';
import { gradeDecision } from '../src/lib/poker/grade';

let failed = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '   ' + detail : ''}`);
};

/** Build a specific situation directly, rather than playing our way into it. */
function makeSpot(o: {
  hero: string; villain: string; board: string;
  invested: [number, number]; betToMatch: number; committed: [number, number];
  street: Street; toAct?: number;
}): HandState {
  const s = newHand({ stacks: [200, 200], button: 0, bigBlind: 2, seed: 1 });
  const hero = parseCards(o.hero);
  const vill = parseCards(o.villain);
  const board = o.board ? parseCards(o.board) : [];
  s.hole = [hero, vill];
  s.board = board;
  s.street = o.street;
  s.invested = [...o.invested];
  s.committed = [...o.committed];
  s.stack = [200 - o.invested[0], 200 - o.invested[1]];
  s.pot = o.invested[0] + o.invested[1];
  s.betToMatch = o.betToMatch;
  s.lastRaiseSize = 2;
  s.acted = [false, false];
  s.folded = [false, false];
  s.allIn = [false, false];
  s.toAct = o.toAct ?? 0;
  s.log = [];
  s.complete = false;
  s.result = null;
  const rest = deckWithout([...hero, ...vill, ...board]);
  s.deck = [hero[0], hero[1], vill[0], vill[1], ...board, ...rest];
  s.deckPos = 4 + board.length;
  return s;
}

const bb = (x: number) => `${x >= 0 ? '+' : ''}${(x / 2).toFixed(2)}bb`;

console.log('1. Folding is always worth exactly zero from the current decision point.');
console.log('   (You surrender what you already put in either way, so folding is the');
console.log('    natural zero that every other option gets measured against.)\n');
{
  const s = makeSpot({
    hero: '7h2c', villain: 'AsAd', board: 'Kh9s4d',
    invested: [10, 30], committed: [10, 30], betToMatch: 30, street: 1,
  });
  const g = gradeDecision(s, 0, getPersona('tag'), removeBlocked(fullRange(), [...s.hole[0], ...s.board]), null, { trials: 400 });
  const fold = g!.options.find((o) => o.action.type === 'fold')!;
  check('fold EV is exactly 0.00 against their hand', fold.evVsHand === 0, `got ${fold.evVsHand}`);
  check('fold EV is exactly 0.00 against their range', fold.evVsRange === 0, `got ${fold.evVsRange}`);
}

console.log('\n2. A monster should want money in; junk facing a big bet should not.\n');
{
  const s = makeSpot({
    hero: 'AsAd', villain: 'Kh9d', board: 'Ac7s2h',
    invested: [10, 10], committed: [0, 0], betToMatch: 0, street: 1,
  });
  const g = gradeDecision(s, 0, getPersona('station'), removeBlocked(fullRange(), [...s.hole[0], ...s.board]), null, { trials: 500 })!;
  const chk = g.options.find((o) => o.action.type === 'check')!;
  const best = g.bestVsRange;
  console.log(`   flopped top set vs a calling station -> best: ${best.label} (${bb(best.evVsRange)}), check: ${bb(chk.evVsRange)}`);
  check('betting beats checking with the nuts vs a station', best.evVsRange > chk.evVsRange + 0.5);
}
{
  const s = makeSpot({
    hero: '7h2c', villain: 'AsAd', board: 'Kh9s4d',
    invested: [10, 90], committed: [10, 90], betToMatch: 90, street: 1,
  });
  const rock = getPersona('rock');
  const g = gradeDecision(s, 0, rock, removeBlocked(topPercentRange(rock.openPct), [...s.hole[0], ...s.board]), { type: 'call' }, { trials: 500 })!;
  console.log(`   seven-high facing a huge bet from a rock -> best: ${g.bestVsRange.label}, verdict on calling: ${g.verdict}`);
  check('folding is best with nothing facing a big bet', g.bestVsRange.action.type === 'fold');
  check('calling here is graded a mistake or worse', g.verdict === 'mistake' || g.verdict === 'blunder');
}

console.log('\n3. THE KEY TEST - the same bluff against opposite opponents.\n');
console.log('   Identical cards, identical board, identical position. The only thing');
console.log('   that changes is who we are playing against. If the grader is really');
console.log('   modelling the opponent, the answer has to move.\n');
{
  const spot = () => makeSpot({
    hero: '7h2c', villain: 'Qs9d', board: 'Kh8s4d',
    invested: [20, 20], committed: [0, 0], betToMatch: 0, street: 1,
  });

  const out: Record<string, { bet: number; check: number; best: string }> = {};
  for (const id of ['rock', 'station']) {
    const persona = getPersona(id);
    const s = spot();
    const range = removeBlocked(topPercentRange(Math.max(persona.callPct, 0.3)), [...s.hole[0], ...s.board]);
    const g = gradeDecision(s, 0, persona, range, null, { trials: 1500 })!;
    const chk = g.options.find((o) => o.action.type === 'check')!;
    const bets = g.options.filter((o) => o.action.type === 'bet');
    const bestBet = bets.reduce((a, b) => (b.evVsRange > a.evVsRange ? b : a));
    out[id] = { bet: bestBet.evVsRange, check: chk.evVsRange, best: g.bestVsRange.label };
    console.log(
      `   vs ${persona.name.padEnd(20)} best bluff ${bb(bestBet.evVsRange).padStart(9)}   ` +
      `check ${bb(chk.evVsRange).padStart(8)}   -> recommends: ${g.bestVsRange.label}`
    );
  }

  console.log();
  // The honest claim is comparative. Q-high with no draw is a hand even a
  // station folds to a big bet, so bluffing isn't outright losing against them -
  // it's just worth dramatically less than against someone who folds everything.
  const gap = (out.rock.bet - out.rock.check) - (out.station.bet - out.station.check);
  check('bluffing gains far more against the folder', gap > 5,
    `bluff edge is ${bb(gap)} larger vs the rock`);
  check('bluffing the rock clearly beats checking', out.rock.bet > out.rock.check + 2);
  check('the recommendation changes with the opponent', out.rock.best !== out.station.best,
    `"${out.rock.best}" vs "${out.station.best}"`);
}

console.log('\n   Now give the station a hand it will actually call with (bottom pair):\n');
{
  const s = makeSpot({
    hero: '7h2c', villain: '4s5d', board: 'Kh8s4d',
    invested: [20, 20], committed: [0, 0], betToMatch: 0, street: 1,
  });
  const station = getPersona('station');
  const g = gradeDecision(s, 0, station, [{ cards: parseCards('4s5d'), weight: 1 }], null, { trials: 1500 })!;
  const chk = g.options.find((o) => o.action.type === 'check')!;
  const bets = g.options.filter((o) => o.action.type === 'bet');
  const bestBet = bets.reduce((a, b) => (b.evVsRange > a.evVsRange ? b : a));
  console.log(`   vs bottom pair, station calls: best bluff ${bb(bestBet.evVsRange)}   check ${bb(chk.evVsRange)}`);
  check('you cannot bluff someone holding a pair who never folds', bestBet.evVsRange < chk.evVsRange,
    `${bb(bestBet.evVsRange)} vs ${bb(chk.evVsRange)}`);
}

console.log('\n4. Speed - grading has to keep up with clicking.\n');
{
  const s = makeSpot({
    hero: 'AhKh', villain: 'Qs9d', board: 'Kh8s4d'.replace('Kh', 'Kd'),
    invested: [20, 40], committed: [0, 20], betToMatch: 20, street: 1,
  });
  const t0 = performance.now();
  const g = gradeDecision(s, 0, getPersona('tag'), removeBlocked(fullRange(), [...s.hole[0], ...s.board]), null, { trials: 900 })!;
  const ms = performance.now() - t0;
  console.log(`   graded ${g.options.length} options at ${g.trials} replays each in ${ms.toFixed(0)}ms`);
  console.log(`   best: ${g.bestVsRange.label} at ${bb(g.bestVsRange.evVsRange)} +/- ${(g.bestVsRange.marginVsRange / 2).toFixed(2)}bb`);
  check('fast enough to feel instant (under 400ms)', ms < 400, `${ms.toFixed(0)}ms`);
}

console.log(failed === 0 ? '\nALL TESTS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
