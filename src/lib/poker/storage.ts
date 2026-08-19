/**
 * storage.ts - the app's memory.
 *
 * Until now the trainer forgot everything the moment you reloaded: your hands,
 * your win rate, and the list of spots you got wrong. That undercut the whole
 * premise, because improving at anything happens between sessions, not inside
 * one.
 *
 * Everything lives in the browser's localStorage. No account, no server, no
 * data leaving the machine - which also means there is nothing here to leak.
 *
 * WHY useSyncExternalStore RATHER THAN useState + useEffect
 *
 * localStorage is an external system that React doesn't control, and it can
 * change from another tab. The obvious approach - read it in an effect and copy
 * it into state - has two real problems: it renders once with the wrong data
 * before correcting itself, and it silently ignores changes made elsewhere.
 * useSyncExternalStore is built for exactly this: it takes a subscribe function
 * and a snapshot getter, and has a separate path for server rendering where
 * localStorage doesn't exist at all.
 *
 * The one rule it imposes is that getSnapshot must return the SAME object
 * reference unless the data actually changed, or React re-renders forever. So
 * we keep a cached object and only ever replace it inside a mutation.
 */

import { useSyncExternalStore } from 'react';
import type { Verdict } from './grade';
import type { SpotSnapshot } from './spots';

const KEY = 'pocket-odds/v1';
const MAX_SPOTS = 300;

export interface LifetimeStats {
  hands: number;
  netChips: number;
  bigBlind: number;
  decisions: number;
  best: number;
  fine: number;
  mistakes: number;
  blunders: number;
  evLostBB: number;
  /** Hands where money went in voluntarily before the flop, and hands raised. */
  vpipHands: number;
  pfrHands: number;
  firstPlayedAt: number;
  lastPlayedAt: number;
}

export interface SavedSpot {
  id: string;
  createdAt: number;
  /** Which review interval this is on. Higher means you know it better. */
  box: number;
  dueAt: number;
  seen: number;
  right: number;
  retired: boolean;
  verdict: Verdict;
  lostBB: number;
  headline: string;
  snapshot: SpotSnapshot;
}

export interface Store {
  version: 1;
  lifetime: LifetimeStats;
  spots: SavedSpot[];
  /** Has the short orientation note been dismissed? */
  introSeen: boolean;
}

const EMPTY_LIFETIME: LifetimeStats = {
  hands: 0, netChips: 0, bigBlind: 2, decisions: 0,
  best: 0, fine: 0, mistakes: 0, blunders: 0, evLostBB: 0,
  vpipHands: 0, pfrHands: 0, firstPlayedAt: 0, lastPlayedAt: 0,
};

/**
 * The value used while server-rendering, where there is no localStorage.
 *
 * introSeen is true here on purpose. During hydration React renders with this
 * snapshot before switching to the real one, so a returning visitor would
 * otherwise see the orientation note flash up and vanish. Better to withhold it
 * for a frame and then show it than to show it and snatch it away.
 */
const SERVER_STORE: Store = { version: 1, lifetime: EMPTY_LIFETIME, spots: [], introSeen: true };

function freshStore(): Store {
  return { version: 1, lifetime: { ...EMPTY_LIFETIME }, spots: [], introSeen: false };
}

/* ------------------------------------------------------------------ *
 * Spaced repetition
 *
 * Getting a spot right pushes the next showing further away; getting it wrong
 * brings it back almost immediately. The gaps start at minutes rather than days
 * because this is something you use in bursts - a spot you fluffed ten minutes
 * ago is worth seeing again before you close the tab.
 * ------------------------------------------------------------------ */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
export const REVIEW_INTERVALS = [5 * MINUTE, HOUR, DAY, 3 * DAY, 10 * DAY];

/** How the next due date is chosen after an answer. */
export function schedule(spot: SavedSpot, correct: boolean, now: number): SavedSpot {
  const box = correct ? spot.box + 1 : Math.max(0, spot.box - 1);
  const retired = correct && box >= REVIEW_INTERVALS.length;
  const interval = REVIEW_INTERVALS[Math.min(box, REVIEW_INTERVALS.length - 1)];
  return {
    ...spot,
    box,
    retired,
    seen: spot.seen + 1,
    right: spot.right + (correct ? 1 : 0),
    dueAt: retired ? Number.MAX_SAFE_INTEGER : now + interval,
  };
}

