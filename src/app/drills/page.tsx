'use client';

import Link from 'next/link';
import { useCallback, useState } from 'react';
import { CardRow } from '@/components/CardView';
import { Annotated } from '@/components/Term';
import { Panel, PanelTitle, Button, Badge, Segmented, Stat } from '@/components/ui';
import { DRILLS, makeSpot, scoreGuess } from '@/lib/poker/drills';
import type { DrillId, DrillSpot } from '@/lib/poker/drills';
import { legalActions, toCall, positionName, positionLabel, livePlayers, STREET_NAMES } from '@/lib/poker/engine';
import type { Action } from '@/lib/poker/engine';
import { gradeDecision } from '@/lib/poker/grade';
import type { Verdict } from '@/lib/poker/grade';
import { describeHand, evaluate } from '@/lib/poker/evaluator';
import { cardsToString } from '@/lib/poker/cards';
import { requiredEquity, ruleOf2And4 } from '@/lib/poker/equity';
import { restoreSpot } from '@/lib/poker/spots';
import {
  useStore, useNow, dueSpots, reviewSpot, summarize, formatWhen, resetEverything,
} from '@/lib/poker/storage';

/**
 * The review drill isn't generated - it replays spots you actually got wrong,
 * pulled from storage. That's the difference between practising poker and
 * practising YOUR poker.
 */
type PageDrill = DrillId | 'review';

const REVIEW_META = {
  id: 'review' as const,
  name: 'Replay your mistakes',
  blurb: 'The spots you got wrong, brought back.',
  teaches:
    'Your own errors, at the moment you have started to forget them. Get one right and it comes ' +
    'back further away; get it wrong and it comes back sooner. This is the drill that actually ' +
    'moves your win rate, because it targets exactly the gaps you have rather than the average ' +
    "player's.",
};

interface Score { asked: number; right: number; streak: number; bestStreak: number }
const BLANK: Score = { asked: 0, right: 0, streak: 0, bestStreak: 0 };

interface Result {
  correct: boolean;
  verdict: Verdict | null;
  title: string;
  body: string;
}

const VERDICT_TONE: Record<Verdict, 'good' | 'neutral' | 'warn' | 'bad'> = {
  best: 'good', fine: 'neutral', mistake: 'warn', blunder: 'bad',
};

