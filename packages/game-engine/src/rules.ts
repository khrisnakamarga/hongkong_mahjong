export type FanFeatureId = string;

export interface FanFeatureRule {
  readonly name: string;
  readonly fan: number;
  readonly enabled?: boolean;
  readonly description?: string;
  readonly replacementGroup?: string;
  readonly replaces?: readonly FanFeatureId[];
}

export type FanTable = Readonly<Record<FanFeatureId, FanFeatureRule>>;

export interface PaymentBand {
  readonly minFan: number;
  readonly maxFan?: number;
  readonly points: number;
}

export interface HongKongMahjongRules {
  readonly minFan: number;
  readonly fanTable: FanTable;
  readonly paymentTable: readonly PaymentBand[];
}

export const DEFAULT_PAYMENT_TABLE: readonly PaymentBand[] = [
  { minFan: 0, maxFan: 0, points: 1 },
  { minFan: 1, maxFan: 1, points: 2 },
  { minFan: 2, maxFan: 2, points: 4 },
  { minFan: 3, maxFan: 3, points: 8 },
  { minFan: 4, maxFan: 6, points: 16 },
  { minFan: 7, maxFan: 9, points: 32 },
  { minFan: 10, maxFan: 12, points: 64 },
  { minFan: 13, points: 128 }
] as const;

export const DEFAULT_FAN_TABLE: FanTable = {
  'seat-flower': {
    name: 'Seat flower',
    fan: 1,
    description: 'Flower matching the winning player seat wind.'
  },
  'seat-season': {
    name: 'Seat season',
    fan: 1,
    description: 'Season matching the winning player seat wind.'
  },
  'no-bonus-tiles': {
    name: 'No flowers or seasons',
    fan: 1
  },
  'dragon-pong': {
    name: 'Dragon Pong/Kong',
    fan: 1
  },
  'seat-wind-pong': {
    name: 'Seat wind Pong/Kong',
    fan: 1
  },
  'round-wind-pong': {
    name: 'Round wind Pong/Kong',
    fan: 1
  },
  'all-chows': {
    name: 'All Chows',
    fan: 1
  },
  'all-pongs': {
    name: 'All Pongs',
    fan: 3
  },
  'mixed-one-suit': {
    name: 'Mixed One Suit',
    fan: 3,
    replacementGroup: 'suit-pattern'
  },
  'pure-one-suit': {
    name: 'Pure One Suit',
    fan: 7,
    replacementGroup: 'suit-pattern'
  },
  'little-three-dragons': {
    name: 'Little Three Dragons',
    fan: 4,
    replaces: ['dragon-pong']
  },
  'big-three-dragons': {
    name: 'Big Three Dragons',
    fan: 8,
    replaces: ['dragon-pong', 'little-three-dragons']
  },
  'little-four-winds': {
    name: 'Little Four Winds',
    fan: 6,
    replaces: ['seat-wind-pong', 'round-wind-pong']
  },
  'big-four-winds': {
    name: 'Big Four Winds',
    fan: 13,
    replaces: ['seat-wind-pong', 'round-wind-pong', 'little-four-winds']
  },
  'seven-pairs': {
    name: 'Seven Pairs',
    fan: 4
  },
  'thirteen-orphans': {
    name: 'Thirteen Orphans',
    fan: 13
  },
  'all-honours': {
    name: 'All Honours',
    fan: 10,
    replacementGroup: 'terminal-honour-pattern'
  },
  'all-terminals': {
    name: 'All Terminals',
    fan: 10,
    replacementGroup: 'terminal-honour-pattern'
  },
  'all-terminals-and-honours': {
    name: 'All Terminals and Honours',
    fan: 13,
    replacementGroup: 'terminal-honour-pattern'
  }
} as const;

export const DEFAULT_HONG_KONG_RULES: HongKongMahjongRules = {
  minFan: 3,
  fanTable: DEFAULT_FAN_TABLE,
  paymentTable: DEFAULT_PAYMENT_TABLE
} as const;

export interface HongKongMahjongRulesOverride {
  readonly minFan?: number;
  readonly fanTable?: Readonly<Record<FanFeatureId, Partial<FanFeatureRule> | number>>;
  readonly paymentTable?: readonly PaymentBand[];
}

export function createHongKongMahjongRules(
  override: HongKongMahjongRulesOverride = {}
): HongKongMahjongRules {
  const fanTable: Record<FanFeatureId, FanFeatureRule> = { ...DEFAULT_FAN_TABLE };

  for (const [id, featureOverride] of Object.entries(override.fanTable ?? {})) {
    const current = fanTable[id] ?? { name: id, fan: 0 };
    fanTable[id] =
      typeof featureOverride === 'number'
        ? { ...current, fan: featureOverride }
        : { ...current, ...featureOverride, name: featureOverride.name ?? current.name };
  }

  return {
    minFan: override.minFan ?? DEFAULT_HONG_KONG_RULES.minFan,
    fanTable,
    paymentTable: override.paymentTable ?? DEFAULT_HONG_KONG_RULES.paymentTable
  };
}

