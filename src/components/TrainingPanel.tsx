'use client';

import { useState } from 'react';
import type { EquityResult } from '@/lib/poker/equity';
import type { DecisionGrade } from '@/lib/poker/grade';
import type { RangeBook } from '@/lib/poker/ranges';
import type { BotPersona } from '@/lib/poker/bots';
import type { HandState } from '@/lib/poker/engine';
import type { XraySettings } from '@/lib/poker/settings';
import { PRESETS, presetIdFor } from '@/lib/poker/settings';
import { positionLabel, livePlayers } from '@/lib/poker/engine';
import { RangeGrid } from './RangeGrid';
import { Annotated } from './Term';
import { Panel, PanelTitle, Stat, Toggle, Badge, Segmented } from './ui';

export function TrainingPanel({
  state, heroSeat, settings, onSettings, equity, grade, potOdds, book, lineup, bigBlind, outs, cardsToCome,
}: {
  state: HandState;
  heroSeat: number;
  settings: XraySettings;
  onSettings: (s: XraySettings) => void;
  equity: EquityResult | null;
  grade: DecisionGrade | null;
  potOdds: number | null;
  book: RangeBook;
  lineup: (BotPersona | null)[];
  bigBlind: number;
  outs: number | null;
  cardsToCome: number;
}) {
  const set = (patch: Partial<XraySettings>) => onSettings({ ...settings, ...patch });
  const activePreset = presetIdFor(settings);

  const opponents = livePlayers(state).filter((s) => s !== heroSeat);
  const [inspect, setInspect] = useState<number | null>(null);
  const inspectSeat = inspect !== null && opponents.includes(inspect) ? inspect : opponents[0];

  const need = potOdds;
  const have = equity?.equity ?? null;

  return (
    <div className="flex w-full flex-col gap-4 lg:w-[350px] lg:shrink-0">
      <Panel>
        <PanelTitle
          right={
            <span className="text-[11px] text-[var(--color-ink-faint)]">
              {PRESETS.find((p) => p.id === activePreset)?.blurb ?? 'Your own mix'}
            </span>
          }
        >
          Training wheels
        </PanelTitle>
        <div className="mb-3">
          <Segmented
            options={PRESETS.map((p) => ({ value: p.id, label: p.label, title: p.blurb }))}
            value={activePreset ?? 'custom'}
            onChange={(id) => {
              const preset = PRESETS.find((p) => p.id === id);
              if (preset) onSettings(preset.settings);
            }}
          />
        </div>
        <div className="-mx-2 space-y-0.5 border-t border-[var(--color-line)] pt-2">
          <Toggle label="See their cards" hint="Watch how a hand really plays out"
            checked={settings.showOpponentCards} onChange={(v) => set({ showOpponentCards: v })} />
          <Toggle label="Live equity" hint="How often you end up with the best hand"
            checked={settings.showEquity} onChange={(v) => set({ showEquity: v })} />
          <Toggle label="Pot odds" hint="The price you're getting, and what you need"
            checked={settings.showPotOdds} onChange={(v) => set({ showPotOdds: v })} />
          <Toggle label="Outs" hint="Which cards rescue you, and how likely"
            checked={settings.showOuts} onChange={(v) => set({ showOuts: v })} />
          <Toggle label="What each action is worth" hint="The EV of every option before you commit"
            checked={settings.showEV} onChange={(v) => set({ showEV: v })} />
          <Toggle label="Their ranges" hint="Every hand each opponent could hold"
            checked={settings.showRange} onChange={(v) => set({ showRange: v })} />
        </div>
      </Panel>

      {(settings.showEquity || settings.showPotOdds || settings.showOuts) && (equity || need !== null) && (
        <Panel>
          <div className="flex flex-wrap gap-x-8 gap-y-4">
            {settings.showEquity && equity && (
              <Stat
                label="Your equity"
                value={`${(equity.equity * 100).toFixed(1)}%`}
                sub={equity.exact ? `exact, all ${equity.trials.toLocaleString()} runouts` : `± ${(equity.margin * 100).toFixed(1)} pts`}
                tone={need !== null && have !== null ? (have >= need ? 'good' : 'bad') : 'default'}
              />
            )}
            {settings.showPotOdds && need !== null && (
              <Stat label="You need" value={`${(need * 100).toFixed(0)}%`} sub="to break even on a call" />
            )}
            {settings.showOuts && outs !== null && outs > 0 && (
              <Stat
                label="Outs"
                value={`${outs}`}
                sub={`about ${Math.min(99, outs * (cardsToCome === 2 ? 4 : 2))}% to hit`}
              />
            )}
          </div>

          {settings.showEquity && settings.showPotOdds && need !== null && have !== null && (
            <div className="mt-4 border-t border-[var(--color-line)] pt-3">
              <div className="relative h-8 overflow-hidden rounded-lg bg-[var(--color-paper-deep)]">
                <div
                  className="h-full transition-all"
                  style={{
                    width: `${Math.min(100, have * 100)}%`,
                    background: have >= need ? 'var(--color-good)' : 'var(--color-bad)',
                    opacity: 0.85,
                  }}
                />
                <div
                  className="absolute inset-y-0 w-[2px] bg-[var(--color-ink)]"
                  style={{ left: `${Math.min(100, need * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-[var(--color-ink-muted)]">
                The bar is how often you win; the line is how often you need to.{' '}
                {have >= need
                  ? 'Past the line means calling makes money in the long run.'
                  : 'Short of the line means calling loses money, however this particular hand ends.'}
              </p>
            </div>
          )}
        </Panel>
      )}

      {settings.showEV && grade && (
        <Panel>
          <PanelTitle
            right={
              grade.foldsOut !== null ? (
                <span className="tnum text-[11px] text-[var(--color-ink-faint)]">
                  everyone folds {(grade.foldsOut * 100).toFixed(0)}%
                </span>
              ) : undefined
            }
          >
            What each action is worth
          </PanelTitle>
          <div className="space-y-1">
            {[...grade.options]
              .sort((a, b) => b.evVsRange - a.evVsRange)
              .map((o, i) => {
                const bb = o.evVsRange / bigBlind;
                const best = i === 0;
                return (
                  <div
                    key={o.label}
                    className={`flex items-center justify-between gap-3 rounded-lg px-2.5 py-1.5 text-[13px] ${
                      best ? 'bg-[var(--color-good-soft)]' : ''
                    }`}
                  >
                    <span className={best ? 'font-medium text-[var(--color-good)]' : 'text-[var(--color-ink-muted)]'}>
                      {o.label}
                    </span>
                    <span className={`tnum ${bb >= 0 ? 'text-[var(--color-good)]' : 'text-[var(--color-bad)]'}`}>
                      {bb >= 0 ? '+' : ''}{bb.toFixed(2)} bb
                    </span>
                  </div>
                );
              })}
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
            Found by replaying this spot {grade.trials.toLocaleString()} times against their real
            strategies. Folding is always 0, so every number reads as better or worse than folding.
          </p>
          {grade.bestVsRange.action.type !== 'fold' &&
            grade.bestVsRange.action.type !== 'check' &&
            grade.heroEquityVsRange < 0.35 && (
              <p className="mt-2 rounded-lg bg-[var(--color-warn-soft)] px-3 py-2 text-[11px] leading-relaxed text-[var(--color-warn)]">
                Careful with this one. Betting big with a weak hand is only correct here because these
                particular opponents fold more than real players do. It is the right exploit against{' '}
                <em>them</em>, not a habit to take to a real table.
              </p>
            )}
        </Panel>
      )}

      {settings.showRange && opponents.length > 0 && (
        <Panel>
          <PanelTitle>Reading the table</PanelTitle>
          <div className="mb-3 space-y-1.5">
            {opponents.map((seat) => {
              const pct = book[seat] ? (book[seat].length ? undefined : 0) : 0;
              const width = grade?.opponentRanges.find((r) => r.seat === seat)?.percent;
              const shown = width ?? pct ?? 0;
              return (
                <button
                  key={seat}
                  onClick={() => setInspect(seat)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition ${
                    seat === inspectSeat ? 'bg-[var(--color-paper-deep)]' : 'hover:bg-[var(--color-paper-deep)]'
                  }`}
                >
                  <span className="w-9 shrink-0 text-[11px] text-[var(--color-ink-faint)]">
                    {positionLabel(state, seat)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px]">{lineup[seat]?.name ?? 'Player'}</span>
                  <span className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-[var(--color-line)]">
                    <span
                      className="block h-full rounded-full bg-[var(--color-felt)]"
                      style={{ width: `${Math.min(100, shown * 100)}%` }}
                    />
                  </span>
                  <span className="tnum w-9 shrink-0 text-right text-[11px] text-[var(--color-ink-muted)]">
                    {(shown * 100).toFixed(0)}%
                  </span>
                </button>
              );
            })}
          </div>
          {inspectSeat !== undefined && book[inspectSeat] && (
            <RangeGrid
              range={book[inspectSeat]}
              label={`${lineup[inspectSeat]?.name ?? 'Player'} in ${positionLabel(state, inspectSeat)}`}
            />
          )}
        </Panel>
      )}

      {opponents.length > 0 && lineup[inspectSeat ?? -1] && (
        <Panel>
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-medium">{lineup[inspectSeat!]!.name}</span>
            <Badge>{lineup[inspectSeat!]!.tag}</Badge>
          </div>
          <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
            <Annotated text={lineup[inspectSeat!]!.blurb} />
          </p>
          <div className="mt-2.5 rounded-lg bg-[var(--color-good-soft)] px-3 py-2 text-[12px] leading-relaxed text-[var(--color-good)]">
            <span className="font-medium">How to beat them: </span>
            <Annotated text={lineup[inspectSeat!]!.counter} />
          </div>
        </Panel>
      )}
    </div>
  );
}
