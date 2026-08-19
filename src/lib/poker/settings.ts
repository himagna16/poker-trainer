/**
 * settings.ts - which training wheels are on.
 *
 * Lives in lib rather than beside the panel that renders it because the store
 * needs to persist it, and a storage module importing a type out of a React
 * component is the kind of tangle that gets worse every time you touch it.
 *
 * THE ORDERING OF THE PRESETS IS THE POINT. They're a ladder, not a menu. The
 * first rung deliberately shows LESS than the second: someone opening this for
 * the first time does not need six panels of analysis, they need to know
 * whether they're ahead and what it costs to find out. Everything else is noise
 * until those two questions feel automatic.
 */

export interface XraySettings {
  showOpponentCards: boolean;
  showEquity: boolean;
  showPotOdds: boolean;
  showEV: boolean;
  showRange: boolean;
  showOuts: boolean;
}

export interface Preset {
  id: string;
  label: string;
  blurb: string;
  settings: XraySettings;
}

export const PRESETS: Preset[] = [
  {
    id: 'start',
    label: 'Start here',
    blurb: 'Their cards, your chances, and the price. Nothing else yet.',
    settings: {
      showOpponentCards: true,
      showEquity: true,
      showPotOdds: true,
      showOuts: false,
      showEV: false,
      showRange: false,
    },
  },
  {
    id: 'full',
    label: 'Everything',
    blurb: 'Adds outs, what each action is worth, and their ranges.',
    settings: {
      showOpponentCards: true,
      showEquity: true,
      showPotOdds: true,
      showOuts: true,
      showEV: true,
      showRange: true,
    },
  },
  {
    id: 'odds',
    label: 'No peeking',
    blurb: 'Cards hidden. You still see your odds and what they could hold.',
    settings: {
      showOpponentCards: false,
      showEquity: true,
      showPotOdds: true,
      showOuts: false,
      showEV: false,
      showRange: true,
    },
  },
  {
    id: 'blind',
    label: 'Blind',
    blurb: 'No help at all. Decisions are still scored afterwards.',
    settings: {
      showOpponentCards: false,
      showEquity: false,
      showPotOdds: false,
      showOuts: false,
      showEV: false,
      showRange: false,
    },
  },
];

/** What someone sees the very first time they open the table. */
export const DEFAULT_SETTINGS: XraySettings = PRESETS[0].settings;

export function presetIdFor(settings: XraySettings): string | null {
  const match = PRESETS.find(
    (p) => JSON.stringify(p.settings) === JSON.stringify(settings)
  );
  return match ? match.id : null;
}

/** Guard against a stored object from an older version missing a key. */
export function normalizeSettings(value: unknown): XraySettings | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const keys: Array<keyof XraySettings> = [
    'showOpponentCards', 'showEquity', 'showPotOdds', 'showEV', 'showRange', 'showOuts',
  ];
  const out = {} as XraySettings;
  for (const key of keys) {
    if (typeof v[key] !== 'boolean') return null;
    out[key] = v[key] as boolean;
  }
  return out;
}