export function dueSpots(store: Store, now = Date.now()): SavedSpot[] {
  return store.spots
    .filter((s) => !s.retired && s.dueAt <= now)
    .sort((a, b) => a.dueAt - b.dueAt);
}

/** Spots that exist but aren't due yet - useful for "3 waiting, next in 2h". */
export function pendingSpots(store: Store, now = Date.now()): SavedSpot[] {
  return store.spots.filter((s) => !s.retired && s.dueAt > now).sort((a, b) => a.dueAt - b.dueAt);
}

export function formatWhen(ms: number): string {
  if (ms <= 0) return 'now';
  if (ms < HOUR) return `${Math.max(1, Math.round(ms / MINUTE))}m`;
  if (ms < DAY) return `${Math.round(ms / HOUR)}h`;
  return `${Math.round(ms / DAY)}d`;
}

/* ------------------------------------------------------------------ *
 * The store itself
 * ------------------------------------------------------------------ */

let cache: Store | null = null;
const listeners = new Set<() => void>();

function hasStorage(): boolean {
  try {
    return typeof window !== 'undefined' && !!window.localStorage;
  } catch {
    return false;
  }
}

function load(): Store {
  if (!hasStorage()) return SERVER_STORE;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return freshStore();
    const parsed = JSON.parse(raw) as Store;
    if (parsed?.version !== 1) return freshStore();
    return {
      version: 1,
      lifetime: { ...EMPTY_LIFETIME, ...parsed.lifetime },
      spots: Array.isArray(parsed.spots) ? parsed.spots : [],
      introSeen: parsed.introSeen === true,
    };
  } catch {
    // Corrupt or unreadable data shouldn't take the app down with it.
    return freshStore();
  }
}

function persist(next: Store): void {
  cache = next;
  if (hasStorage()) {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // Storage full or blocked (private browsing). The session keeps working
      // from the in-memory cache; it just won't survive a reload.
    }
  }
  for (const listener of listeners) listener();
}

function getSnapshot(): Store {
  if (cache === null) cache = load();
  return cache;
}

function getServerSnapshot(): Store {
  return SERVER_STORE;
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  // Another tab writing to the same key should update this one too.
  const onStorage = (e: StorageEvent) => {
    if (e.key !== KEY) return;
    cache = load();
    for (const l of listeners) l();
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(callback);
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorage);
  };
}

