'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PokerTable } from '@/components/Table';
import type { SeatView } from '@/components/Table';
import { TrainingPanel } from '@/components/TrainingPanel';
import type { XraySettings } from '@/lib/poker/settings';
import { Annotated } from '@/components/Term';
import Link from 'next/link';
import { Panel, PanelTitle, Button, Badge, Segmented } from '@/components/ui';
import { makeRng } from '@/lib/poker/cards';
import {
  newHand, applyAction, legalActions, toCall, netResult, livePlayers,
  positionName, } from '@/lib/poker/engine';
import type { HandState, Action } from '@/lib/poker/engine';
import { getPersona, botAction, tableLineup } from '@/lib/poker/bots';
import { newRangeBook, updateBookForAction, pruneBook } from '@/lib/poker/ranges';
import type { RangeBook } from '@/lib/poker/ranges';
import { gradeDecision, equityForDisplay } from '@/lib/poker/grade';
import type { DecisionGrade, Lineup, Verdict } from '@/lib/poker/grade';
import { findOuts, requiredEquity } from '@/lib/poker/equity';
import { captureSpot, describeSnapshot } from '@/lib/poker/spots';
import {
  useStore, useNow, recordDecision, recordHand, saveSpot, summarize, formatWhen, dismissIntro,
  saveSettings,
} from '@/lib/poker/storage';

const HERO = 0;
const START_STACK = 200;
const BIG_BLIND = 2;

interface Session {
  state: HandState;
  book: RangeBook;
  lineup: Lineup;
  button: number;
  feedback: DecisionGrade | null;
  /** Every decision graded this hand, so the hand can be reviewed once it ends. */
  decisions: DecisionGrade[];
  handNo: number;
  /** Did the hero put money in before the flop by choice, and did they raise? */
  heroVoluntary: boolean;
  heroRaised: boolean;
}

interface Stats {
  hands: number;
  net: number;
  decisions: number;
  best: number;
  mistakes: number;
  blunders: number;
  evLost: number;
  vpip: number;
  pfr: number;
}

const BLANK_STATS: Stats = {
  hands: 0, net: 0, decisions: 0, best: 0, mistakes: 0, blunders: 0, evLost: 0, vpip: 0, pfr: 0,
};

const VERDICT: Record<Verdict, { label: string; tone: 'good' | 'neutral' | 'warn' | 'bad'; bar: string }> = {
  best: { label: 'Best play', tone: 'good', bar: 'var(--color-good)' },
  fine: { label: 'Close enough', tone: 'neutral', bar: 'var(--color-ink-faint)' },
  mistake: { label: 'Mistake', tone: 'warn', bar: 'var(--color-warn)' },
  blunder: { label: 'Blunder', tone: 'bad', bar: 'var(--color-bad)' },
};

/**
 * State the decision in a sentence.
 *
 * The table shows everything a player needs and names none of it. Someone who
 * has never played reads "Pot 7", "BTN", "Call 4" and has to reverse-engineer
 * what they are being asked. One plain sentence - who bet, what it costs, how
 * many people are left - removes almost all of that, and because it is prose it
 * carries glossary tooltips on every term inside it.
 */
function describeSituation(state: HandState, heroSeat: number): string {
  const seat = positionName(state, heroSeat);
  const need = toCall(state, heroSeat);
  const live = livePlayers(state).length;
  const others = live - 1;
  const company =
    others === 1 ? 'One opponent is still in.' : `${others} opponents are still in.`;

  if (state.street === 0 && state.betToMatch <= state.bigBlind) {
    return need > 0
      ? `You're the ${seat}. Nobody has raised, so it costs ${need} to call the big blind and see a flop. ${company}`
      : `You're the ${seat}. Nobody raised, so you can check and see a flop for free. ${company}`;
  }

  // Find whoever last put money in on this street, so we can name them.
  let aggressor = '';
  let raisedTo = 0;
  for (let i = state.log.length - 1; i >= 0; i--) {
    const entry = state.log[i];
    if (entry.street !== state.street) break;
    if (entry.kind === 'action' && entry.seat !== undefined && / bets | raises to /.test(` ${entry.text} `)) {
      aggressor = positionName(state, entry.seat);
      raisedTo = state.committed[entry.seat];
      break;
    }
  }

  if (need > 0) {
    const who = aggressor ? `The ${aggressor}` : 'Someone';
    const verb = state.street === 0 ? 'raised to' : 'bet';
    return `You're the ${seat}. ${who} ${verb} ${raisedTo || need}, so it costs you ${need} to stay in. ${company}`;
  }
  return `You're the ${seat}. Nobody has bet, so checking is free. ${company}`;
}

