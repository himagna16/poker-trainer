/**
 * Tests for the app's memory.
 *
 * The one that matters most is the snapshot round-trip. A saved mistake is only
 * worth replaying if it comes back as the SAME situation - same cards, same
 * money, and above all the same beliefs about what each opponent held. If the
 * ranges don't survive storage, the replay quietly grades you against different
 * opponents to the ones you actually faced, which teaches the wrong lesson
 * while looking completely normal.
 */
import { buildSpot, uniformLineup, uniformBook } from '../src/lib/poker/testing';
import { captureSpot, restoreSpot, describeSnapshot } from '../src/lib/poker/spots';
import { gradeDecision } from '../src/lib/poker/grade';
import { legalActions, toCall, currentPots } from '../src/lib/poker/engine';
import { cardsToString } from '../src/lib/poker/cards';
import { rangePercent } from '../src/lib/poker/ranges';
import {
  schedule, dueSpots, pendingSpots, summarize, readStore,
  saveSpot, reviewSpot, recordDecision, recordHand, resetEverything, REVIEW_INTERVALS,
} from '../src/lib/poker/storage';
import type { SavedSpot } from '../src/lib/poker/storage';

let failed = 0;
const check = (name: string, cond: boolean, detail = '') => {
  if (!cond) failed++;
  console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${name}${detail ? '   ' + detail : ''}`);
};

/* ---------------------------------------------------------------- */
console.log('Snapshot round-trip - a saved spot must come back identical.\n');
{
  const state = buildSpot({
    playerCount: 6, heroSeat: 0, button: 0, street: 1,
    holes: { 0: 'AhKh', 3: 'QsQd', 4: '7c7d' }, board: 'Kd8s4c',
    invested: [20, 0, 0, 60, 60, 0], committed: [20, 0, 0, 60, 60, 0],
    folded: [false, true, true, false, false, true], toAct: 0,
  });
  const lineup = uniformLineup(6, 0, 'tag');
  const book = uniformBook(state, 0, 0.28);
  const chosen = { type: 'call' as const, amount: 40 };

  const snapshot = captureSpot(state, 0, lineup, book, chosen);
  const restored = restoreSpot(snapshot);

  const size = JSON.stringify(snapshot).length;
  console.log(`  snapshot size: ${size} bytes (about ${Math.floor(4_500_000 / size).toLocaleString()} would fit in browser storage)\n`);

  check('hero cards survive', cardsToString(restored.state.hole[0]) === cardsToString(state.hole[0]),
    cardsToString(restored.state.hole[0]));
  check('opponent cards survive',
    cardsToString(restored.state.hole[3]) === cardsToString(state.hole[3]));
  check('board survives', cardsToString(restored.state.board) === cardsToString(state.board),
    cardsToString(restored.state.board));
  check('pot survives', restored.state.pot === state.pot, `${restored.state.pot} vs ${state.pot}`);
  check('who folded survives', restored.state.folded.join() === state.folded.join());
  check('stacks survive', restored.state.stack.join() === state.stack.join());
  check('to-call survives', toCall(restored.state, 0) === toCall(state, 0),
    `${toCall(restored.state, 0)} vs ${toCall(state, 0)}`);
  // Compare the actions in FULL, including the legal bet range. Comparing only
  // the action types hid a bug for a while: the snapshot stored one starting
  // stack and handed it to every seat, so opponents came back with the wrong
  // chip counts and the maximum legal bet silently changed.
  const describeActions = (st: typeof state) =>
    legalActions(st).map((a) => `${a.type}:${a.amount}:${a.min ?? '-'}:${a.max ?? '-'}`).join(' | ');
  check('the same actions are legal, with the same bet range',
    describeActions(restored.state) === describeActions(state),
    describeActions(restored.state));
  check('every seat gets its own starting stack back',
    restored.state.startStack.join() === state.startStack.join(),
    `${restored.state.startStack.join()} vs ${state.startStack.join()}`);
  check('side pot structure survives',
    JSON.stringify(currentPots(restored.state)) === JSON.stringify(currentPots(state)));
  check('the chosen action survives',
    restored.chosen.type === chosen.type && restored.chosen.amount === chosen.amount);
  check('opponent personas survive',
    restored.lineup.map((p) => p?.id ?? '-').join() === lineup.map((p) => p?.id ?? '-').join());

  // Ranges are stored collapsed to the 169 hand types rather than all 1,326
  // combinations, so the width should come back close but not bit-identical.
  const before = rangePercent(book[3]);
  const after = rangePercent(restored.book[3]);
  console.log(`\n  range width: ${(before * 100).toFixed(1)}% saved -> ${(after * 100).toFixed(1)}% restored`);
  check('opponent range width survives packing', Math.abs(before - after) < 0.02,
    `${(before * 100).toFixed(1)}% vs ${(after * 100).toFixed(1)}%`);

  // The real test: does grading the restored spot give the same verdict?
  const original = gradeDecision(state, 0, lineup, book, chosen, { trials: 500, seed: 7 })!;
  const replay = gradeDecision(restored.state, 0, restored.lineup, restored.book, restored.chosen, { trials: 500, seed: 7 })!;
  console.log(`\n  original: ${original.headline}`);
  console.log(`  replayed: ${replay.headline}`);
  check('the replay reaches the same verdict', original.verdict === replay.verdict,
    `${original.verdict} vs ${replay.verdict}`);
  check('the replay recommends the same action',
    original.bestVsRange.action.type === replay.bestVsRange.action.type,
    `${original.bestVsRange.label} vs ${replay.bestVsRange.label}`);
  check('EV agrees to within a fraction of a big blind',
    Math.abs(original.evLostVsRange - replay.evLostVsRange) < 0.35,
    `${original.evLostVsRange.toFixed(2)} vs ${replay.evLostVsRange.toFixed(2)} bb`);

  // The same round-trip with UNEQUAL stacks, which is what exposed the bug.
  {
    const uneven = buildSpot({
      playerCount: 4, heroSeat: 0, button: 0, street: 1,
      holes: { 0: 'AhKh', 2: 'QsQd' }, board: 'Kd8s4c',
      startStacks: [400, 120, 260, 90],
      invested: [40, 0, 40, 20], committed: [40, 0, 40, 20],
      folded: [false, true, false, false], toAct: 0,
    });
    const lu = uniformLineup(4, 0, 'tag');
    const bk = uniformBook(uneven, 0, 0.3);
    const rt = restoreSpot(captureSpot(uneven, 0, lu, bk, { type: 'call', amount: 0 }));
    check('uneven stacks survive the round-trip',
      rt.state.startStack.join() === uneven.startStack.join(),
      `${rt.state.startStack.join()} vs ${uneven.startStack.join()}`);
    check('and the legal bet range matches',
      legalActions(rt.state).map((a) => `${a.type}:${a.min ?? '-'}:${a.max ?? '-'}`).join() ===
      legalActions(uneven).map((a) => `${a.type}:${a.min ?? '-'}:${a.max ?? '-'}`).join(),
      legalActions(rt.state).map((a) => a.label).join(' | '));
  }

  const described = describeSnapshot(snapshot);
  check('describes itself for the review list',
    described.hand === 'AKs' && described.street === 'Flop' && described.seats === 6,
    `${described.hand} · ${described.street} · ${described.seats}-handed`);
}

/* ---------------------------------------------------------------- */
console.log('\nSpaced repetition scheduling.\n');
{
  const base: SavedSpot = {
    id: 'x', createdAt: 0, box: 0, dueAt: 0, seen: 0, right: 0, retired: false,
    verdict: 'mistake', lostBB: 1.2, headline: 'test',
    snapshot: {} as never,
  };
  const now = 1_000_000;

  let spot = base;
  const gaps: string[] = [];
  for (let i = 0; i < REVIEW_INTERVALS.length + 1; i++) {
    spot = schedule(spot, true, now);
    gaps.push(spot.retired ? 'retired' : `${Math.round((spot.dueAt - now) / 60000)}m`);
  }
  console.log(`  answering correctly each time: ${gaps.join(' -> ')}`);
  check('each correct answer pushes the next showing further out',
    gaps.slice(0, REVIEW_INTERVALS.length - 1).every((g, i, a) =>
      i === 0 || parseInt(g) > parseInt(a[i - 1])));
  check('it retires once it has been answered enough times', spot.retired);

  let wrong = schedule(schedule(schedule(base, true, now), true, now), false, now);
  check('a wrong answer drops it back a level', wrong.box === 1, `box ${wrong.box}`);
  check('and brings it back soon', wrong.dueAt - now === REVIEW_INTERVALS[1],
    `${Math.round((wrong.dueAt - now) / 60000)}m`);
  wrong = schedule(wrong, false, now);
  wrong = schedule(wrong, false, now);
  check('box never goes below zero', wrong.box === 0, `box ${wrong.box}`);
}

/* ---------------------------------------------------------------- */
console.log('\nThe store (running without a browser, so it stays in memory).\n');
{
  resetEverything();
  check('starts empty', readStore().lifetime.hands === 0 && readStore().spots.length === 0);

  recordHand({ netChips: 12, bigBlind: 2, voluntary: true, raised: true });
  recordHand({ netChips: -6, bigBlind: 2, voluntary: true, raised: false });
  recordHand({ netChips: 0, bigBlind: 2, voluntary: false, raised: false });
  recordDecision({ verdict: 'best', evLostBB: 0, preflopVoluntary: true, preflopRaise: true });
  recordDecision({ verdict: 'mistake', evLostBB: 1.4, preflopVoluntary: false, preflopRaise: false });

  const s = summarize(readStore());
  console.log(`  ${s.hands} hands, net ${s.netBB.toFixed(1)} bb, ${s.bb100?.toFixed(0)} bb/100, ` +
    `accuracy ${s.accuracy?.toFixed(0)}%, VPIP ${s.vpip?.toFixed(0)}%, PFR ${s.pfr?.toFixed(0)}%`);
  check('counts hands', s.hands === 3);
  check('sums net correctly', Math.abs(s.netBB - 3) < 1e-9, `${s.netBB}`);
  check('computes bb/100', Math.abs(s.bb100! - 100) < 1e-9, `${s.bb100}`);
  check('accuracy counts best and close as right', Math.abs(s.accuracy! - 50) < 1e-9, `${s.accuracy}`);
  check('tracks VPIP and PFR', Math.abs(s.vpip! - 66.67) < 0.1 && Math.abs(s.pfr! - 33.33) < 0.1);
  check('tracks EV given up', Math.abs(s.evLostBB - 1.4) < 1e-9);

  saveSpot({ verdict: 'blunder', lostBB: 3.1, headline: 'oops', snapshot: {} as never });
  check('a saved spot is not due immediately', dueSpots(readStore()).length === 0);
  check('but it is waiting', pendingSpots(readStore()).length === 1);
  check('and it shows up as pending in the summary', summarize(readStore()).pending === 1);

  const id = readStore().spots[0].id;
  const future = Date.now() + REVIEW_INTERVALS[0] + 1000;
  check('it becomes due after the first interval', dueSpots(readStore(), future).length === 1);

  reviewSpot(id, true);
  check('answering it pushes it out again', dueSpots(readStore(), future).length === 0);
  check('and records that it was seen', readStore().spots[0].seen === 1 && readStore().spots[0].right === 1);

  resetEverything();
  check('reset clears everything', readStore().lifetime.hands === 0 && readStore().spots.length === 0);
}

console.log(failed === 0 ? '\nALL MEMORY TESTS PASSED' : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