/** Read the saved data, re-rendering when it changes anywhere. */
export function useStore(): Store {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

export function readStore(): Store {
  return getSnapshot();
}

/**
 * The current time, as something React is allowed to read during a render.
 *
 * Calling Date.now() inside a component is impure - the same render would give
 * different answers - and it also means "ready in 2h" never updates until
 * something else happens to re-render. Treating the clock as an external store
 * fixes both: the value is stable between ticks, and every countdown on the
 * page refreshes on its own.
 *
 * Bucketing to the interval is what makes the snapshot stable. Without it React
 * would see a new value on every single read and re-render forever.
 */
export function useNow(intervalMs = 30_000): number {
  return useSyncExternalStore(
    (callback) => {
      const timer = setInterval(callback, intervalMs);
      return () => clearInterval(timer);
    },
    () => Math.floor(Date.now() / intervalMs) * intervalMs,
    // On the server there is no clock worth reading and no saved data anyway,
    // so nothing should look due.
    () => 0
  );
}

/* ------------------------------------------------------------------ *
 * Mutations
 * ------------------------------------------------------------------ */

export function recordDecision(opts: {
  verdict: Verdict;
  evLostBB: number;
  preflopVoluntary: boolean;
  preflopRaise: boolean;
}): void {
  const store = getSnapshot();
  const l = store.lifetime;
  persist({
    ...store,
    lifetime: {
      ...l,
      decisions: l.decisions + 1,
      best: l.best + (opts.verdict === 'best' ? 1 : 0),
      fine: l.fine + (opts.verdict === 'fine' ? 1 : 0),
      mistakes: l.mistakes + (opts.verdict === 'mistake' ? 1 : 0),
      blunders: l.blunders + (opts.verdict === 'blunder' ? 1 : 0),
      evLostBB: l.evLostBB + Math.max(0, opts.evLostBB),
      firstPlayedAt: l.firstPlayedAt || Date.now(),
      lastPlayedAt: Date.now(),
    },
  });
}

export function recordHand(opts: {
  netChips: number;
  bigBlind: number;
  voluntary: boolean;
  raised: boolean;
}): void {
  const store = getSnapshot();
  const l = store.lifetime;
  persist({
    ...store,
    lifetime: {
      ...l,
      hands: l.hands + 1,
      netChips: l.netChips + opts.netChips,
      bigBlind: opts.bigBlind,
      vpipHands: l.vpipHands + (opts.voluntary ? 1 : 0),
      pfrHands: l.pfrHands + (opts.raised ? 1 : 0),
      firstPlayedAt: l.firstPlayedAt || Date.now(),
      lastPlayedAt: Date.now(),
    },
  });
}

export function saveSpot(spot: Omit<SavedSpot, 'id' | 'createdAt' | 'box' | 'dueAt' | 'seen' | 'right' | 'retired'>): void {
  const store = getSnapshot();
  const now = Date.now();
  const entry: SavedSpot = {
    ...spot,
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: now,
    box: 0,
    dueAt: now + REVIEW_INTERVALS[0],
    seen: 0,
    right: 0,
    retired: false,
  };

  // Keep the list bounded. Retired spots go first since they've been learned,
  // then the oldest.
  let spots = [entry, ...store.spots];
  if (spots.length > MAX_SPOTS) {
    const active = spots.filter((s) => !s.retired);
    const done = spots.filter((s) => s.retired);
    spots = [...active, ...done].slice(0, MAX_SPOTS);
  }
  persist({ ...store, spots });
}

export function reviewSpot(id: string, correct: boolean): void {
  const store = getSnapshot();
  const now = Date.now();
  persist({
    ...store,
    spots: store.spots.map((s) => (s.id === id ? schedule(s, correct, now) : s)),
  });
}

export function forgetSpot(id: string): void {
  const store = getSnapshot();
  persist({ ...store, spots: store.spots.filter((s) => s.id !== id) });
}

export function dismissIntro(): void {
  persist({ ...getSnapshot(), introSeen: true });
}

export function resetEverything(): void {
  // Clearing your history shouldn't replay the introduction at you.
  persist({ ...freshStore(), introSeen: true });
}

/* ------------------------------------------------------------------ *
 * Derived numbers for display
 * ------------------------------------------------------------------ */

export interface Summary {
  hands: number;
  netBB: number;
  bb100: number | null;
  accuracy: number | null;
  evLostBB: number;
  vpip: number | null;
  pfr: number | null;
  due: number;
  pending: number;
  learned: number;
  nextDueIn: number | null;
}

export function summarize(store: Store, now = Date.now()): Summary {
  const l = store.lifetime;
  const due = dueSpots(store, now);
  const pending = pendingSpots(store, now);
  return {
    hands: l.hands,
    netBB: l.netChips / (l.bigBlind || 2),
    bb100: l.hands > 0 ? (l.netChips / (l.bigBlind || 2) / l.hands) * 100 : null,
    accuracy: l.decisions > 0 ? ((l.best + l.fine) / l.decisions) * 100 : null,
    evLostBB: l.evLostBB,
    vpip: l.hands > 0 ? (l.vpipHands / l.hands) * 100 : null,
    pfr: l.hands > 0 ? (l.pfrHands / l.hands) * 100 : null,
    due: due.length,
    pending: pending.length,
    learned: store.spots.filter((s) => s.retired).length,
    nextDueIn: pending.length > 0 ? pending[0].dueAt - now : null,
  };
}
