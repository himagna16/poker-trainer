'use client';

import { useCallback, useState } from 'react';
import { CardRow } from '@/components/CardView';
import { Annotated } from '@/components/Term';
import { DRILLS, makeSpot, scoreGuess, HERO } from '@/lib/poker/drills';
import type { DrillId, DrillSpot } from '@/lib/poker/drills';
import { legalActions, toCall, STREET_NAMES } from '@/lib/poker/engine';
import type { Action } from '@/lib/poker/engine';
import { gradeDecision } from '@/lib/poker/grade';
import { describeHand, evaluate } from '@/lib/poker/evaluator';
import { cardsToString } from '@/lib/poker/cards';
import { requiredEquity, ruleOf2And4 } from '@/lib/poker/equity';

interface Score { asked: number; right: number; streak: number; bestStreak: number }
const BLANK: Score = { asked: 0, right: 0, streak: 0, bestStreak: 0 };

interface Result {
  correct: boolean;
  title: string;
  body: string;
  extra?: string;
}

const VERDICT_TONE: Record<string, string> = {
  best: 'border-emerald-400/40 bg-emerald-500/10',
  fine: 'border-sky-400/40 bg-sky-500/10',
  mistake: 'border-amber-400/40 bg-amber-500/10',
  blunder: 'border-rose-400/40 bg-rose-500/10',
};

