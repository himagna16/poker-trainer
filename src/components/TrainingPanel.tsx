'use client';

import type { EquityResult } from '@/lib/poker/equity';
import type { DecisionGrade } from '@/lib/poker/grade';
import type { WeightedRange } from '@/lib/poker/ranges';
import type { BotPersona } from '@/lib/poker/bots';
import { RangeGrid } from './RangeGrid';
import { Annotated } from './Term';

/**
 * Which training wheels are currently on.
 *
 * The whole idea is that these come off ONE AT A TIME. Start with everything
 * visible - their cards, your odds, what each action is worth - and you can see
 * the machinery of the game directly. Turn things off as they start to feel
 * obvious, and by the time everything is off you're playing blind, but the
 * intuition you built with the wheels on is still there.
 */
export interface XraySettings {
  showOpponentCards: boolean;
  showEquity: boolean;
  showPotOdds: boolean;
  showEV: boolean;
  showRange: boolean;
  showOuts: boolean;
}

export const PRESETS: Record<string, { label: string; blurb: string; settings: XraySettings }> = {
  full: {
    label: 'Full X-ray',
    blurb: 'Everything visible. Best for your first few hundred hands.',
    settings: { showOpponentCards: true, showEquity: true, showPotOdds: true, showEV: true, showRange: true, showOuts: true },
  },
  odds: {
    label: 'Odds only',
    blurb: 'Their cards are hidden, but you still see your odds and the price.',
    settings: { showOpponentCards: false, showEquity: true, showPotOdds: true, showEV: false, showRange: true, showOuts: true },
  },
  price: {
    label: 'Price only',
    blurb: 'Just the pot odds. You have to judge your own equity.',
    settings: { showOpponentCards: false, showEquity: false, showPotOdds: true, showEV: false, showRange: false, showOuts: false },
  },
  blind: {
    label: 'Blind',
    blurb: 'No help at all - real conditions. Decisions are still graded after the fact.',
    settings: { showOpponentCards: false, showEquity: false, showPotOdds: false, showEV: false, showRange: false, showOuts: false },
  },
};

function Toggle({
  label, hint, checked, onChange,
}: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 transition hover:bg-white/5">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 h-4 w-7 shrink-0 rounded-full transition ${checked ? 'bg-emerald-500' : 'bg-slate-600'}`}
      >
        <span
          className={`block h-3 w-3 rounded-full bg-white transition-transform ${checked ? 'translate-x-3.5' : 'translate-x-0.5'}`}
        />
      </button>
      <span className="min-w-0">
        <span className="block text-xs font-medium text-slate-200">{label}</span>
        {hint && <span className="block text-[10px] leading-snug text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

function Stat({ label, value, sub, tone = 'default' }: {
  label: string; value: string; sub?: string; tone?: 'default' | 'good' | 'bad';
}) {
  const colour = tone === 'good' ? 'text-emerald-300' : tone === 'bad' ? 'text-rose-300' : 'text-slate-100';
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`text-lg font-semibold tabular-nums ${colour}`}>{value}</div>
      {sub && <div className="text-[10px] leading-snug text-slate-500">{sub}</div>}
    </div>
  );
}

