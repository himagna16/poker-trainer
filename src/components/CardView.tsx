'use client';

import type { Card } from '@/lib/poker/cards';
import { rankOf, suitOf, RANK_CHARS, SUIT_SYMBOLS, SUIT_IS_RED } from '@/lib/poker/cards';

/**
 * A playing card.
 *
 * Proportioned 5:7, which is close to a real card, with the rank and suit in
 * the corner the way a real one is indexed - that's what makes a fan of cards
 * readable when they overlap. Larger sizes also carry a centre pip.
 */
const SIZES = {
  xs: { w: 'w-[26px]', h: 'h-[36px]', r: 'rounded-[4px]', rank: 'text-[11px]', suit: 'text-[9px]', pip: '' },
  sm: { w: 'w-[34px]', h: 'h-[48px]', r: 'rounded-[5px]', rank: 'text-[13px]', suit: 'text-[11px]', pip: '' },
  md: { w: 'w-[46px]', h: 'h-[64px]', r: 'rounded-[7px]', rank: 'text-[17px]', suit: 'text-[13px]', pip: 'text-[20px]' },
  lg: { w: 'w-[60px]', h: 'h-[84px]', r: 'rounded-[9px]', rank: 'text-[22px]', suit: 'text-[16px]', pip: 'text-[28px]' },
  xl: { w: 'w-[76px]', h: 'h-[106px]', r: 'rounded-[11px]', rank: 'text-[28px]', suit: 'text-[20px]', pip: 'text-[36px]' },
} as const;

export type CardSize = keyof typeof SIZES;

export function CardView({
  card, size = 'md', hidden = false, dimmed = false, highlight = false, delay = 0,
}: {
  card?: Card;
  size?: CardSize;
  hidden?: boolean;
  dimmed?: boolean;
  highlight?: boolean;
  delay?: number;
}) {
  const s = SIZES[size];
  const base = `${s.w} ${s.h} ${s.r} deal-in shrink-0 select-none`;

  if (hidden || card === undefined) {
    return (
      <div
        className={`${base} relative overflow-hidden border border-black/15 bg-[var(--color-felt-rail)] shadow-sm`}
        style={{ animationDelay: `${delay}ms` }}
        aria-label="face-down card"
      >
        <div
          className="absolute inset-[3px] rounded-[3px] opacity-45"
          style={{
            backgroundImage:
              'repeating-linear-gradient(45deg, rgba(255,255,255,0.14) 0 2px, transparent 2px 5px)',
          }}
        />
      </div>
    );
  }

  const rank = RANK_CHARS[rankOf(card)];
  const suit = SUIT_SYMBOLS[suitOf(card)];
  const red = SUIT_IS_RED[suitOf(card)];
  const colour = red ? 'text-[var(--color-card-red)]' : 'text-[var(--color-card-black)]';

  return (
    <div
      className={`${base} relative border border-black/10 bg-white shadow-[0_1px_3px_rgba(0,0,0,0.18)] transition
        ${dimmed ? 'opacity-35 saturate-50' : ''}
        ${highlight ? 'ring-2 ring-[var(--color-lav-deep)] ring-offset-1 ring-offset-transparent' : ''}`}
      style={{ animationDelay: `${delay}ms` }}
      aria-label={`${rank}${suit}`}
    >
      <div className={`absolute left-[9%] top-[5%] flex flex-col items-center leading-none ${colour}`}>
        <span className={`${s.rank} font-semibold tracking-tight`}>{rank}</span>
        <span className={`${s.suit} -mt-px`}>{suit}</span>
      </div>
      {s.pip && (
        <span className={`${s.pip} absolute bottom-[6%] right-[8%] leading-none opacity-90 ${colour}`}>
          {suit}
        </span>
      )}
    </div>
  );
}

export function CardRow({
  cards, size = 'md', hidden = false, placeholders = 0, gap = 'gap-1.5', delayStep = 60,
}: {
  cards: Card[];
  size?: CardSize;
  hidden?: boolean;
  placeholders?: number;
  gap?: string;
  delayStep?: number;
}) {
  const s = SIZES[size];
  const empties = Math.max(0, placeholders - cards.length);
  return (
    <div className={`flex ${gap}`}>
      {cards.map((c, i) => (
        <CardView key={`${c}-${i}`} card={c} size={size} hidden={hidden} delay={i * delayStep} />
      ))}
      {Array.from({ length: empties }).map((_, i) => (
        <div
          key={`empty-${i}`}
          className={`${s.w} ${s.h} ${s.r} shrink-0 border border-white/[0.13] bg-black/[0.13]`}
        />
      ))}
    </div>
  );
}