/**
 * Let the bots act until it's the hero's turn again.
 *
 * Every time one of them acts we narrow that seat's range, using the state as
 * it was BEFORE the action - "how likely was this hand to bet here" only makes
 * sense from the position they were actually in when they decided.
 */
function advanceBots(
  state: HandState,
  book: RangeBook,
  lineup: Lineup,
  heroSeat: number,
  rng: () => number
): { state: HandState; book: RangeBook } {
  let s = state;
  let b = book;
  let guard = 0;
  while (!s.complete && s.toAct !== heroSeat && s.toAct >= 0 && guard++ < 80) {
    const seat = s.toAct;
    const persona = lineup[seat];
    if (!persona) break;
    const before = s;
    const action = botAction(s, persona, rng);
    b = updateBookForAction(b, before, persona, action, seat);
    s = applyAction(s, action);
  }
  // Newly revealed board cards are cards nobody can also be holding.
  return { state: s, book: pruneBook(b, [...s.hole[heroSeat], ...s.board]) };
}

function startHand(
  playerCount: number,
  button: number,
  handNo: number,
  rng: () => number
): Session {
  const ids = tableLineup(playerCount, HERO);
  const lineup: Lineup = ids.map((id) => (id === 'hero' ? null : getPersona(id)));
  const state = newHand({
    playerCount,
    startingStack: START_STACK,
    button: button % playerCount,
    bigBlind: BIG_BLIND,
    seed: Math.floor(rng() * 2 ** 31),
  });
  const book = newRangeBook(state, HERO);
  const advanced = advanceBots(state, book, lineup, HERO, rng);
  return { ...advanced, lineup, button: button % playerCount, feedback: null, decisions: [], handNo, heroVoluntary: false, heroRaised: false };
}