export function TrainingPanel({
  settings, onSettings, equity, grade, potOdds, villainRange, persona, bigBlind, outs, cardsToCome,
}: {
  settings: XraySettings;
  onSettings: (s: XraySettings) => void;
  equity: EquityResult | null;
  grade: DecisionGrade | null;
  /** What share of the pot you must win for a call to break even, if facing a bet. */
  potOdds: number | null;
  villainRange: WeightedRange;
  persona: BotPersona;
  bigBlind: number;
  outs: number | null;
  cardsToCome: number;
}) {
  const set = (patch: Partial<XraySettings>) => onSettings({ ...settings, ...patch });
  const activePreset = Object.entries(PRESETS).find(
    ([, p]) => JSON.stringify(p.settings) === JSON.stringify(settings)
  )?.[0];

  const needed = potOdds;
  const have = equity?.equity ?? null;

  return (
    <aside className="flex w-full flex-col gap-4 lg:w-88">
      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Training wheels</h2>
        <div className="mb-3 grid grid-cols-2 gap-1.5">
          {Object.entries(PRESETS).map(([key, preset]) => (
            <button
              key={key}
              onClick={() => onSettings(preset.settings)}
              title={preset.blurb}
              className={`rounded-md px-2 py-1.5 text-xs font-medium transition ${
                activePreset === key
                  ? 'bg-emerald-500 text-emerald-950'
                  : 'bg-white/5 text-slate-300 hover:bg-white/10'
              }`}
            >
              {preset.label}
            </button>
          ))}
        </div>
        <div className="space-y-0.5 border-t border-white/10 pt-2">
          <Toggle label="See their cards" hint="Full X-ray - watch how a hand really plays out"
            checked={settings.showOpponentCards} onChange={(v) => set({ showOpponentCards: v })} />
          <Toggle label="Live equity" hint="Your chance of winning, updated every street"
            checked={settings.showEquity} onChange={(v) => set({ showEquity: v })} />
          <Toggle label="Pot odds" hint="The price you're getting, and what you need to win"
            checked={settings.showPotOdds} onChange={(v) => set({ showPotOdds: v })} />
          <Toggle label="Outs" hint="Which cards would rescue you, and how likely"
            checked={settings.showOuts} onChange={(v) => set({ showOuts: v })} />
          <Toggle label="What each action is worth" hint="The EV of every option before you commit"
            checked={settings.showEV} onChange={(v) => set({ showEV: v })} />
          <Toggle label="Their range" hint="Every hand they could hold, narrowed by their actions"
            checked={settings.showRange} onChange={(v) => set({ showRange: v })} />
        </div>
      </section>

      {(settings.showEquity || settings.showPotOdds || settings.showOuts) && (
        <section className="grid grid-cols-2 gap-2">
          {settings.showEquity && equity && (
            <Stat
              label="Your equity"
              value={`${(equity.equity * 100).toFixed(1)}%`}
              sub={
                equity.exact
                  ? `exact, all ${equity.trials.toLocaleString()} runouts`
                  : `+/- ${(equity.margin * 100).toFixed(1)} pts`
              }
              tone={needed !== null && have !== null ? (have >= needed ? 'good' : 'bad') : 'default'}
            />
          )}
          {settings.showPotOdds && needed !== null && (
            <Stat
              label="You need"
              value={`${(needed * 100).toFixed(0)}%`}
              sub="to break even on a call"
            />
          )}
          {settings.showOuts && outs !== null && outs > 0 && (
            <Stat
              label="Outs"
              value={`${outs}`}
              sub={`~${Math.min(99, outs * (cardsToCome === 2 ? 4 : 2))}% to hit (rule of ${cardsToCome === 2 ? 4 : 2})`}
            />
          )}
        </section>
      )}

      {settings.showEquity && settings.showPotOdds && needed !== null && have !== null && (
        <section className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">The call, in one picture</div>
          <div className="relative h-7 overflow-hidden rounded-md bg-slate-800">
            <div className="h-full bg-emerald-500/70" style={{ width: `${Math.min(100, have * 100)}%` }} />
            <div className="absolute inset-y-0 w-0.5 bg-amber-300" style={{ left: `${Math.min(100, needed * 100)}%` }} />
          </div>
          <p className="mt-2 text-[11px] leading-relaxed text-slate-400">
            The green bar is how often you win. The amber line is how often you need to win.
            {have >= needed
              ? ' Green past the line means calling makes money in the long run.'
              : ' Green short of the line means calling loses money, however this particular hand ends.'}
          </p>
        </section>
      )}

      {settings.showEV && grade && (
        <section className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
            What each action is worth
          </div>
          <div className="space-y-1">
            {[...grade.options]
              .sort((a, b) => b.evVsRange - a.evVsRange)
              .map((o, i) => {
                const bb = o.evVsRange / bigBlind;
                const best = i === 0;
                return (
                  <div
                    key={o.label}
                    className={`flex items-center justify-between rounded px-2 py-1 text-xs ${
                      best ? 'bg-emerald-500/15 ring-1 ring-emerald-400/30' : 'bg-white/[0.03]'
                    }`}
                  >
                    <span className={best ? 'font-medium text-emerald-200' : 'text-slate-300'}>{o.label}</span>
                    <span className={`tabular-nums ${bb >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {bb >= 0 ? '+' : ''}{bb.toFixed(2)} bb
                    </span>
                  </div>
                );
              })}
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-slate-500">
            Measured by replaying this exact spot {grade.trials.toLocaleString()} times against{' '}
            {persona.name}&apos;s real strategy. Folding is always 0, so every number is
            &ldquo;better or worse than folding&rdquo;.
          </p>
          {grade.bestVsRange.action.type !== 'fold' &&
            grade.bestVsRange.action.type !== 'check' &&
            grade.heroEquityVsRange < 0.35 && (
              <p className="mt-2 rounded-md bg-amber-500/10 p-2 text-[10px] leading-relaxed text-amber-200/90 ring-1 ring-amber-400/20">
                Careful with this one. Betting big with a weak hand is only correct here because{' '}
                {persona.name} folds far more than a real opponent would. It is the right exploit
                against <em>them</em>, not a habit to carry to a real table.
              </p>
            )}
        </section>
      )}

      {settings.showRange && (
        <section className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
          <RangeGrid range={villainRange} title={`What ${persona.name} can have`} />
        </section>
      )}

      <section className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <div className="text-xs font-semibold text-slate-200">{persona.name}</div>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
          <Annotated text={persona.blurb} />
        </p>
        <div className="mt-2 rounded-md bg-emerald-500/10 p-2 text-[11px] leading-relaxed text-emerald-200/90">
          <span className="font-medium">How to beat them: </span>
          <Annotated text={persona.counter} />
        </div>
      </section>
    </aside>
  );
}
