'use client';

import { useCallback, useMemo, useState } from 'react';
import { CardRow } from '@/components/CardView';
import { TrainingPanel, PRESETS } from '@/components/TrainingPanel';
import type { XraySettings } from '@/components/TrainingPanel';
import { Annotated } from '@/components/Term';
import { makeRng } from '@/lib/poker/cards';
import {
  newHand, applyAction, legalActions, toCall, netResult, STREET_NAMES,
} from '@/lib/poker/engine';
import type { HandState, Action } from '@/lib/poker/engine';
import { PERSONAS, getPersona, botAction } from '@/lib/poker/bots';
import type { BotPersona } from '@/lib/poker/bots';
import { fullRange, removeBlocked, updateRangeWithAction } from '@/lib/poker/ranges';
import type { WeightedRange } from '@/lib/poker/ranges';
import { gradeDecision, equityForDisplay } from '@/lib/poker/grade';
import type { DecisionGrade } from '@/lib/poker/grade';
import { findOuts, requiredEquity } from '@/lib/poker/equity';
import { evaluate, describeHand } from '@/lib/poker/evaluator';

const HERO = 0;
const START_STACK = 200;
const BIG_BLIND = 2;

interface Session {
  state: HandState;
  range: WeightedRange;
  button: number;
  feedback: DecisionGrade | null;
}

interface Stats {
  hands: number;
  net: number;
  decisions: number;
  best: number;
  mistakes: number;
  blunders: number;
  evLost: number;
}

const BLANK_STATS: Stats = { hands: 0, net: 0, decisions: 0, best: 0, mistakes: 0, blunders: 0, evLost: 0 };

/**
 * Let the opponent act until it's our turn again (or the hand is over).
 *
 * Every time they act we narrow their range, using the state as it was BEFORE
 * the action - because "how likely was this hand to bet here" only makes sense
 * from the position they were in when they decided.
 */
function advanceOpponent(
  state: HandState,
  range: WeightedRange,
  persona: BotPersona,
  rng: () => number,
  heroSeat: number
): { state: HandState; range: WeightedRange } {
  let s = state;
  let r = range;
  let guard = 0;
  while (!s.complete && s.toAct !== heroSeat && guard++ < 40) {
    const before = s;
    const action = botAction(s, persona, rng);
    r = updateRangeWithAction(r, before, persona, action);
    s = applyAction(s, action);
  }
  // New board cards are cards they cannot also be holding.
  return { state: s, range: removeBlocked(r, [...s.hole[heroSeat], ...s.board]) };
}

function startHand(button: number, personaId: string, rng: () => number): Session {
  const persona = getPersona(personaId);
  const state = newHand({
    stacks: [START_STACK, START_STACK],
    button,
    bigBlind: BIG_BLIND,
    seed: Math.floor(rng() * 2 ** 31),
  });
  const range = removeBlocked(fullRange(), state.hole[HERO]);
  const advanced = advanceOpponent(state, range, persona, rng, HERO);
  return { ...advanced, button, feedback: null };
}

const VERDICT_STYLE: Record<string, { badge: string; ring: string; label: string }> = {
  best:     { badge: 'bg-emerald-500 text-emerald-950', ring: 'ring-emerald-400/40', label: 'Best play' },
  fine:     { badge: 'bg-sky-500 text-sky-950',         ring: 'ring-sky-400/40',     label: 'Close enough' },
  mistake:  { badge: 'bg-amber-500 text-amber-950',     ring: 'ring-amber-400/40',   label: 'Mistake' },
  blunder:  { badge: 'bg-rose-500 text-rose-950',       ring: 'ring-rose-400/40',    label: 'Blunder' },
};

