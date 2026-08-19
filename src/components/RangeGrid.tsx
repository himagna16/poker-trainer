'use client';

import { rangeGrid, rangePercent } from '@/lib/poker/ranges';
import type { WeightedRange } from '@/lib/poker/ranges';
import { RANK_CHARS } from '@/lib/poker/cards';

const RANKS = [...RANK_CHARS].reverse(); // A K Q ... 2

/**
 * The 13x13 grid every poker tool uses to show a range.
 *
 * Pairs run down the diagonal, suited hands sit above it, offsuit below. Once
 * you can read this at a glance you absorb "what does this player have" in
 * about a second, which is why the layout is worth keeping standard even though
 * it looks cryptic at first.
 */
export function RangeGrid({ range, label }: { range: WeightedRange; label?: string }) {
  const grid = rangeGrid(range);
  const pct = rangePercent(range);

  return (
    <div>
      {label && (
        <div className="mb-2 flex items-baseline justify-between">
          <span className="text-[13px] font-medium">{label}</span>
          <span className="tnum text-[13px] text-[var(--color-good)]">
            {(pct * 100).toFixed(0)}% of hands
          </span>
        </div>
      )}
      <div className="grid grid-cols-13 gap-px overflow-hidden rounded-lg bg-[var(--color-line)] p-px">
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
                title={`${hand} — ${present ? `${(w * 100).toFixed(0)}% likely` : 'not in range'}`}
                className="relative aspect-square"
                style={{
                  backgroundColor: present
                    ? `color-mix(in srgb, var(--color-felt) ${8 + w * 92}%, white)`
                    : 'var(--color-surface)',
                }}
              >
                <span
                  className="absolute inset-0 grid place-items-center text-[7px] font-medium leading-none"
                  style={{ color: w > 0.45 ? 'rgba(255,255,255,0.85)' : 'var(--color-ink-faint)' }}
                >
                  {hand.slice(0, 2)}
                </span>
              </div>
            );
          })
        )}
      </div>
      <p className="mt-1.5 text-[11px] leading-snug text-[var(--color-ink-faint)]">
        Darker means more likely. Pairs on the diagonal, suited above, offsuit below.
      </p>
    </div>
  );
}
