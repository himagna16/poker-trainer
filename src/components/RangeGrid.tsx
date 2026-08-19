'use client';

import { rangeGrid, rangePercent } from '@/lib/poker/ranges';
import type { WeightedRange } from '@/lib/poker/ranges';
import { RANK_CHARS } from '@/lib/poker/cards';

const RANKS = [...RANK_CHARS].reverse(); // A K Q ... 2

/**
 * The 13x13 grid every poker tool uses to show a range.
 *
 * Pairs run down the diagonal, suited hands sit above it, offsuit below. Once
 * you can read this at a glance you can absorb "what does this player have"
 * in about a second, which is the entire reason the layout is standard.
 */
export function RangeGrid({ range, title }: { range: WeightedRange; title?: string }) {
  const grid = rangeGrid(range);
  const pct = rangePercent(range);

  return (
    <div>
      {title && (
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-xs font-medium text-slate-300">{title}</span>
          <span className="text-xs tabular-nums text-emerald-300">{(pct * 100).toFixed(0)}% of hands</span>
        </div>
      )}
      <div className="grid grid-cols-13 gap-px overflow-hidden rounded bg-white/5 p-px">
        {RANKS.map((r1) =>
          RANKS.map((r2) => {
            const i = RANK_CHARS.indexOf(r1);
            const j = RANK_CHARS.indexOf(r2);
            const hand = i === j ? r1 + r2 : i > j ? r1 + r2 + 's' : r2 + r1 + 'o';
            const cell = grid.get(hand);
            const w = cell?.weight ?? 0;
            const present = (cell?.combos ?? 0) > 0;
            return (
              <div
                key={`${r1}${r2}`}
                title={`${hand} - ${present ? `${(w * 100).toFixed(0)}% likely` : 'not in range'}`}
                className="relative aspect-square"
                style={{
                  backgroundColor: present
                    ? `rgba(16, 185, 129, ${0.12 + w * 0.75})`
                    : 'rgba(255,255,255,0.02)',
                }}
              >
                <span className="absolute inset-0 grid place-items-center text-[7px] font-medium leading-none text-white/70">
                  {hand.slice(0, 2)}
                </span>
              </div>
            );
          })
        )}
      </div>
      <p className="mt-1.5 text-[10px] leading-snug text-slate-500">
        Brighter means more likely. Pairs on the diagonal, suited above, offsuit below.
      </p>
    </div>
  );
}
