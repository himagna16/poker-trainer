/**
 * testing.ts - helpers for building specific situations in tests.
 *
 * The state builder itself lives in spots.ts, because the app needs the same
 * thing to replay your saved mistakes. Sharing it means a spot rebuilt for a
 * test and a spot rebuilt from storage are assembled by identical code, so the
 * tests are actually exercising the production path.
 */

import type { HandState } from './engine';
import { buildState } from './spots';
import type { StateSpec } from './spots';
import { getPersona } from './bots';
import type { Lineup } from './grade';
import { topPercentRange, removeBlocked } from './ranges';
import type { RangeBook } from './ranges';

export interface SpotSpec extends Omit<StateSpec, 'playerCount'> {
  playerCount: number;
  heroSeat?: number;
}

export function buildSpot(spec: SpotSpec): HandState {
  return buildState(spec);
}

/** Everyone except the hero plays the given style. */
export function uniformLineup(playerCount: number, heroSeat: number, personaId: string): Lineup {
  return Array.from({ length: playerCount }, (_, seat) =>
    seat === heroSeat ? null : getPersona(personaId)
  );
}

/** Give every opponent the same range, as a share of all starting hands. */
export function uniformBook(state: HandState, heroSeat: number, topPercent: number): RangeBook {
  const dead = [...state.hole[heroSeat], ...state.board];
  const range = removeBlocked(topPercentRange(topPercent), dead);
  return Array.from({ length: state.playerCount }, (_, seat) => (seat === heroSeat ? [] : range));
}