export default function PlayPage() {
  const [rng] = useState(() => makeRng(20260819));
  const [playerCount, setPlayerCount] = useState(6);
  const [session, setSession] = useState<Session>(() => startHand(6, 0, 1, makeRng(20260819)));
  const [stats, setStats] = useState<Stats>(BLANK_STATS);
  const [raiseTo, setRaiseTo] = useState<number | null>(null);
  /**
   * The hand before this one, kept so its verdicts don't vanish the moment you
   * deal again. Most hands only make sense once they're over, and clicking
   * "Next hand" used to throw away the explanation you were still reading.
   */
  const [lastHand, setLastHand] = useState<Session | null>(null);
  /**
   * All-in is one click away from your entire stack, and it sits next to three
   * ordinary bet sizes. It asks twice.
   */
  const [armedAllIn, setArmedAllIn] = useState(false);
  const store = useStore();
  const now = useNow();
  const lifetime = summarize(store, now);
  // Which overlays are on is remembered rather than reset every visit - having
  // to switch the training wheels back off on every reload would be its own
  // small punishment for making progress.
  const settings: XraySettings = store.settings;
  const setSettings = saveSettings;
  const [watching, setWatching] = useState(false);
  const [busy, setBusy] = useState(false);

  const state = session.state;
  const isHeroTurn = !state.complete && state.toAct === HERO && !watching;
  const legal = useMemo(() => legalActions(state), [state]);
  const raiseOpt = legal.find((a) => a.type === 'bet' || a.type === 'raise');
  const need = toCall(state, HERO);
  const potOdds = need > 0 ? requiredEquity(need, state.pot) : null;
  const heroFolded = state.folded[HERO];

  const deal = useCallback(
    (count: number, button: number, handNo: number) => {
      const next = startHand(count, button, handNo, rng);
      setSession((previous) => {
        if (previous.state.complete) setLastHand(previous);
        return next;
      });
      setRaiseTo(null);
      setArmedAllIn(false);
      // Everyone can fold round before the hero ever gets to speak. That's still
      // a hand played, and it still moves the blinds, so it has to count.
      if (next.state.complete) {
        recordHand({
          netChips: netResult(next.state)[HERO],
          bigBlind: BIG_BLIND,
          voluntary: false,
          raised: false,
        });
      }
    },
    [rng]
  );

  const changeTableSize = useCallback(
    (count: number) => {
      setPlayerCount(count);
      setStats(BLANK_STATS);
      deal(count, 0, 1);
    },
    [deal]
  );

  /* ---- Live readouts. Each is gated so we never pay for a calculation the
         player has chosen not to look at. ---- */
  const equity = useMemo(() => {
    if (state.complete || heroFolded || !settings.showEquity) return null;
    return equityForDisplay(state, HERO, session.book, settings.showOpponentCards);
  }, [state, heroFolded, settings.showEquity, settings.showOpponentCards, session.book]);

  const outs = useMemo(() => {
    if (state.complete || !settings.showOuts || !settings.showOpponentCards) return null;
    if (state.board.length < 3 || state.board.length >= 5) return null;
    const opponents = livePlayers(state).filter((s) => s !== HERO);
    if (opponents.length !== 1) return null; // "outs" only means something against one hand
    return findOuts(state.hole[HERO], state.hole[opponents[0]], state.board).length;
  }, [state, settings.showOuts, settings.showOpponentCards]);

  const preview = useMemo(() => {
    if (!isHeroTurn || !settings.showEV) return null;
    return gradeDecision(state, HERO, session.lineup, session.book, null, { trials: 400 });
  }, [isHeroTurn, settings.showEV, state, session.lineup, session.book]);

  const act = useCallback(
    (action: Action) => {
      if (!isHeroTurn || busy) return;
      setBusy(true);
      // Grade before applying - once the action lands, the situation is gone.
      const graded = gradeDecision(state, HERO, session.lineup, session.book, action, { trials: 600 });

      const applied = applyAction(state, action);
      const advanced = advanceBots(applied, session.book, session.lineup, HERO, rng);

      const voluntary =
        session.heroVoluntary ||
        (state.street === 0 && action.type !== 'fold' && action.type !== 'check');
      const raised =
        session.heroRaised ||
        (state.street === 0 && (action.type === 'raise' || action.type === 'bet'));

      if (graded) {
        setStats((s) => ({
          ...s,
          decisions: s.decisions + 1,
          best: s.best + (graded.verdict === 'best' ? 1 : 0),
          mistakes: s.mistakes + (graded.verdict === 'mistake' ? 1 : 0),
          blunders: s.blunders + (graded.verdict === 'blunder' ? 1 : 0),
          evLost: s.evLost + Math.max(0, graded.evLostVsRange),
          vpip: s.vpip + (voluntary && !session.heroVoluntary ? 1 : 0),
          pfr: s.pfr + (raised && !session.heroRaised ? 1 : 0),
        }));
        recordDecision({
          verdict: graded.verdict,
          evLostBB: graded.evLostVsRange,
          preflopVoluntary: voluntary,
          preflopRaise: raised,
        });
        // Anything worse than "close enough" gets kept so it can be replayed.
        // We capture the situation BEFORE the action, which is the spot you
        // actually have to solve when it comes back around.
        if (graded.verdict === 'mistake' || graded.verdict === 'blunder') {
          saveSpot({
            verdict: graded.verdict,
            lostBB: graded.evLostVsRange,
            headline: graded.headline,
            snapshot: captureSpot(state, HERO, session.lineup, session.book, action),
          });
        }
      }
      if (advanced.state.complete) {
        setStats((s) => ({ ...s, hands: s.hands + 1, net: s.net + netResult(advanced.state)[HERO] }));
        recordHand({
          netChips: netResult(advanced.state)[HERO],
          bigBlind: BIG_BLIND,
          voluntary,
          raised,
        });
      }
      setSession({
        ...session,
        ...advanced,
        feedback: graded,
        decisions: graded ? [...session.decisions, graded] : session.decisions,
        heroVoluntary: voluntary,
        heroRaised: raised,
      });
      setRaiseTo(null);
      setArmedAllIn(false);
      setBusy(false);
    },
    [isHeroTurn, busy, state, session, rng]
  );

  /** One action at a time, for watching the bots play each other. */
  const step = useCallback(() => {
    if (state.complete || state.toAct < 0) return;
    const seat = state.toAct;
    const persona = session.lineup[seat] ?? getPersona('tag');
    const before = state;
    const action = botAction(state, persona, rng);
    let book = session.book;
    if (session.lineup[seat]) book = updateBookForAction(book, before, persona, action, seat);
    const next = applyAction(state, action);
    book = pruneBook(book, [...next.hole[HERO], ...next.board]);
    if (next.complete) setStats((s) => ({ ...s, hands: s.hands + 1 }));
    setSession({ ...session, state: next, book });
  }, [state, session, rng]);

  const nextHand = useCallback(() => {
    deal(playerCount, (session.button + 1) % playerCount, session.handNo + 1);
  }, [deal, playerCount, session.button, session.handNo]);

  /* ---- Keyboard. Anyone playing a few hundred hands will want their hands to
         stay on the keys rather than hunting for buttons. ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

      if (state.complete && (e.key === 'Enter' || e.key === ' ')) {
        e.preventDefault();
        nextHand();
        return;
      }
      if (!isHeroTurn) return;
      const key = e.key.toLowerCase();
      if (key === 'f') {
        const fold = legal.find((a) => a.type === 'fold');
        if (fold) { e.preventDefault(); act({ type: 'fold' }); }
      } else if (key === 'c') {
        const cont = legal.find((a) => a.type === 'check' || a.type === 'call');
        if (cont) { e.preventDefault(); act({ type: cont.type, amount: cont.amount }); }
      } else if (key === 'r' && raiseOpt) {
        e.preventDefault();
        act({ type: raiseOpt.type, amount: Math.round(state.betToMatch + state.pot * 0.75) });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state, isHeroTurn, legal, raiseOpt, act, nextHand]);

  const seats: SeatView[] = useMemo(
    () =>
      Array.from({ length: state.playerCount }, (_, seat) => ({
        seat,
        name: seat === HERO ? 'You' : session.lineup[seat]?.name ?? 'Player',
        label: seat === HERO ? 'You' : session.lineup[seat]?.tag ?? 'Player',
        blurb: seat === HERO ? undefined : session.lineup[seat]?.blurb,
        counter: seat === HERO ? undefined : session.lineup[seat]?.counter,
        isHero: seat === HERO,
        showCards: seat === HERO || settings.showOpponentCards || watching,
      })),
    [state.playerCount, session.lineup, settings.showOpponentCards, watching]
  );

  const sizings = raiseOpt
    ? [
        { label: '½', amount: Math.round(state.betToMatch + state.pot * 0.5) },
        { label: '¾', amount: Math.round(state.betToMatch + state.pot * 0.75) },
        { label: 'Pot', amount: Math.round(state.betToMatch + state.pot) },
        { label: 'All in', amount: raiseOpt.max! },
      ]
        .map((p) => ({ ...p, amount: Math.max(raiseOpt.min!, Math.min(raiseOpt.max!, p.amount)) }))
        .filter((p, i, arr) => arr.findIndex((q) => q.amount === p.amount) === i)
    : [];

  const bb100 = stats.hands > 0 ? (stats.net / BIG_BLIND / stats.hands) * 100 : null;
  const accuracy = stats.decisions > 0 ? (stats.best / stats.decisions) * 100 : null;
  const net = netResult(state)[HERO];

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-4">
      {/* ---- Session bar ---- */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <Panel className="min-w-0 lg:flex-1" pad={false}>
          <div className="flex flex-wrap items-center gap-x-7 gap-y-2 px-4 py-2.5">
            <span className="text-[13px] text-[var(--color-ink-faint)]">
              Hand <b className="tnum text-[var(--color-ink)]">{session.handNo}</b>
            </span>
            <span className="text-[13px] text-[var(--color-ink-faint)]">
              Net{' '}
              <b className={`tnum ${stats.net >= 0 ? 'text-[var(--color-good)]' : 'text-[var(--color-bad)]'}`}>
                {stats.net >= 0 ? '+' : ''}{(stats.net / BIG_BLIND).toFixed(1)} bb
              </b>
            </span>
            {bb100 !== null && (
              <span
                className="text-[13px] text-[var(--color-ink-faint)]"
                title="Big blinds won per 100 hands. A strong live player makes 5-10. Over a short session this swings wildly."
              >
                Rate{' '}
                <b className={`tnum ${bb100 >= 0 ? 'text-[var(--color-good)]' : 'text-[var(--color-bad)]'}`}>
                  {bb100 >= 0 ? '+' : ''}{bb100.toFixed(0)} bb/100
                </b>
                {stats.hands < 30 && (
                  <span className="text-[var(--color-ink-faint)]"> · too few hands to mean much</span>
                )}
              </span>
            )}
            {accuracy !== null && (
              <span
                className="text-[13px] text-[var(--color-ink-faint)]"
                title="Share of your decisions that were the best available option. Above 70% is solid."
              >
                Best play <b className="tnum text-[var(--color-ink)]">{accuracy.toFixed(0)}%</b>
                <span className="text-[var(--color-ink-faint)]"> of 70%+</span>
              </span>
            )}
            {stats.decisions > 0 && (
              <span className="text-[13px] text-[var(--color-ink-faint)]">
                Given up <b className="tnum text-[var(--color-warn)]">{stats.evLost.toFixed(1)} bb</b>
              </span>
            )}
            {stats.hands > 2 && (
              <span className="text-[13px] text-[var(--color-ink-faint)]">
                VPIP <b className="tnum text-[var(--color-ink)]">{((stats.vpip / stats.hands) * 100).toFixed(0)}%</b>
                {' / '}
                PFR <b className="tnum text-[var(--color-ink)]">{((stats.pfr / stats.hands) * 100).toFixed(0)}%</b>
              </span>
            )}

            {lifetime.hands > stats.hands && (
              <span className="ml-auto border-l border-[var(--color-line)] pl-5 text-[13px] text-[var(--color-ink-faint)]">
                All time{' '}
                <b className="tnum text-[var(--color-ink)]">{lifetime.hands.toLocaleString()}</b> hands
                {lifetime.bb100 !== null && (
                  <>
                    {', '}
                    <b className={`tnum ${lifetime.bb100 >= 0 ? 'text-[var(--color-good)]' : 'text-[var(--color-bad)]'}`}>
                      {lifetime.bb100 >= 0 ? '+' : ''}{lifetime.bb100.toFixed(0)} bb/100
                    </b>
                  </>
                )}
              </span>
            )}
          </div>
        </Panel>

        <div className="flex shrink-0 items-center gap-2">
          <Segmented
            size="sm"
            options={[
              { value: 2, label: 'HU' },
              { value: 3, label: '3' },
              { value: 6, label: '6-max' },
              { value: 9, label: '9' },
            ]}
            value={playerCount}
            onChange={changeTableSize}
          />
          <Button
            tone={watching ? 'primary' : 'quiet'}
            size="sm"
            onClick={() => { setWatching((w) => !w); setRaiseTo(null); setArmedAllIn(false); }}
            title="Sit out and watch the bots play a hand against each other, all cards face up. The easiest way to see how a hand actually unfolds."
          >
            {watching ? 'Watching — click to play' : 'Watch a hand'}
          </Button>
        </div>
      </div>

      {!store.introSeen && (
        <div className="rise mb-4">
          <Panel>
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 max-w-2xl">
                <h2 className="display text-[24px]">New to this? Three things.</h2>
                <ol className="mt-2.5 space-y-1.5 text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
                  <li>
                    <b className="text-[var(--color-ink)]">You&apos;re at the bottom of the table.</b> Everyone
                    else is a bot, and each one plays a different way — the Nit folds almost everything, the
                    Station calls almost everything. Working out who you&apos;re against is most of the game.
                  </li>
                  <li>
                    <b className="text-[var(--color-ink)]">Nothing here costs anything.</b> Play the hands you
                    would never risk money on. That&apos;s what this is for.
                  </li>
                  <li>
                    <b className="text-[var(--color-ink)]">Every move is scored afterwards</b>, with the reason
                    why. If a word is underlined, hover it for a plain-English definition.
                  </li>
                </ol>
                <p className="mt-2.5 text-[13px] text-[var(--color-ink-faint)]">
                  The panel on the right is showing you everything at once on purpose. Switch pieces off as they
                  start to feel obvious.
                </p>
              </div>
              <Button tone="primary" onClick={dismissIntro}>
                Got it
              </Button>
            </div>
          </Panel>
        </div>
      )}

      <div className="flex flex-col gap-4 lg:flex-row">
        <div className="min-w-0 flex-1">
          <PokerTable
            state={state}
            heroSeat={HERO}
            seats={seats}
            showdown={state.complete}
            bigBlind={BIG_BLIND}
          />

          {/* ---- Actions ---- */}
          <div className="mt-4">
            {state.complete ? (
              <Panel>
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div
                      className={`display text-[26px] ${
                        net > 0 ? 'text-[var(--color-good)]' : net < 0 ? 'text-[var(--color-bad)]' : ''
                      }`}
                    >
                      {net > 0 ? 'You win ' : net < 0 ? 'You lose ' : 'You break even'}
                      {net !== 0 && <span className="tnum">{Math.abs(net / BIG_BLIND).toFixed(1)} bb</span>}
                    </div>
                    <div className="mt-0.5 text-[13px] text-[var(--color-ink-muted)]">
                      {state.result?.showdown && state.result.handDescriptions[HERO] ? (
                        <Annotated text={`You showed ${state.result.handDescriptions[HERO]}`} />
                      ) : (
                        'No showdown'
                      )}
                    </div>
                  </div>
                  <Button tone="primary" size="lg" onClick={nextHand} autoFocus>
                    Next hand <span className="ml-1 opacity-50">↵</span>
                  </Button>
                </div>
              </Panel>
            ) : watching ? (
              <div className="flex items-center gap-3">
                <Button tone="accent" size="lg" onClick={step}>Step forward</Button>
                <span className="text-[13px] text-[var(--color-ink-muted)]">
                  Watching the bots play. All cards face up — good for seeing how a style actually behaves.
                </span>
              </div>
            ) : isHeroTurn ? (
              <Panel>
                <p className="mb-3 border-b border-[var(--color-line)] pb-3 text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
                  <Annotated text={describeSituation(state, HERO)} />
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  {legal.find((a) => a.type === 'fold') && (
                    <Button tone="quiet" size="lg" onClick={() => act({ type: 'fold' })}>
                      Fold <span className="ml-1 opacity-40">F</span>
                    </Button>
                  )}
                  {legal.filter((a) => a.type === 'check' || a.type === 'call').map((a) => (
                    <Button key={a.type} tone="primary" size="lg" onClick={() => act({ type: a.type, amount: a.amount })}>
                      {a.label} <span className="ml-1 opacity-40">C</span>
                    </Button>
                  ))}
                  {sizings.length > 0 && <span className="mx-1 h-6 w-px bg-[var(--color-line)]" />}
                  {sizings.map((p) => {
                    const isShove = p.label === 'All in';
                    if (isShove) {
                      return (
                        <Button
                          key={p.label}
                          tone={armedAllIn ? 'danger' : 'accent'}
                          size="lg"
                          onClick={() => {
                            if (armedAllIn) act({ type: raiseOpt!.type, amount: p.amount });
                            else setArmedAllIn(true);
                          }}
                          onBlur={() => setArmedAllIn(false)}
                          title={`Move all ${p.amount} in`}
                        >
                          {armedAllIn ? `Confirm all in (${p.amount})` : 'All in'}
                        </Button>
                      );
                    }
                    return (
                      <Button
                        key={p.label}
                        tone="accent"
                        size="lg"
                        onClick={() => act({ type: raiseOpt!.type, amount: p.amount })}
                        title={`${raiseOpt!.type === 'bet' ? 'Bet' : 'Raise to'} ${p.amount}`}
                      >
                        {p.label}
                      </Button>
                    );
                  })}
                </div>

                {raiseOpt && raiseOpt.max! > raiseOpt.min! && (
                  <div className="mt-3 flex items-center gap-3 border-t border-[var(--color-line)] pt-3">
                    <span className="text-[11px] text-[var(--color-ink-faint)]">Custom</span>
                    <input
                      type="range"
                      min={raiseOpt.min}
                      max={raiseOpt.max}
                      value={raiseTo ?? raiseOpt.min!}
                      onChange={(e) => setRaiseTo(Number(e.target.value))}
                      className="flex-1"
                      aria-label="Bet size"
                    />
                    <span className="tnum w-12 text-right text-[13px]">{raiseTo ?? raiseOpt.min}</span>
                    <Button
                      tone="accent"
                      size="sm"
                      onClick={() => act({ type: raiseOpt.type, amount: raiseTo ?? raiseOpt.min! })}
                    >
                      {raiseOpt.type === 'bet' ? 'Bet' : 'Raise'}
                    </Button>
                  </div>
                )}
              </Panel>
            ) : (
              <Panel>
                <p className="text-[13px] text-[var(--color-ink-muted)]">
                  {heroFolded ? 'You folded — watching the rest play out.' : 'Waiting for the other players…'}
                </p>
              </Panel>
            )}
          </div>

          {/* ---- Feedback on the last decision ---- */}
          {session.feedback && (
            <div className="rise mt-4">
              <Panel>
                <div
                  className="absolute inset-y-0 left-0 w-[3px]"
                  style={{ background: VERDICT[session.feedback.verdict].bar }}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={VERDICT[session.feedback.verdict].tone}>
                    {VERDICT[session.feedback.verdict].label}
                  </Badge>
                  <span className="text-[15px] font-medium">{session.feedback.headline}</span>
                </div>
                <p className="mt-2 text-[14px] leading-relaxed text-[var(--color-ink-muted)]">
                  <Annotated text={session.feedback.detail} />
                </p>
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-[var(--color-line)] pt-2.5 text-[12px] text-[var(--color-ink-faint)]">
                  <span>
                    Best against their ranges{' '}
                    <b className="tnum text-[var(--color-ink)]">
                      {(session.feedback.heroEquityVsRange * 100).toFixed(0)}%
                    </b>
                  </span>
                  <span>
                    Against the hands they had{' '}
                    <b className="tnum text-[var(--color-ink)]">
                      {(session.feedback.heroEquityVsHand * 100).toFixed(0)}%
                    </b>
                  </span>
                  {session.feedback.foldsOut !== null && (
                    <span>
                      Everyone folds{' '}
                      <b className="tnum text-[var(--color-ink)]">
                        {(session.feedback.foldsOut * 100).toFixed(0)}%
                      </b>
                    </span>
                  )}
                </div>
              </Panel>
            </div>
          )}

          {/* ---- Hand history ---- */}
          <div className="mt-4">
            <Panel>
              <PanelTitle
                right={
                  <span className="text-[11px] text-[var(--color-ink-faint)]">
                    You are {positionName(state, HERO)}
                  </span>
                }
              >
                This hand
              </PanelTitle>
              <ol className="space-y-0.5 text-[12px] text-[var(--color-ink-muted)]">
                {state.log.map((entry, i) => (
                  <li
                    key={i}
                    className={
                      entry.kind === 'result'
                        ? 'font-medium text-[var(--color-good)]'
                        : entry.seat === HERO
                          ? 'text-[var(--color-ink)]'
                          : ''
                    }
                  >
                    {entry.text}
                    {entry.seat === HERO && <span className="ml-1 text-[var(--color-ink-faint)]">(you)</span>}
                  </li>
                ))}
              </ol>
            </Panel>
          </div>

          {/* ---- The hand before this one ---- */}
          {lastHand && lastHand.state.result && (
            <div className="mt-4">
              <Panel pad={false}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3 text-[13px]">
                    <span className="eyebrow">Hand {lastHand.handNo}</span>
                    <span
                      className={`tnum font-medium ${
                        netResult(lastHand.state)[HERO] > 0
                          ? 'text-[var(--color-good)]'
                          : netResult(lastHand.state)[HERO] < 0
                            ? 'text-[var(--color-bad)]'
                            : 'text-[var(--color-ink-muted)]'
                      }`}
                    >
                      {netResult(lastHand.state)[HERO] > 0 ? '+' : ''}
                      {(netResult(lastHand.state)[HERO] / BIG_BLIND).toFixed(1)} bb
                    </span>
                    {lastHand.decisions.length > 0 && (
                      <span className="flex gap-1">
                        {lastHand.decisions.map((d, i) => (
                          <span
                            key={i}
                            title={d.headline}
                            className="h-2 w-2 rounded-full"
                            style={{ background: VERDICT[d.verdict].bar }}
                          />
                        ))}
                      </span>
                    )}
                    <span className="ml-auto text-[11px] text-[var(--color-ink-faint)] group-open:hidden">
                      look again
                    </span>
                  </summary>
                  <div className="border-t border-[var(--color-line)] px-5 py-3">
                    <ol className="space-y-0.5 text-[12px] text-[var(--color-ink-muted)]">
                      {lastHand.state.log.map((entry, i) => (
                        <li
                          key={i}
                          className={
                            entry.kind === 'result'
                              ? 'font-medium text-[var(--color-good)]'
                              : entry.seat === HERO
                                ? 'text-[var(--color-ink)]'
                                : ''
                          }
                        >
                          {entry.text}
                          {entry.seat === HERO && (
                            <span className="ml-1 text-[var(--color-ink-faint)]">(you)</span>
                          )}
                        </li>
                      ))}
                    </ol>
                    {lastHand.decisions.map((d, i) => (
                      <div key={i} className="mt-3 border-t border-[var(--color-line)] pt-2.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={VERDICT[d.verdict].tone}>{VERDICT[d.verdict].label}</Badge>
                          <span className="text-[13px] font-medium">{d.headline}</span>
                        </div>
                        <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--color-ink-muted)]">
                          <Annotated text={d.detail} />
                        </p>
                      </div>
                    ))}
                  </div>
                </details>
              </Panel>
            </div>
          )}

          {/* ---- Saved mistakes ---- */}
          {store.spots.length > 0 && (
            <div className="mt-4">
              <Panel>
                <PanelTitle
                  right={
                    lifetime.due > 0 ? (
                      <Link
                        href="/drills"
                        className="rounded-full bg-[var(--color-lav)] px-3 py-1 text-[11px] font-medium text-[var(--color-lav-ink)] transition hover:bg-[var(--color-lav-deep)] hover:text-white"
                      >
                        {lifetime.due} ready to replay →
                      </Link>
                    ) : lifetime.nextDueIn !== null ? (
                      <span className="text-[11px] text-[var(--color-ink-faint)]">
                        next replay in {formatWhen(lifetime.nextDueIn)}
                      </span>
                    ) : undefined
                  }
                >
                  Spots worth revisiting
                </PanelTitle>
                <div className="space-y-1.5">
                  {store.spots.slice(0, 6).map((item) => {
                    const about = describeSnapshot(item.snapshot);
                    const dueIn = item.dueAt - now;
                    return (
                      <div
                        key={item.id}
                        className="flex flex-wrap items-center gap-2.5 rounded-xl border border-[var(--color-line)] px-3 py-2 text-[13px]"
                      >
                        <Badge tone={VERDICT[item.verdict].tone}>{VERDICT[item.verdict].label}</Badge>
                        <span className="font-medium">{about.hand}</span>
                        <span className="text-[var(--color-ink-faint)]">
                          {about.street} · {about.seats}-handed
                        </span>
                        <span className="tnum ml-auto text-[var(--color-warn)]">
                          −{item.lostBB.toFixed(2)} bb
                        </span>
                        <span className="tnum w-16 shrink-0 text-right text-[11px] text-[var(--color-ink-faint)]">
                          {item.retired ? 'learned' : dueIn <= 0 ? 'ready' : `in ${formatWhen(dueIn)}`}
                        </span>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-2.5 text-[11px] leading-relaxed text-[var(--color-ink-faint)]">
                  Every mistake is saved and comes back as a drill later — sooner if you get it wrong
                  again, further out each time you get it right. Kept in this browser only.
                </p>
              </Panel>
            </div>
          )}
        </div>

        <TrainingPanel
          state={state}
          heroSeat={HERO}
          settings={settings}
          onSettings={setSettings}
          equity={equity}
          grade={preview ?? session.feedback}
          potOdds={potOdds}
          book={session.book}
          lineup={session.lineup}
          bigBlind={BIG_BLIND}
          outs={outs}
          cardsToCome={state.board.length === 3 ? 2 : 1}
        />
      </div>
    </div>
  );
}
