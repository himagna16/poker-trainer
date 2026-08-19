import { makeSpot, DRILLS } from '../src/lib/poker/drills';
import type { DrillId } from '../src/lib/poker/drills';
import { cardsToString } from '../src/lib/poker/cards';

let failed = 0;
for (const drill of DRILLS) {
  const t0 = performance.now();
  let nulls = 0;
  const samples: string[] = [];
  const N = 200;
  for (let i = 0; i < N; i++) {
    const spot = makeSpot(drill.id as DrillId, 5000 + i * 17);
    if (!spot) { nulls++; continue; }
    if (samples.length < 2) {
      if (spot.kind === 'outs') samples.push(`${cardsToString(spot.hero)} vs ${cardsToString(spot.villain)} on ${cardsToString(spot.board)} -> ${spot.outs.length} outs, ${(spot.equity*100).toFixed(0)}%`);
      else if (spot.kind === 'equity') samples.push(`${cardsToString(spot.hero)} vs ${cardsToString(spot.villain)} on ${spot.board.length ? cardsToString(spot.board) : '(preflop)'} -> ${(spot.equity*100).toFixed(1)}%`);
      else samples.push(`${cardsToString(spot.state.hole[0])} on ${spot.state.board.length ? cardsToString(spot.state.board) : '(preflop)'}, pot ${spot.state.pot}, to call ${spot.state.betToMatch - spot.state.committed[0]} vs ${spot.persona.name}`);
    }
  }
  const ms = (performance.now() - t0) / N;
  const ok = nulls === 0 && ms < 60;
  if (!ok) failed++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${drill.name.padEnd(14)} ${nulls} failures / ${N},  ${ms.toFixed(1)}ms per spot`);
  for (const s of samples) console.log(`       ${s}`);
}
console.log(failed === 0 ? '\nALL DRILL GENERATORS OK' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