export default function DrillsPage() {
  const store = useStore();
  const now = useNow();
  const progress = summarize(store, now);
  const [drill, setDrill] = useState<PageDrill>('preflop');
  /** Set while replaying a saved mistake, so the answer can reschedule it. */
  const [reviewId, setReviewId] = useState<string | null>(null);
  const [tableSize, setTableSize] = useState(6);
  // A fixed seed for the first question so the server and browser agree.
  const [spot, setSpot] = useState<DrillSpot | null>(() => makeSpot('preflop', 20260819, 6));
  const [result, setResult] = useState<Result | null>(null);
  const [guess, setGuess] = useState('');
  const [scores, setScores] = useState<Record<PageDrill, Score>>({
    preflop: { ...BLANK }, potodds: { ...BLANK }, outs: { ...BLANK },
    equity: { ...BLANK }, review: { ...BLANK },
  });

  const loadSpot = useCallback((id: PageDrill, size: number) => {
    setResult(null);
    setGuess('');

    if (id === 'review') {
      const due = dueSpots(store, Date.now());
      if (due.length === 0) {
        setSpot(null);
        setReviewId(null);
        return;
      }
      const saved = due[0];
      const restored = restoreSpot(saved.snapshot);
      setSpot({
        kind: restored.state.street === 0 ? 'preflop' : 'potodds',
        state: restored.state,
        heroSeat: restored.heroSeat,
        lineup: restored.lineup,
        book: restored.book,
      });
      setReviewId(saved.id);
      return;
    }

    setReviewId(null);
    let s: DrillSpot | null = null;
    let attempt = 0;
    while (!s && attempt++ < 8) s = makeSpot(id, Math.floor(Math.random() * 1e9), size);
    setSpot(s);
  }, [store]);

  const next = useCallback(() => loadSpot(drill, tableSize), [loadSpot, drill, tableSize]);
  const reviewing = drill === 'review';

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
    const graded = gradeDecision(spot.state, spot.heroSeat, spot.lineup, spot.book, action, { trials: 500 });
    if (!graded) return;

    // These drills ask "fold, call, or raise?" - so we score the DECISION, not
    // the exact bet size. Choosing to raise when raising is right is the lesson;
    // whether it should have been half pot or full pot is a refinement, and we
    // say so separately rather than marking the answer wrong.
    const rightIdea = graded.bestVsRange.action.type === action.type;
    const correct = rightIdea || graded.verdict === 'best' || graded.verdict === 'fine';
    record(correct);

    const sameType = graded.options.filter((o) => o.action.type === action.type);
    const bestSame = sameType.reduce((a, b) => (b.evVsRange > a.evVsRange ? b : a), sameType[0]);
    const sizingGap = bestSame ? (graded.bestVsRange.evVsRange - bestSame.evVsRange) / 2 : 0;
    const sizingNote =
      rightIdea && graded.chosen && bestSame && bestSame.label !== graded.chosen.label && sizingGap > 0.15
        ? ` On sizing: ${bestSame.label} would have been worth another ${sizingGap.toFixed(2)} bb.`
        : '';

    if (reviewId) reviewSpot(reviewId, correct);

    setResult({
      correct,
      verdict: correct ? (graded.verdict === 'best' ? 'best' : 'fine') : graded.verdict,
      title: rightIdea && graded.verdict !== 'best'
        ? `Right idea — ${action.type === 'fold' ? 'folding' : action.type === 'call' ? 'calling' : 'raising'} is correct here`
        : graded.headline,
      body: graded.detail + sizingNote,
    });
  };

  const answerNumber = () => {
    if (!spot || result) return;
    const value = Number(guess);
    if (!Number.isFinite(value) || guess === '') return;

    if (spot.kind === 'outs') {
      const truth = spot.outs.length;
      const { correct } = scoreGuess(value, truth, 0);
      record(correct);
      setResult({
        correct,
        verdict: correct ? 'best' : 'mistake',
        title: correct ? `Correct — ${truth} outs` : `Not quite — it's ${truth}, you said ${value}`,
        body:
          `The cards that save you: ${spot.outs.map((c) => cardsToString([c])).join(', ')}. ` +
          `With ${truth} outs and ${spot.board.length === 3 ? 'two cards' : 'one card'} to come, the rule of ` +
          `${spot.board.length === 3 ? '4' : '2'} says about ${(ruleOf2And4(truth, spot.board.length === 3 ? 2 : 1) * 100).toFixed(0)}%. ` +
          `Your real equity is ${(spot.equity * 100).toFixed(1)}%, which is lower because your opponent can improve too.`,
      });
    } else if (spot.kind === 'equity') {
      const truth = spot.equity * 100;
      const { correct, close } = scoreGuess(value, truth, 5);
      record(correct);
      setResult({
        correct,
        verdict: correct ? 'best' : close ? 'fine' : 'mistake',
        title: correct
          ? `Nice — it's ${truth.toFixed(1)}%, you said ${value}%`
          : close
            ? `Close — it's ${truth.toFixed(1)}%, you said ${value}%`
            : `Off by ${Math.abs(value - truth).toFixed(0)} points — it's ${truth.toFixed(1)}%`,
        body:
          `${describeHand(evaluate([...spot.hero, ...spot.board]))} against ` +
          `${describeHand(evaluate([...spot.villain, ...spot.board]))}` +
          (spot.board.length === 0 ? ', before any board cards.' : '.'),
      });
    }
  };

  const score = scores[drill];
  const meta = reviewing ? REVIEW_META : DRILLS.find((d) => d.id === drill)!;

  return (
    <div className="mx-auto max-w-4xl px-4 pb-16 pt-6">
      <header className="mb-6">
        <p className="eyebrow">Drills</p>
        <h1 className="display mt-1 text-[40px]">
          Two hundred decisions, <em>not twenty</em>
        </h1>
        <p className="mt-2 max-w-xl text-[15px] leading-relaxed text-[var(--color-ink-muted)]">
          A full hand takes a minute and contains maybe three decisions, most of them easy. These give
          you the hard one on its own, over and over.
        </p>
      </header>

      <button
        onClick={() => { setDrill('review'); loadSpot('review', tableSize); }}
        className={`mb-2 flex w-full flex-wrap items-center gap-3 rounded-2xl border p-4 text-left transition ${
          reviewing
            ? 'border-[var(--color-ink)] bg-[var(--color-surface)] lift'
            : 'border-[var(--color-line)] hover:bg-[var(--color-surface)]'
        }`}
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[var(--color-lav)] text-[15px] text-[var(--color-lav-ink)]">
          ↺
        </span>
        <span className="min-w-0">
          <span className="block text-[15px] font-medium">Replay your mistakes</span>
          <span className="block text-[12px] text-[var(--color-ink-faint)]">
            {progress.due > 0
              ? `${progress.due} spot${progress.due === 1 ? '' : 's'} ready to try again`
              : progress.pending > 0
                ? `${progress.pending} saved · next one ready in ${formatWhen(progress.nextDueIn ?? 0)}`
                : 'Nothing saved yet — misplayed hands land here automatically'}
          </span>
        </span>
        {progress.due > 0 && (
          <span className="tnum ml-auto rounded-full bg-[var(--color-lav)] px-3 py-1 text-[13px] font-medium text-[var(--color-lav-ink)]">
            {progress.due}
          </span>
        )}
        {progress.learned > 0 && (
          <span className="ml-auto text-[12px] text-[var(--color-good)]">
            {progress.learned} learned
          </span>
        )}
      </button>

      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {DRILLS.map((d) => {
          const s = scores[d.id];
          const active = d.id === drill;
          return (
            <button
              key={d.id}
              onClick={() => { setDrill(d.id); loadSpot(d.id, tableSize); }}
              className={`rounded-2xl border p-3 text-left transition ${
                active
                  ? 'border-[var(--color-ink)] bg-[var(--color-surface)] lift'
                  : 'border-[var(--color-line)] bg-transparent hover:bg-[var(--color-surface)]'
              }`}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[14px] font-medium">{d.name}</span>
                {s.asked > 0 && (
                  <span className="tnum text-[11px] text-[var(--color-ink-faint)]">
                    {Math.round((s.right / s.asked) * 100)}%
                  </span>
                )}
              </div>
              <p className="mt-1 text-[12px] leading-snug text-[var(--color-ink-faint)]">{d.blurb}</p>
            </button>
          );
        })}
      </div>

      <Panel className="mb-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <p className="max-w-lg text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
            <span className="font-medium text-[var(--color-ink)]">What this teaches: </span>
            <Annotated text={meta.teaches} />
          </p>
          <div className="flex items-center gap-4">
            {(drill === 'preflop' || drill === 'potodds') && (
              <Segmented
                size="sm"
                options={[
                  { value: 2, label: 'HU' },
                  { value: 6, label: '6-max' },
                  { value: 9, label: '9' },
                ]}
                value={tableSize}
                onChange={(v) => { setTableSize(v); loadSpot(drill, v); }}
              />
            )}
            <div className="flex gap-5">
              <Stat label="Asked" value={String(score.asked)} size="sm" />
              <Stat
                label="Correct"
                value={score.asked ? `${Math.round((score.right / score.asked) * 100)}%` : '—'}
                size="sm"
                tone={score.asked && score.right / score.asked >= 0.7 ? 'good' : 'default'}
              />
              <Stat label="Streak" value={String(score.streak)} size="sm" sub={`best ${score.bestStreak}`} />
            </div>
          </div>
        </div>
      </Panel>

      {!spot && reviewing ? (
        <Panel>
          <div className="py-10 text-center">
            <p className="display text-[26px]">
              {progress.pending > 0 ? 'Nothing ready just yet' : 'No mistakes saved yet'}
            </p>
            <p className="mx-auto mt-2 max-w-md text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
              {progress.pending > 0
                ? `You have ${progress.pending} spot${progress.pending === 1 ? '' : 's'} waiting. The next one is ready in ${formatWhen(progress.nextDueIn ?? 0)} — leaving a gap is the point, since recalling something you had started to forget is what makes it stick.`
                : 'Play some hands and any decision graded a mistake or worse gets saved here automatically, then comes back as a drill.'}
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <Link
                href="/play"
                className="rounded-full bg-[var(--color-ink)] px-6 py-2.5 text-[14px] font-medium text-[var(--color-paper)] transition hover:bg-[#2c2a25]"
              >
                Go play some hands
              </Link>
              <Button tone="quiet" size="md" onClick={() => { setDrill('preflop'); loadSpot('preflop', tableSize); }}>
                Try another drill
              </Button>
            </div>
          </div>
        </Panel>
      ) : !spot ? (
        <Panel><p className="py-10 text-center text-[var(--color-ink-faint)]">Dealing…</p></Panel>
      ) : (
        <Panel>
          {(spot.kind === 'preflop' || spot.kind === 'potodds') && (
            <>
              <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
                <p className="text-[14px] text-[var(--color-ink-muted)]">
                  You are the <b className="text-[var(--color-ink)]">{positionName(spot.state, spot.heroSeat)}</b>
                  {' '}at a {spot.state.playerCount}-handed table
                  {spot.state.board.length > 0 && <> on the <b className="text-[var(--color-ink)]">{STREET_NAMES[spot.state.street]}</b></>}
                  {', '}
                  <b className="text-[var(--color-ink)]">{livePlayers(spot.state).length}</b> players live.
                </p>
                <p className="tnum text-[14px] text-[var(--color-ink-muted)]">
                  Pot <b className="text-[var(--color-ink)]">{spot.state.pot}</b>
                  {toCall(spot.state, spot.heroSeat) > 0 && (
                    <>
                      {' · '}To call <b className="text-[var(--color-ink)]">{toCall(spot.state, spot.heroSeat)}</b>
                      <span className="text-[var(--color-ink-faint)]">
                        {' '}(need {(requiredEquity(toCall(spot.state, spot.heroSeat), spot.state.pot) * 100).toFixed(0)}%)
                      </span>
                    </>
                  )}
                </p>
              </div>

              <div className="mb-5 flex flex-wrap items-end gap-8">
                <div>
                  <p className="eyebrow mb-1.5">Your hand</p>
                  <CardRow cards={spot.state.hole[spot.heroSeat]} size="xl" />
                </div>
                {spot.state.board.length > 0 && (
                  <div>
                    <p className="eyebrow mb-1.5">Board</p>
                    <CardRow cards={spot.state.board} size="lg" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="eyebrow mb-1.5">Still in</p>
                  <div className="flex flex-wrap gap-1.5">
                    {livePlayers(spot.state)
                      .filter((s) => s !== spot.heroSeat)
                      .map((s) => (
                        <Badge key={s}>
                          {positionLabel(spot.state, s)} · {spot.lineup[s]?.tag ?? '?'}
                        </Badge>
                      ))}
                  </div>
                </div>
              </div>

              {!result && (
                <div className="flex flex-wrap gap-2">
                  {legalActions(spot.state).flatMap((a) => {
                    if (a.type === 'bet' || a.type === 'raise') {
                      return [
                        { label: `${a.type === 'bet' ? 'Bet' : 'Raise'} ½ pot`, amount: Math.round(spot.state.betToMatch + spot.state.pot * 0.5) },
                        { label: `${a.type === 'bet' ? 'Bet' : 'Raise'} pot`, amount: Math.round(spot.state.betToMatch + spot.state.pot) },
                      ]
                        .map((p) => ({ ...p, amount: Math.max(a.min!, Math.min(a.max!, p.amount)) }))
                        .filter((p, i, arr) => arr.findIndex((q) => q.amount === p.amount) === i)
                        .map((p) => (
                          <Button key={p.label} tone="accent" size="lg" onClick={() => answerPlay({ type: a.type, amount: p.amount })}>
                            {p.label}
                          </Button>
                        ));
                    }
                    return [
                      <Button
                        key={a.type}
                        tone={a.type === 'fold' ? 'quiet' : 'primary'}
                        size="lg"
                        onClick={() => answerPlay({ type: a.type, amount: a.amount })}
                      >
                        {a.label}
                      </Button>,
                    ];
                  })}
                </div>
              )}
            </>
          )}

          {(spot.kind === 'outs' || spot.kind === 'equity') && (
            <>
              <div className="mb-5 flex flex-wrap items-end gap-8">
                <div>
                  <p className="eyebrow mb-1.5">You</p>
                  <CardRow cards={spot.hero} size="xl" />
                </div>
                <div>
                  <p className="eyebrow mb-1.5">Opponent</p>
                  <CardRow cards={spot.villain} size="xl" />
                </div>
                {spot.board.length > 0 && (
                  <div>
                    <p className="eyebrow mb-1.5">Board</p>
                    <CardRow cards={spot.board} size="lg" />
                  </div>
                )}
              </div>

              {!result && (
                <div className="flex flex-wrap items-center gap-3">
                  <label htmlFor="guess" className="text-[14px] text-[var(--color-ink-muted)]">
                    {spot.kind === 'outs' ? 'How many outs do you have?' : 'What percent of the time do you win?'}
                  </label>
                  <input
                    id="guess"
                    type="number"
                    value={guess}
                    onChange={(e) => setGuess(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && answerNumber()}
                    min={0}
                    max={spot.kind === 'outs' ? 25 : 100}
                    autoFocus
                    className="tnum w-24 rounded-xl border border-[var(--color-line-strong)] bg-[var(--color-surface)] px-3 py-2 text-[18px] outline-none focus:border-[var(--color-ink)]"
                  />
                  <Button tone="primary" size="lg" onClick={answerNumber} disabled={guess === ''}>
                    Check
                  </Button>
                </div>
              )}
            </>
          )}

          {reviewing && !result && (
            <p className="mb-4 rounded-lg bg-[var(--color-lav)]/25 px-3 py-2 text-[12px] leading-relaxed text-[var(--color-ink-muted)]">
              This is a spot you got wrong before, rebuilt exactly — same cards, same opponents, and the
              same read on what each of them was holding at the time.
            </p>
          )}

          {result && (
            <div className="rise mt-5 border-t border-[var(--color-line)] pt-4">
              <div className="flex flex-wrap items-center gap-2">
                {result.verdict && (
                  <Badge tone={VERDICT_TONE[result.verdict]}>
                    {result.correct ? 'Correct' : 'Not this time'}
                  </Badge>
                )}
                <span className="text-[15px] font-medium">{result.title}</span>
              </div>
              <p className="mt-2 text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
                <Annotated text={result.body} />
              </p>
              <Button tone="primary" size="lg" className="mt-4" onClick={next} autoFocus>
                Next hand <span className="ml-1 opacity-50">↵</span>
              </Button>
            </div>
          )}
        </Panel>
      )}
      {progress.hands > 0 && (
        <Panel className="mt-6">
          <PanelTitle
            right={
              <button
                onClick={() => {
                  if (confirm('Clear all saved hands, stats and mistakes? This cannot be undone.')) {
                    resetEverything();
                    setDrill('preflop');
                    loadSpot('preflop', tableSize);
                  }
                }}
                className="text-[11px] text-[var(--color-ink-faint)] underline-offset-2 hover:text-[var(--color-bad)] hover:underline"
              >
                Clear everything
              </button>
            }
          >
            All time
          </PanelTitle>
          <div className="flex flex-wrap gap-x-10 gap-y-4">
            <Stat label="Hands" value={progress.hands.toLocaleString()} size="sm" />
            {progress.bb100 !== null && (
              <Stat
                label="Win rate"
                value={`${progress.bb100 >= 0 ? '+' : ''}${progress.bb100.toFixed(0)}`}
                sub="bb / 100 hands"
                size="sm"
                tone={progress.bb100 >= 0 ? 'good' : 'bad'}
              />
            )}
            {progress.accuracy !== null && (
              <Stat
                label="Decisions right"
                value={`${progress.accuracy.toFixed(0)}%`}
                size="sm"
                tone={progress.accuracy >= 70 ? 'good' : 'default'}
              />
            )}
            <Stat label="EV given up" value={`${progress.evLostBB.toFixed(0)} bb`} size="sm" tone="warn" />
            {progress.vpip !== null && (
              <Stat
                label="VPIP / PFR"
                value={`${progress.vpip.toFixed(0)} / ${progress.pfr?.toFixed(0) ?? 0}`}
                sub="tight is 20 / 16"
                size="sm"
              />
            )}
            <Stat
              label="Saved spots"
              value={`${progress.due + progress.pending}`}
              sub={progress.learned > 0 ? `${progress.learned} learned` : 'none learned yet'}
              size="sm"
            />
          </div>
          <p className="mt-4 border-t border-[var(--color-line)] pt-3 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
            Kept in this browser only — no account, nothing sent anywhere. Clearing your browser data
            clears this too.
          </p>
        </Panel>
      )}
    </div>
  );
}
