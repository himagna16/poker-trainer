'use client';

import type { Card } from '@/lib/poker/cards';
import { rankOf, suitOf, RANK_CHARS, SUIT_SYMBOLS, SUIT_IS_RED } from '@/lib/poker/cards';

const SIZES = {
  xs: 'h-9 w-6.5 text-[11px] rounded',
  sm: 'h-12 w-9 text-sm rounded-md',
  md: 'h-20 w-14 text-xl rounded-lg',
  lg: 'h-24 w-17 text-2xl rounded-lg',
} as const;

export type CardSize = keyof typeof SIZES;

export function CardView({
  card,
  size = 'md',
  hidden = false,
  dimmed = false,
  highlight = false,
  delay = 0,
}: {
  card?: Card;
  size?: CardSize;
  hidden?: boolean;
  dimmed?: boolean;
  highlight?: boolean;
  delay?: number;
}) {
  const cls = SIZES[size];

  if (hidden || card === undefined) {
    return (
      <div
        className={`${cls} card-in grid place-items-center border border-white/20 bg-gradient-to-br from-slate-700 to-slate-900 shadow-lg`}
        style={{ animationDelay: `${delay}ms` }}
      >
        <div className="h-[70%] w-[70%] rounded-sm border border-white/10 bg-[repeating-linear-gradient(45deg,rgba(255,255,255,0.07)_0_3px,transparent_3px_6px)]" />
      </div>
    );
  }

  const rank = RANK_CHARS[rankOf(card)];
  const suit = SUIT_SYMBOLS[suitOf(card)];
  const red = SUIT_IS_RED[suitOf(card)];

  return (
    <div
      className={`${cls} card-in relative flex flex-col items-center justify-center bg-white font-semibold leading-none shadow-lg transition
        ${red ? 'text-rose-600' : 'text-slate-900'}
        ${dimmed ? 'opacity-40' : ''}
        ${highlight ? 'ring-2 ring-amber-300 ring-offset-1 ring-offset-emerald-900' : ''}`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <span>{rank}</span>
      <span className={size === 'xs' ? 'text-[10px]' : 'text-[0.9em]'}>{suit}</span>
    </div>
  );
}

export function CardRow({
  cards,
  size = 'md',
  hidden = false,
  placeholders = 0,
}: {
  cards: Card[];
  size?: CardSize;
  hidden?: boolean;
  placeholders?: number;
}) {
  const empties = Math.max(0, placeholders - cards.length);
  return (
    <div className="flex gap-1.5">
      {cards.map((c, i) => (
        <CardView key={`${c}-${i}`} card={c} size={size} hidden={hidden} delay={i * 55} />
      ))}
      {Array.from({ length: empties }).map((_, i) => (
        <div
          key={`empty-${i}`}
          className={`${SIZES[size]} border border-dashed border-white/15 bg-white/[0.03]`}
        />
      ))}
    </div>
  );
}