export default function DrillsPage() {
  const [drill, setDrill] = useState<DrillId>('preflop');
  // A fixed seed for the very first question so the server and the browser
  // render the same thing. Everything after that is genuinely random.
  const [spot, setSpot] = useState<DrillSpot | null>(() => makeSpot('preflop', 20260818));
  const [result, setResult] = useState<Result | null>(null);
  const [scores, setScores] = useState<Record<DrillId, Score>>({
    preflop: { ...BLANK }, potodds: { ...BLANK }, outs: { ...BLANK }, equity: { ...BLANK },
  });
  const [guess, setGuess] = useState('');

  /** Generate a fresh question for a drill. Some spots are rare, so we retry. */
  const loadSpot = useCallback((id: DrillId) => {
    let s: DrillSpot | null = null;
    let attempt = 0;
    while (!s && attempt++ < 8) s = makeSpot(id, Math.floor(Math.random() * 1e9));
    setSpot(s);
    setResult(null);
    setGuess('');
  }, []);

  const next = useCallback(() => loadSpot(drill), [loadSpot, drill]);

  const record = (correct: boolean) => {
    setScores((prev) => {
      const s = prev[drill];
      const streak = correct ? s.streak + 1 : 0;
      return {
        ...prev,
        [drill]: {
          asked: s.asked + 1,
          right: s.right + (correct ? 1 : 0),
          streak,
          bestStreak: Math.max(s.bestStreak, streak),
        },
      };
    });
  };

  const answerPlay = (action: Action) => {
    if (!spot || (spot.kind !== 'preflop' && spot.kind !== 'potodds') || result) return;
    const graded = gradeDecision(spot.state, HERO, spot.persona, spot.range, action, { trials: 600 });
    if (!graded) return;

    // These drills ask "fold, call, or raise?" - so we score the DECISION, not
    // the exact bet size. Picking raise when raising is right is the lesson;
    // whether it should have been half pot or full pot is a refinement, and we
    // say so separately rather than marking the answer wrong.
    const rightIdea = graded.bestVsRange.action.type === action.type;
    const correct = rightIdea || graded.verdict === 'best' || graded.verdict === 'fine';
    record(correct);

    const bestSameType = graded.options
      .filter((o) => o.action.type === action.type)
      .reduce((a, b) => (b.evVsRange > a.evVsRange ? b : a));
    const sizingGap = (graded.bestVsRange.evVsRange - bestSameType.evVsRange) / 2;
    const sizingNote =
      rightIdea && graded.chosen && bestSameType.label !== graded.chosen.label && sizingGap > 0.15
        ? ` On sizing: ${bestSameType.label} would have been worth another ${sizingGap.toFixed(2)} bb.`
        : '';

    setResult({
      correct,
      title: rightIdea && graded.verdict !== 'best'
        ? `Right idea - ${action.type === 'fold' ? 'folding' : action.type === 'call' ? 'calling' : 'raising'} is correct here`
        : graded.headline,
      body: graded.detail + sizingNote,
      extra: `verdict:${correct ? (graded.verdict === 'best' ? 'best' : 'fine') : graded.verdict}`,
    });
  };

  const answerNumber = () => {
    if (!spot || result) return;
    const value = Number(guess);
    if (!Number.isFinite(value)) return;

    if (spot.kind === 'outs') {
      const truth = spot.outs.length;
      const { correct } = scoreGuess(value, truth, 0);
      record(correct);
      const naive = spot.outs.length;
      setResult({
        correct,
        title: correct ? `Correct - ${truth} outs` : `Not quite - it's ${truth}, you said ${value}`,
        body:
          `The cards that save you: ${spot.outs.map((c) => cardsToString([c])).join(', ')}. ` +
          `With ${naive} outs and ${spot.board.length === 3 ? 'two cards' : 'one card'} to come, the rule of ` +
          `${spot.board.length === 3 ? '4' : '2'} says about ${(ruleOf2And4(naive, spot.board.length === 3 ? 2 : 1) * 100).toFixed(0)}%. ` +
          `Your real equity is ${(spot.equity * 100).toFixed(1)}%, because your opponent can improve too.`,
      });
    } else if (spot.kind === 'equity') {
      const truth = spot.equity * 100;
      const { correct, close } = scoreGuess(value, truth, 5);
      record(correct);
      setResult({
        correct,
        title: correct
          ? `Nice - it's ${truth.toFixed(1)}%, you said ${value}%`
          : close
            ? `Close - it's ${truth.toFixed(1)}%, you said ${value}%`
            : `Off by ${Math.abs(value - truth).toFixed(0)} points - it's ${truth.toFixed(1)}%`,
        body:
          `${describeHand(evaluate([...spot.hero, ...spot.board]))} against ` +
          `${describeHand(evaluate([...spot.villain, ...spot.board]))}` +
          (spot.board.length === 0 ? ' (before any board cards).' : '.'),
      });
    }
  };

  const score = scores[drill];
  const meta = DRILLS.find((d) => d.id === drill)!;

  return (
    <div className="mx-auto max-w-5xl px-4 py-6">
      {/* Drill picker */}
      <div className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {DRILLS.map((d) => {
          const s = scores[d.id as DrillId];
          const active = d.id === drill;
          return (
            <button
              key={d.id}
              onClick={() => { setDrill(d.id as DrillId); loadSpot(d.id as DrillId); }}
              className={`rounded-xl border p-3 text-left transition ${
                active
                  ? 'border-emerald-400/50 bg-emerald-500/10'
                  : 'border-white/10 bg-white/[0.02] hover:bg-white/[0.05]'
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span className={`text-sm font-semibold ${active ? 'text-emerald-200' : 'text-slate-200'}`}>
                  {d.name}
                </span>
                {s.asked > 0 && (
                  <span className="text-[10px] tabular-nums text-slate-400">
                    {Math.round((s.right / s.asked) * 100)}%
                  </span>
                )}
              </div>
              <p className="mt-1 text-[11px] leading-snug text-slate-400">{d.blurb}</p>
            </button>
          );
        })}
      </div>

      <div className="mb-4 rounded-xl border border-white/10 bg-white/[0.02] p-3">
        <p className="text-xs leading-relaxed text-slate-400">
          <span className="font-medium text-slate-300">What this teaches: </span>
          <Annotated text={meta.teaches} />
        </p>
      </div>

      {/* Scoreboard */}
      <div className="mb-4 flex flex-wrap gap-4 rounded-xl border border-white/10 bg-white/[0.02] px-4 py-2 text-sm">
        <span className="text-slate-400">Asked <b className="tabular-nums text-slate-100">{score.asked}</b></span>
        <span className="text-slate-400">
          Correct <b className="tabular-nums text-emerald-300">{score.right}</b>
          {score.asked > 0 && <span className="text-slate-500"> ({Math.round((score.right / score.asked) * 100)}%)</span>}
        </span>
        <span className="text-slate-400">Streak <b className="tabular-nums text-slate-100">{score.streak}</b></span>
        <span className="text-slate-400">Best <b className="tabular-nums text-slate-100">{score.bestStreak}</b></span>
      </div>

      {!spot ? (
        <div className="grid h-48 place-items-center text-slate-500">Dealing…</div>
      ) : (
        <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-5">
          {/* ---------- The question ---------- */}
          {(spot.kind === 'preflop' || spot.kind === 'potodds') && (
            <>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-slate-400">
                  You are the{' '}
                  <b className="text-slate-200">{spot.state.button === HERO ? 'Button' : 'Big blind'}</b>{' '}
                  against <b className="text-slate-200">{spot.persona.name}</b>
                  {spot.state.board.length > 0 && <> on the <b className="text-slate-200">{STREET_NAMES[spot.state.street]}</b></>}
                </div>
                <div className="text-sm tabular-nums text-slate-400">
                  Pot <b className="text-slate-100">{spot.state.pot}</b>
                  {toCall(spot.state, HERO) > 0 && (
                    <> · To call <b className="text-slate-100">{toCall(spot.state, HERO)}</b>
                      <span className="text-slate-500"> (need {(requiredEquity(toCall(spot.state, HERO), spot.state.pot) * 100).toFixed(0)}%)</span>
                    </>
                  )}
                </div>
              </div>

              <div className="mb-5 flex flex-wrap items-end gap-6">
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Your hand</div>
                  <CardRow cards={spot.state.hole[HERO]} size="lg" />
                </div>
                {spot.state.board.length > 0 && (
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Board</div>
                    <CardRow cards={spot.state.board} size="md" />
                  </div>
                )}
              </div>

              {!result && (
                <div className="flex flex-wrap gap-2">
                  {legalActions(spot.state).map((a) => {
                    if (a.type === 'bet' || a.type === 'raise') {
                      const presets = [
                        { label: `${a.type === 'bet' ? 'Bet' : 'Raise'} ½ pot`, amount: Math.round(spot.state.betToMatch + spot.state.pot * 0.5) },
                        { label: `${a.type === 'bet' ? 'Bet' : 'Raise'} pot`, amount: Math.round(spot.state.betToMatch + spot.state.pot) },
                      ].map((p) => ({ ...p, amount: Math.max(a.min!, Math.min(a.max!, p.amount)) }))
                        .filter((p, i, arr) => arr.findIndex((q) => q.amount === p.amount) === i);
                      return presets.map((p) => (
                        <button
                          key={p.label}
                          onClick={() => answerPlay({ type: a.type, amount: p.amount })}
                          className="rounded-lg bg-amber-500/90 px-5 py-2.5 font-semibold text-amber-950 transition hover:bg-amber-400"
                        >
                          {p.label}
                        </button>
                      ));
                    }
                    return (
                      <button
                        key={a.type}
                        onClick={() => answerPlay({ type: a.type, amount: a.amount })}
                        className={`rounded-lg px-5 py-2.5 font-semibold transition ${
                          a.type === 'fold'
                            ? 'bg-slate-700 text-slate-200 hover:bg-slate-600'
                            : 'bg-emerald-500 text-emerald-950 hover:bg-emerald-400'
                        }`}
                      >
                        {a.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {(spot.kind === 'outs' || spot.kind === 'equity') && (
            <>
              <div className="mb-5 flex flex-wrap items-end gap-6">
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">You</div>
                  <CardRow cards={spot.hero} size="lg" />
                </div>
                <div>
                  <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Opponent</div>
                  <CardRow cards={spot.villain} size="lg" />
                </div>
                {spot.board.length > 0 && (
                  <div>
                    <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">Board</div>
                    <CardRow cards={spot.board} size="md" />
                  </div>
                )}
              </div>

              {!result && (
                <div className="flex flex-wrap items-center gap-3">
                  <label className="text-sm text-slate-300">
                    {spot.kind === 'outs' ? 'How many outs do you have?' : 'What % of the time do you win?'}
                  </label>
                  <input
                    type="number"
                    value={guess}
                    onChange={(e) => setGuess(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && answerNumber()}
                    min={0}
                    max={spot.kind === 'outs' ? 25 : 100}
                    autoFocus
                    className="w-24 rounded-lg border border-white/15 bg-slate-800 px-3 py-2 text-lg tabular-nums text-slate-100 outline-none focus:border-emerald-400"
                  />
                  <button
                    onClick={answerNumber}
                    disabled={guess === ''}
                    className="rounded-lg bg-emerald-500 px-5 py-2.5 font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-40"
                  >
                    Check
                  </button>
                </div>
              )}
            </>
          )}

          {/* ---------- Feedback ---------- */}
          {result && (
            <div
              className={`fade-up mt-4 rounded-xl border p-4 ${
                result.extra?.startsWith('verdict:')
                  ? VERDICT_TONE[result.extra.slice(8)]
                  : result.correct
                    ? 'border-emerald-400/40 bg-emerald-500/10'
                    : 'border-amber-400/40 bg-amber-500/10'
              }`}
            >
              <div className="font-semibold text-slate-100">{result.title}</div>
              <p className="mt-1.5 text-sm leading-relaxed text-slate-300">
                <Annotated text={result.body} />
              </p>
              <button
                onClick={next}
                autoFocus
                className="mt-4 rounded-lg bg-emerald-500 px-5 py-2.5 font-semibold text-emerald-950 transition hover:bg-emerald-400"
              >
                Next hand
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
