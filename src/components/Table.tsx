'use client';

import React from 'react';
import { CardRow } from './CardView';
import type { HandState } from '@/lib/poker/engine';
import {
  positionLabel, currentPots, livePlayers, STREET_NAMES,
} from '@/lib/poker/engine';
import { evaluate, describeHand } from '@/lib/poker/evaluator';

export interface SeatView {
  seat: number;
  /** Full name, used for the tooltip. */
  name: string;
  /** Short label shown on the plaque - the player TYPE, which is what you
   *  actually want to read at a glance across a nine-handed table. */
  label: string;
  isHero: boolean;
  showCards: boolean;
}

/**
 * Where each seat sits around the table.
 *
 * The hero is always pinned to the bottom centre - you should never have to
 * hunt for your own cards - and everyone else is spread evenly around an
 * ellipse from there. Expressing it as an angle means the same code lays out a
 * heads-up match and a nine-handed table without any special cases.
 */
function seatAngle(seat: number, heroSeat: number, count: number): { cos: number; sin: number } {
  const offset = (seat - heroSeat + count) % count;
  const angle = (90 + (offset * 360) / count) * (Math.PI / 180);
  return { cos: Math.cos(angle), sin: Math.sin(angle) };
}

/**
 * Seat positions come out of one ellipse, sized by CSS variables rather than
 * baked into the numbers here. That lets the ring pull in on a phone - where
 * the table is barely 340px wide and seats would otherwise crowd the board -
 * without needing a resize listener or a second layout.
 */
function seatStyle(cos: number, sin: number): React.CSSProperties {
  return {
    left: `calc(50% + ${cos.toFixed(4)} * var(--seat-rx))`,
    top: `calc(50% + ${sin.toFixed(4)} * var(--seat-ry))`,
  };
}

function chipsInBB(chips: number, bb: number): string {
  return `${(chips / bb).toFixed(chips % bb === 0 ? 0 : 1)} bb`;
}

export function PokerTable({
  state, heroSeat, seats, showdown, bigBlind,
}: {
  state: HandState;
  heroSeat: number;
  seats: SeatView[];
  showdown: boolean;
  bigBlind: number;
}) {
  const pots = currentPots(state);
  const live = livePlayers(state);
  const mainPot = pots.reduce((a, p) => a + p.amount, 0);

  // A nine-handed table needs more vertical room than a heads-up one.
  const heightClass =
    state.playerCount <= 3
      ? 'min-h-[320px] sm:min-h-[420px]'
      : state.playerCount <= 6
        ? 'min-h-[400px] sm:min-h-[520px]'
        : 'min-h-[460px] sm:min-h-[580px]';

  return (
    <div
      className={`felt seat-ring lift-lg relative ${heightClass} overflow-hidden rounded-[2rem] border border-[var(--color-felt-rail)] sm:rounded-[2.5rem]`}
    >
      {/* Inner rail, so the felt reads as a table rather than a green rectangle. */}
      <div className="pointer-events-none absolute inset-3 rounded-[2rem] border border-white/[0.07]" />

      {/* ---- Centre: board and pot ---- */}
      <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-black/25 px-3 py-1 text-[13px] text-white/90">
            <span className="text-white/50">Pot </span>
            <span className="tnum font-medium">{mainPot}</span>
            <span className="tnum text-white/45"> · {chipsInBB(mainPot, bigBlind)}</span>
          </span>
        </div>

        <CardRow cards={state.board} size="lg" placeholders={5} />

        {pots.length > 1 && state.allIn.some(Boolean) && (
          <div className="flex flex-wrap justify-center gap-1.5">
            {pots.map((p, i) => (
              <span
                key={i}
                className="rounded-full bg-black/25 px-2 py-0.5 text-[10px] text-white/70"
                title={`Contested by ${p.eligible.map((e) => positionLabel(state, e)).join(', ')}`}
              >
                {p.isSide ? 'Side' : 'Main'} {p.amount}
              </span>
            ))}
          </div>
        )}

        <span className="text-[11px] uppercase tracking-[0.14em] text-white/35">
          {state.complete ? 'Hand complete' : STREET_NAMES[state.street]}
        </span>
      </div>

      {/* ---- Seats ---- */}
      {seats.map((view) => {
        const { seat, isHero } = view;
        const { cos, sin } = seatAngle(seat, heroSeat, state.playerCount);
        const folded = state.folded[seat];
        const acting = state.toAct === seat && !state.complete;
        const isButton = seat === state.button;
        const committed = state.committed[seat];
        const reveal = view.showCards || (showdown && !folded);
        const inTopHalf = sin < 0;

        const made =
          reveal && state.board.length >= 3 && !folded
            ? describeHand(evaluate([...state.hole[seat], ...state.board]))
            : null;

        const cards = (
          <CardRow
            key="cards"
            cards={state.hole[seat]}
            size={isHero ? 'lg' : 'sm'}
            hidden={!reveal}
            gap="gap-1"
          />
        );

        const plaque = (
          <div
            key="plaque"
            title={view.name}
            className={`rounded-lg border px-1.5 py-1 text-center backdrop-blur-sm transition sm:rounded-xl sm:px-2.5 sm:py-1.5 ${
              acting
                ? 'acting border-transparent bg-[var(--color-lav)] text-[var(--color-lav-ink)]'
                : 'border-white/10 bg-black/35 text-white'
            }`}
          >
            <div className="flex items-center justify-center gap-1.5">
              <span className="max-w-[64px] truncate text-[10px] font-medium leading-tight sm:max-w-[104px] sm:text-[12px]">
                {view.label}
              </span>
              {isButton && (
                <span
                  title="Dealer button"
                  className="grid h-[13px] w-[13px] shrink-0 place-items-center rounded-full bg-white text-[8px] font-bold text-[var(--color-ink)] sm:h-[15px] sm:w-[15px] sm:text-[9px]"
                >
                  D
                </span>
              )}
            </div>
            <div
              className={`tnum text-[9px] leading-tight sm:text-[11px] ${
                acting ? 'text-[var(--color-lav-ink)]/65' : 'text-white/50'
              }`}
            >
              {positionLabel(state, seat)} · {state.stack[seat]}
              {state.allIn[seat] && ' · all in'}
            </div>
          </div>
        );

        return (
          <div
            key={seat}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={seatStyle(cos, sin)}
          >
            {/* Cards always sit on the side facing the middle of the table, the
                way they would in front of a real player. */}
            <div className={`flex flex-col items-center gap-1.5 transition ${folded ? 'opacity-40 grayscale' : ''}`}>
              {inTopHalf ? [plaque, cards] : [cards, plaque]}
              {made && (
                <div className="hidden max-w-[132px] truncate rounded-full bg-black/35 px-2 py-0.5 text-[10px] text-white/65 sm:block">
                  {made}
                </div>
              )}
            </div>

            {/* Chips pushed in on this street, placed between the seat and the
                middle so the money reads as moving toward the pot. */}
            {committed > 0 && (
              <div
                className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full bg-black/50 px-2 py-0.5 text-[11px] text-white/90"
                style={
                  inTopHalf
                    ? { top: 'calc(100% + 6px)' }
                    : { bottom: 'calc(100% + 6px)' }
                }
              >
                <span className="h-[7px] w-[7px] rounded-full bg-[var(--color-lav)]" />
                <span className="tnum">{committed}</span>
              </div>
            )}
          </div>
        );
      })}

      {live.length === 1 && state.complete && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/35 px-3 py-1 text-[11px] text-white/70">
          Everyone folded
        </div>
      )}
    </div>
  );
}