export default function PlayPage() {
  // One random source that survives re-renders. Held in state with a lazy
  // initializer rather than a ref: a ref's argument is re-evaluated on every
  // render even though only the first result is kept, and reading a ref while
  // rendering is exactly the kind of thing that makes components stop updating
  // when you expect them to. Seeding it with a fixed number means the first
  // hand is identical on the server and in the browser, so hydration matches.
  const [rng] = useState(() => makeRng(20260818));
  const [personaId, setPersonaId] = useState('tag');
  const [spectatorId, setSpectatorId] = useState<string | null>(null);
  const [settings, setSettings] = useState<XraySettings>(PRESETS.full.settings);
  const [session, setSession] = useState<Session>(() => startHand(0, 'tag', rng));
  const [stats, setStats] = useState<Stats>(BLANK_STATS);
  const [raiseAmount, setRaiseAmount] = useState<number | null>(null);

  const persona = getPersona(personaId);
  const spectating = spectatorId !== null;

  const deal = useCallback(
    (button: number, who: string = personaId) => {
      setSession(startHand(button, who, rng));
      setRaiseAmount(null);
    },
    [personaId, rng]
  );

  /** Switching opponents starts a fresh run - results against different players aren't comparable. */
  const changeOpponent = useCallback(
    (id: string) => {
      setPersonaId(id);
      setStats(BLANK_STATS);
      deal(0, id);
    },
    [deal]
  );

  const state = session.state;
  const isHeroTurn = !state.complete && state.toAct === HERO && !spectating;
  const showVillainCards = settings.showOpponentCards || state.complete || spectating;

  const need = toCall(state, HERO);
  const potOdds = need > 0 ? requiredEquity(need, state.pot) : null;

  // --- Live readouts. Each is gated on its toggle so we never pay for a
  // calculation the player has chosen not to look at.
  const equity = useMemo(() => {
    if (state.complete || !settings.showEquity) return null;
    return equityForDisplay(state, HERO, session.range, settings.showOpponentCards);
  }, [state, settings.showEquity, settings.showOpponentCards, session]);

  const outs = useMemo(() => {
    if (state.complete || !settings.showOuts || !settings.showOpponentCards) return null;
    if (state.board.length < 3 || state.board.length >= 5) return null;
    return findOuts(state.hole[HERO], state.hole[1], state.board).length;
  }, [state, settings.showOuts, settings.showOpponentCards]);

  const previewGrade = useMemo(() => {
    if (!isHeroTurn || !settings.showEV) return null;
    return gradeDecision(state, HERO, persona, session.range, null, { trials: 500 });
  }, [isHeroTurn, settings.showEV, session, state, persona]);

  const act = useCallback(
    (action: Action) => {
      // Grade first - once we apply the action the situation is gone.
      const graded = gradeDecision(state, HERO, persona, session.range, action, { trials: 700 });

      let next = applyAction(state, action);
      let range = session.range;
      const advanced = advanceOpponent(next, range, persona, rng, HERO);
      next = advanced.state;
      range = advanced.range;

      if (graded) {
        setStats((s) => ({
          ...s,
          decisions: s.decisions + 1,
          best: s.best + (graded.verdict === 'best' ? 1 : 0),
          mistakes: s.mistakes + (graded.verdict === 'mistake' ? 1 : 0),
          blunders: s.blunders + (graded.verdict === 'blunder' ? 1 : 0),
          evLost: s.evLost + Math.max(0, graded.evLostVsRange),
        }));
      }
      if (next.complete) {
        setStats((s) => ({ ...s, hands: s.hands + 1, net: s.net + netResult(next)[HERO] }));
      }
      setSession({ ...session, state: next, range, feedback: graded });
      setRaiseAmount(null);
    },
    [session, state, persona, rng]
  );

  /** One bot action, for watching two strategies play each other. */
  const step = useCallback(() => {
    if (state.complete) return;
    const who = state.toAct === HERO ? getPersona(spectatorId ?? 'tag') : persona;
    const before = state;
    const action = botAction(state, who, rng);
    let range = session.range;
    if (state.toAct !== HERO) range = updateRangeWithAction(range, before, persona, action);
    const next = applyAction(state, action);
    range = removeBlocked(range, [...next.hole[HERO], ...next.board]);
    if (next.complete) setStats((s) => ({ ...s, hands: s.hands + 1 }));
    setSession({ ...session, state: next, range });
  }, [session, state, persona, spectatorId, rng]);

  const legal = legalActions(state);
  const raiseOpt = legal.find((a) => a.type === 'bet' || a.type === 'raise');
  const heroCards = state.hole[HERO];
  const villainCards = state.hole[1];
  const heroIsButton = state.button === HERO;

  const sizingPresets = raiseOpt
    ? ([
        { label: '½ pot', amount: Math.round(state.betToMatch + state.pot * 0.5) },
        { label: '¾ pot', amount: Math.round(state.betToMatch + state.pot * 0.75) },
        { label: 'Pot', amount: Math.round(state.betToMatch + state.pot) },
        { label: 'All in', amount: raiseOpt.max! },
      ]
        .map((p) => ({ ...p, amount: Math.max(raiseOpt.min!, Math.min(raiseOpt.max!, p.amount)) }))
        .filter((p, i, arr) => arr.findIndex((q) => q.amount === p.amount) === i))
    : [];

  const accuracy = stats.decisions > 0 ? (stats.best / stats.decisions) * 100 : null;
  const bb100 = stats.hands > 0 ? (stats.net / BIG_BLIND / stats.hands) * 100 : null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6">
      {/* ---- Run summary ---- */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-2 text-sm">
          <span className="text-slate-400">Hands <b className="tabular-nums text-slate-100">{stats.hands}</b></span>
          <span className="text-slate-400">
            Net{' '}
            <b className={`tabular-nums ${stats.net >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
              {stats.net >= 0 ? '+' : ''}{(stats.net / BIG_BLIND).toFixed(1)} bb
            </b>
          </span>
          {bb100 !== null && (
            <span className="text-slate-400">
              Rate <b className={`tabular-nums ${bb100 >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                {bb100 >= 0 ? '+' : ''}{bb100.toFixed(0)} bb/100
              </b>
            </span>
          )}
          {accuracy !== null && (
            <span className="text-slate-400">Best play <b className="tabular-nums text-slate-100">{accuracy.toFixed(0)}%</b></span>
          )}
          {stats.decisions > 0 && (
            <span className="text-slate-400">
              EV given up <b className="tabular-nums text-amber-300">{stats.evLost.toFixed(1)} bb</b>
            </span>
          )}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <label className="text-xs text-slate-400">Opponent</label>
          <select
            value={personaId}
            onChange={(e) => changeOpponent(e.target.value)}
            className="rounded-md border border-white/10 bg-slate-800 px-2 py-1.5 text-sm text-slate-200"
          >
            {PERSONAS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          <select
            value={spectatorId ?? ''}
            onChange={(e) => { setSpectatorId(e.target.value || null); deal(session.button); }}
            className="rounded-md border border-white/10 bg-slate-800 px-2 py-1.5 text-sm text-slate-200"
            title="Sit out and watch two strategies play each other"
          >
            <option value="">You play</option>
            {PERSONAS.map((p) => <option key={p.id} value={p.id}>Watch: {p.name}</option>)}
          </select>
        </div>
      </div>

      <div className="flex flex-col gap-5 lg:flex-row">
        <div className="min-w-0 flex-1">
          {/* ---- The table ---- */}
          <div className="felt relative overflow-hidden rounded-2xl border border-emerald-950/60 p-5 shadow-2xl">
            {/* Opponent */}
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-white/90">
                    {spectating ? getPersona(spectatorId!).name : persona.name}
                  </span>
                  {!heroIsButton && (
                    <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-medium text-white/80">BTN</span>
                  )}
                </div>
                <div className="text-xs tabular-nums text-emerald-200/70">
                  {state.stack[1]} chips{state.committed[1] > 0 && ` · betting ${state.committed[1]}`}
                </div>
              </div>
              <CardRow cards={villainCards} size="sm" hidden={!showVillainCards} />
            </div>

            {/* Board and pot */}
            <div className="my-6 flex flex-col items-center gap-3">
              <div className="rounded-full bg-black/30 px-4 py-1 text-sm">
                <span className="text-emerald-200/60">Pot </span>
                <span className="font-semibold tabular-nums text-white">{state.pot}</span>
                <span className="text-emerald-200/50"> ({(state.pot / BIG_BLIND).toFixed(1)} bb)</span>
              </div>
              <CardRow cards={state.board} size="md" placeholders={5} />
              <div className="text-xs text-emerald-200/50">
                {state.complete ? 'Hand complete' : STREET_NAMES[state.street]}
              </div>
            </div>

            {/* Hero */}
            <div className="flex items-end justify-between">
              <CardRow cards={heroCards} size="md" />
              <div className="text-right">
                <div className="flex items-center justify-end gap-2">
                  {heroIsButton && (
                    <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-medium text-white/80">BTN</span>
                  )}
                  <span className="text-sm font-semibold text-white/90">{spectating ? getPersona(spectatorId!).name : 'You'}</span>
                </div>
                <div className="text-xs tabular-nums text-emerald-200/70">
                  {state.stack[HERO]} chips{state.committed[HERO] > 0 && ` · betting ${state.committed[HERO]}`}
                </div>
                {state.board.length >= 3 && (
                  <div className="mt-1 text-xs text-amber-200/80">
                    <Annotated text={describeHand(evaluate([...heroCards, ...state.board]))} />
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ---- Actions ---- */}
          <div className="mt-4">
            {state.complete ? (
              <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className={`text-lg font-semibold ${netResult(state)[HERO] >= 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                      {netResult(state)[HERO] >= 0 ? 'You win ' : 'You lose '}
                      {Math.abs(netResult(state)[HERO] / BIG_BLIND).toFixed(1)} bb
                    </div>
                    <div className="text-sm text-slate-400">
                      {state.result?.showdown && state.result.handDescriptions ? (
                        <Annotated text={`${state.result.handDescriptions[HERO]} vs ${state.result.handDescriptions[1]}`} />
                      ) : (
                        'Won without a showdown'
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => deal(1 - session.button)}
                    className="rounded-lg bg-emerald-500 px-5 py-2.5 font-semibold text-emerald-950 transition hover:bg-emerald-400"
                  >
                    Next hand
                  </button>
                </div>
              </div>
            ) : spectating ? (
              <div className="flex items-center gap-3">
                <button
                  onClick={step}
                  className="rounded-lg bg-sky-500 px-5 py-2.5 font-semibold text-sky-950 transition hover:bg-sky-400"
                >
                  Step forward
                </button>
                <span className="text-sm text-slate-400">
                  Watching {getPersona(spectatorId!).name} play {persona.name}. Both hands are face up.
                </span>
              </div>
            ) : isHeroTurn ? (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {legal.filter((a) => a.type !== 'bet' && a.type !== 'raise').map((a) => (
                    <button
                      key={a.type}
                      onClick={() => act({ type: a.type, amount: a.amount })}
                      className={`rounded-lg px-5 py-2.5 font-semibold transition ${
                        a.type === 'fold'
                          ? 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                          : 'bg-emerald-500 text-emerald-950 hover:bg-emerald-400'
                      }`}
                    >
                      {a.label}
                    </button>
                  ))}
                  {sizingPresets.map((p) => (
                    <button
                      key={p.label}
                      onClick={() => act({ type: raiseOpt!.type, amount: p.amount })}
                      className="rounded-lg bg-amber-500/90 px-4 py-2.5 font-semibold text-amber-950 transition hover:bg-amber-400"
                      title={`${raiseOpt!.type === 'bet' ? 'Bet' : 'Raise to'} ${p.amount}`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                {raiseOpt && raiseOpt.max! > raiseOpt.min! && (
                  <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                    <span className="text-xs text-slate-400">Custom</span>
                    <input
                      type="range"
                      min={raiseOpt.min}
                      max={raiseOpt.max}
                      value={raiseAmount ?? raiseOpt.min!}
                      onChange={(e) => setRaiseAmount(Number(e.target.value))}
                      className="flex-1 accent-amber-400"
                    />
                    <span className="w-14 text-right text-sm tabular-nums text-slate-200">
                      {raiseAmount ?? raiseOpt.min}
                    </span>
                    <button
                      onClick={() => act({ type: raiseOpt.type, amount: raiseAmount ?? raiseOpt.min! })}
                      className="rounded-md bg-amber-500/90 px-3 py-1.5 text-sm font-semibold text-amber-950 hover:bg-amber-400"
                    >
                      {raiseOpt.type === 'bet' ? 'Bet' : 'Raise'}
                    </button>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          {/* ---- Feedback on the last decision ---- */}
          {session.feedback && (
            <div
              className={`fade-up mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-4 ring-1 ${
                VERDICT_STYLE[session.feedback.verdict].ring
              }`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs font-bold ${VERDICT_STYLE[session.feedback.verdict].badge}`}>
                  {VERDICT_STYLE[session.feedback.verdict].label}
                </span>
                <span className="text-sm font-medium text-slate-100">{session.feedback.headline}</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-slate-300">
                <Annotated text={session.feedback.detail} />
              </p>
              <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-400">
                <span>
                  Your equity vs their range:{' '}
                  <b className="text-slate-200">{(session.feedback.heroEquityVsRange * 100).toFixed(0)}%</b>
                </span>
                <span>
                  Vs the hand they actually had:{' '}
                  <b className="text-slate-200">{(session.feedback.heroEquityVsHand * 100).toFixed(0)}%</b>
                </span>
                <span>
                  Their range was <b className="text-slate-200">{(session.feedback.villainRangePercent * 100).toFixed(0)}%</b> of hands
                </span>
                {session.feedback.foldFrequency !== null && (
                  <span>
                    They fold <b className="text-slate-200">{(session.feedback.foldFrequency * 100).toFixed(0)}%</b> to that
                  </span>
                )}
              </div>
            </div>
          )}

          {/* ---- Hand history ---- */}
          <div className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">This hand</span>
              <span className="text-[10px] text-slate-500">
                You are the {heroIsButton ? 'Button' : 'Big blind'} this hand
              </span>
            </div>
            <ol className="space-y-0.5 text-xs text-slate-400">
              {state.log.map((entry, i) => (
                <li key={i} className={entry.kind === 'result' ? 'font-medium text-emerald-300' : ''}>
                  {entry.text}
                </li>
              ))}
            </ol>
          </div>
        </div>

        <TrainingPanel
          settings={settings}
          onSettings={setSettings}
          equity={equity}
          grade={previewGrade}
          potOdds={potOdds}
          villainRange={session.range}
          persona={persona}
          bigBlind={BIG_BLIND}
          outs={outs}
          cardsToCome={state.board.length === 3 ? 2 : 1}
        />
      </div>
    </div>
  );
}
