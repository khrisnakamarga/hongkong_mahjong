import { DEFAULT_HONG_KONG_RULES, type FanFeatureId, type HongKongMahjongRules } from './rules.js';
import type { SeatWind } from './state.js';
import type { Meld as EngineMeld } from './state.js';
import type { Tile as EngineTile, TileDefinition as EngineTileDefinition } from './tiles.js';

export type TileSuit = 'characters' | 'bamboo' | 'dots';
export type DragonColor = 'red' | 'green' | 'white';

export interface SuitedTile {
  readonly kind: 'suited';
  readonly suit: TileSuit;
  readonly rank: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
}

export interface WindTile {
  readonly kind: 'wind';
  readonly wind: SeatWind;
}

export interface DragonTile {
  readonly kind: 'dragon';
  readonly dragon: DragonColor;
}

export interface BonusTile {
  readonly kind: 'flower' | 'season';
  readonly seat: SeatWind;
}

export type ScoringTile = SuitedTile | WindTile | DragonTile;
export type ScoringInputTile = ScoringTile | BonusTile;
export type ScoringMeldType = 'chow' | 'pong' | 'kong' | 'pair';
export type SpecialHand = 'seven-pairs' | 'thirteen-orphans';

export interface ScoringMeld {
  readonly type: ScoringMeldType;
  readonly tiles: readonly ScoringTile[];
  readonly concealed?: boolean;
}

export interface WinningHand {
  readonly melds?: readonly ScoringMeld[];
  readonly pair?: ScoringMeld | ScoringTile;
  readonly tiles?: readonly ScoringTile[];
  readonly bonusTiles?: readonly BonusTile[];
  readonly seatWind?: SeatWind;
  readonly roundWind?: SeatWind;
  readonly specialHand?: SpecialHand;
}

export interface FanFeatureOccurrence {
  readonly id: FanFeatureId;
  readonly name: string;
  readonly fan: number;
  readonly description?: string;
  readonly replacementGroup?: string;
  readonly replaces?: readonly FanFeatureId[];
  readonly source?: string;
}

export interface ExcludedFanFeature extends FanFeatureOccurrence {
  readonly replacedBy: FanFeatureId;
}

export interface FanScoreResult {
  readonly fan: number;
  readonly minFan: number;
  readonly eligible: boolean;
  readonly detectedFeatures: readonly FanFeatureOccurrence[];
  readonly includedFeatures: readonly FanFeatureOccurrence[];
  readonly excludedFeatures: readonly ExcludedFanFeature[];
}

const TERMINAL_OR_HONOUR_KEYS = new Set([
  'suited:characters:1',
  'suited:characters:9',
  'suited:bamboo:1',
  'suited:bamboo:9',
  'suited:dots:1',
  'suited:dots:9',
  'wind:east',
  'wind:south',
  'wind:west',
  'wind:north',
  'dragon:red',
  'dragon:green',
  'dragon:white'
]);
const FLOWER_SEATS = {
  plum: 'east',
  orchid: 'south',
  chrysanthemum: 'west',
  bamboo: 'north'
} as const satisfies Readonly<Record<string, SeatWind>>;
const SEASON_SEATS = {
  spring: 'east',
  summer: 'south',
  autumn: 'west',
  winter: 'north'
} as const satisfies Readonly<Record<string, SeatWind>>;

export function suited(suit: TileSuit, rank: SuitedTile['rank']): SuitedTile {
  return { kind: 'suited', suit, rank };
}

export function windTile(wind: SeatWind): WindTile {
  return { kind: 'wind', wind };
}

export function dragonTile(dragon: DragonColor): DragonTile {
  return { kind: 'dragon', dragon };
}

export function flower(seat: SeatWind): BonusTile {
  return { kind: 'flower', seat };
}

export function season(seat: SeatWind): BonusTile {
  return { kind: 'season', seat };
}

export function chow(suit: TileSuit, startRank: 1 | 2 | 3 | 4 | 5 | 6 | 7, concealed = false): ScoringMeld {
  return {
    type: 'chow',
    tiles: [suited(suit, startRank), suited(suit, (startRank + 1) as SuitedTile['rank']), suited(suit, (startRank + 2) as SuitedTile['rank'])],
    concealed
  };
}

export function pong(tile: ScoringTile, concealed = false): ScoringMeld {
  return { type: 'pong', tiles: [tile, tile, tile], concealed };
}

export function kong(tile: ScoringTile, concealed = false): ScoringMeld {
  return { type: 'kong', tiles: [tile, tile, tile, tile], concealed };
}

export function pair(tile: ScoringTile): ScoringMeld {
  return { type: 'pair', tiles: [tile, tile] };
}

export function scoringTileFromEngineTile(tile: EngineTile | EngineTileDefinition): ScoringTile | undefined {
  if (tile.category === 'suit' && tile.suit && tile.rank) {
    return suited(tile.suit, tile.rank);
  }

  if (tile.category === 'wind' && tile.wind) {
    return windTile(tile.wind);
  }

  if (tile.category === 'dragon' && tile.dragon) {
    return dragonTile(tile.dragon);
  }

  return undefined;
}

export function bonusTileFromEngineTile(tile: EngineTile | EngineTileDefinition): BonusTile | undefined {
  if (tile.category === 'flower' && tile.flower) {
    const seat = FLOWER_SEATS[tile.flower];
    return seat ? flower(seat) : undefined;
  }

  if (tile.category === 'season' && tile.season) {
    const seat = SEASON_SEATS[tile.season];
    return seat ? season(seat) : undefined;
  }

  return undefined;
}

export function scoringTilesFromEngineTiles(tiles: readonly (EngineTile | EngineTileDefinition)[]): readonly ScoringTile[] {
  return tiles.flatMap((tile) => {
    const scoringTile = scoringTileFromEngineTile(tile);
    return scoringTile ? [scoringTile] : [];
  });
}

export function scoringMeldFromEngineMeld(meld: Pick<EngineMeld, 'kind' | 'tiles' | 'concealed'>): ScoringMeld | undefined {
  const tiles = scoringTilesFromEngineTiles(meld.tiles);
  if (tiles.length === 0) {
    return undefined;
  }

  const type = meld.kind === 'chow' || meld.kind === 'pong' ? meld.kind : 'kong';
  return {
    type,
    tiles,
    ...(meld.concealed !== undefined ? { concealed: meld.concealed } : {})
  };
}

export function scoreHand(
  hand: WinningHand,
  rules: HongKongMahjongRules = DEFAULT_HONG_KONG_RULES
): FanScoreResult {
  const detectedFeatures = detectFanFeatures(hand, rules);
  const { includedFeatures, excludedFeatures } = resolveFanFeatureReplacements(detectedFeatures);
  const fan = includedFeatures.reduce((total, feature) => total + feature.fan, 0);

  return {
    fan,
    minFan: rules.minFan,
    eligible: fan >= rules.minFan,
    detectedFeatures,
    includedFeatures,
    excludedFeatures
  };
}

export function detectFanFeatures(
  hand: WinningHand,
  rules: HongKongMahjongRules = DEFAULT_HONG_KONG_RULES
): readonly FanFeatureOccurrence[] {
  const features: FanFeatureOccurrence[] = [];
  const scoringTiles = collectScoringTiles(hand);
  const melds = hand.melds ?? [];
  const pairTile = getPairTile(hand);
  const seatWind = hand.seatWind;
  const roundWind = hand.roundWind;

  for (const bonusTile of hand.bonusTiles ?? []) {
    if (seatWind && bonusTile.seat === seatWind) {
      addFeature(features, bonusTile.kind === 'flower' ? 'seat-flower' : 'seat-season', rules, bonusTile.seat);
    }
  }

  if (hand.bonusTiles && hand.bonusTiles.length === 0) {
    addFeature(features, 'no-bonus-tiles', rules);
  }

  for (const meld of melds) {
    if (!isPongLike(meld)) {
      continue;
    }

    const tile = primaryTile(meld);
    if (!tile) {
      continue;
    }

    if (tile.kind === 'dragon') {
      addFeature(features, 'dragon-pong', rules, tile.dragon);
    }

    if (tile.kind === 'wind' && seatWind && tile.wind === seatWind) {
      addFeature(features, 'seat-wind-pong', rules, tile.wind);
    }

    if (tile.kind === 'wind' && roundWind && tile.wind === roundWind) {
      addFeature(features, 'round-wind-pong', rules, tile.wind);
    }
  }

  if (melds.length === 4 && melds.every((meld) => meld.type === 'chow')) {
    addFeature(features, 'all-chows', rules);
  }

  if (melds.length === 4 && melds.every(isPongLike) && pairTile) {
    addFeature(features, 'all-pongs', rules);
  }

  detectDragonFeatures(features, melds, pairTile, rules);
  detectWindFeatures(features, melds, pairTile, rules);
  detectSuitFeatures(features, scoringTiles, rules);
  detectTerminalHonourFeatures(features, scoringTiles, rules);
  detectSpecialHands(features, hand, scoringTiles, rules);

  return features;
}

function addFeature(
  features: FanFeatureOccurrence[],
  id: FanFeatureId,
  rules: HongKongMahjongRules,
  source?: string
): void {
  const rule = rules.fanTable[id];
  if (!rule || rule.enabled === false) {
    return;
  }

  const occurrence: FanFeatureOccurrence = {
    id,
    name: rule.name,
    fan: rule.fan,
    ...(rule.description !== undefined ? { description: rule.description } : {}),
    ...(rule.replacementGroup !== undefined ? { replacementGroup: rule.replacementGroup } : {}),
    ...(rule.replaces !== undefined ? { replaces: rule.replaces } : {}),
    ...(source !== undefined ? { source } : {})
  };
  features.push(occurrence);
}

export function resolveFanFeatureReplacements(features: readonly FanFeatureOccurrence[]): {
  includedFeatures: readonly FanFeatureOccurrence[];
  excludedFeatures: readonly ExcludedFanFeature[];
} {
  const included = [...features];
  const excluded: ExcludedFanFeature[] = [];

  const groups = new Map<string, FanFeatureOccurrence[]>();
  for (const feature of included) {
    if (!feature.replacementGroup) {
      continue;
    }

    const group = groups.get(feature.replacementGroup) ?? [];
    group.push(feature);
    groups.set(feature.replacementGroup, group);
  }

  for (const group of groups.values()) {
    const winner = group.reduce((best, feature) => (feature.fan > best.fan ? feature : best));
    for (const feature of group) {
      if (feature !== winner) {
        removeFeature(included, excluded, feature, winner.id);
      }
    }
  }

  for (const replacement of [...included].sort((a, b) => b.fan - a.fan)) {
    for (const replacedId of replacement.replaces ?? []) {
      for (const feature of [...included]) {
        if (feature !== replacement && feature.id === replacedId) {
          removeFeature(included, excluded, feature, replacement.id);
        }
      }
    }
  }

  return { includedFeatures: included, excludedFeatures: excluded };
}

function removeFeature(
  included: FanFeatureOccurrence[],
  excluded: ExcludedFanFeature[],
  feature: FanFeatureOccurrence,
  replacedBy: FanFeatureId
): void {
  const index = included.indexOf(feature);
  if (index >= 0) {
    included.splice(index, 1);
    excluded.push({ ...feature, replacedBy });
  }
}

function collectScoringTiles(hand: WinningHand): readonly ScoringTile[] {
  if (hand.tiles) {
    return hand.tiles;
  }

  const tiles: ScoringTile[] = [];
  for (const meld of hand.melds ?? []) {
    tiles.push(...meld.tiles);
  }

  const pairCandidate = hand.pair;
  if (pairCandidate) {
    if ('type' in pairCandidate) {
      tiles.push(...pairCandidate.tiles);
    } else {
      tiles.push(pairCandidate, pairCandidate);
    }
  }

  return tiles;
}

function getPairTile(hand: WinningHand): ScoringTile | undefined {
  const pairCandidate = hand.pair;
  if (!pairCandidate) {
    return undefined;
  }

  if ('type' in pairCandidate) {
    return primaryTile(pairCandidate);
  }

  return pairCandidate;
}

function primaryTile(meld: ScoringMeld): ScoringTile | undefined {
  return meld.tiles[0];
}

function isPongLike(meld: ScoringMeld): boolean {
  return meld.type === 'pong' || meld.type === 'kong';
}

function detectDragonFeatures(
  features: FanFeatureOccurrence[],
  melds: readonly ScoringMeld[],
  pairTile: ScoringTile | undefined,
  rules: HongKongMahjongRules
): void {
  const dragonSets = new Set(
    melds
      .filter(isPongLike)
      .map(primaryTile)
      .filter((tile): tile is DragonTile => tile?.kind === 'dragon')
      .map((tile) => tile.dragon)
  );
  const dragonPair = pairTile?.kind === 'dragon' ? pairTile.dragon : undefined;

  if (dragonSets.size === 3) {
    addFeature(features, 'big-three-dragons', rules);
  } else if (dragonSets.size === 2 && dragonPair && !dragonSets.has(dragonPair)) {
    addFeature(features, 'little-three-dragons', rules);
  }
}

function detectWindFeatures(
  features: FanFeatureOccurrence[],
  melds: readonly ScoringMeld[],
  pairTile: ScoringTile | undefined,
  rules: HongKongMahjongRules
): void {
  const windSets = new Set(
    melds
      .filter(isPongLike)
      .map(primaryTile)
      .filter((tile): tile is WindTile => tile?.kind === 'wind')
      .map((tile) => tile.wind)
  );
  const windPair = pairTile?.kind === 'wind' ? pairTile.wind : undefined;

  if (windSets.size === 4) {
    addFeature(features, 'big-four-winds', rules);
  } else if (windSets.size === 3 && windPair && !windSets.has(windPair)) {
    addFeature(features, 'little-four-winds', rules);
  }
}

function detectSuitFeatures(
  features: FanFeatureOccurrence[],
  tiles: readonly ScoringTile[],
  rules: HongKongMahjongRules
): void {
  if (tiles.length === 0) {
    return;
  }

  const suits = new Set(tiles.filter(isSuited).map((tile) => tile.suit));
  const hasHonours = tiles.some(isHonour);

  if (suits.size === 1 && hasHonours) {
    addFeature(features, 'mixed-one-suit', rules);
  } else if (suits.size === 1 && !hasHonours) {
    addFeature(features, 'pure-one-suit', rules);
  }
}

function detectTerminalHonourFeatures(
  features: FanFeatureOccurrence[],
  tiles: readonly ScoringTile[],
  rules: HongKongMahjongRules
): void {
  if (tiles.length === 0) {
    return;
  }

  const allHonours = tiles.every(isHonour);
  const allTerminals = tiles.every((tile) => isSuited(tile) && isTerminal(tile));
  const allTerminalsAndHonours = tiles.every((tile) => isHonour(tile) || (isSuited(tile) && isTerminal(tile)));

  if (allHonours) {
    addFeature(features, 'all-honours', rules);
  }

  if (allTerminals) {
    addFeature(features, 'all-terminals', rules);
  }

  if (allTerminalsAndHonours) {
    addFeature(features, 'all-terminals-and-honours', rules);
  }
}

function detectSpecialHands(
  features: FanFeatureOccurrence[],
  hand: WinningHand,
  tiles: readonly ScoringTile[],
  rules: HongKongMahjongRules
): void {
  if (hand.specialHand === 'seven-pairs' || isSevenPairs(tiles)) {
    addFeature(features, 'seven-pairs', rules);
  }

  if (hand.specialHand === 'thirteen-orphans' || isThirteenOrphans(tiles)) {
    addFeature(features, 'thirteen-orphans', rules);
  }
}

function isSevenPairs(tiles: readonly ScoringTile[]): boolean {
  if (tiles.length !== 14) {
    return false;
  }

  const counts = tileCounts(tiles);
  return counts.size === 7 && [...counts.values()].every((count) => count === 2);
}

function isThirteenOrphans(tiles: readonly ScoringTile[]): boolean {
  if (tiles.length !== 14) {
    return false;
  }

  const counts = tileCounts(tiles);
  const hasAllRequired = [...TERMINAL_OR_HONOUR_KEYS].every((key) => counts.has(key));
  const hasOnePair = [...counts.values()].filter((count) => count === 2).length === 1;

  return hasAllRequired && counts.size === TERMINAL_OR_HONOUR_KEYS.size && hasOnePair;
}

function tileCounts(tiles: readonly ScoringTile[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const tile of tiles) {
    const key = tileKey(tile);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  return counts;
}

function tileKey(tile: ScoringTile): string {
  switch (tile.kind) {
    case 'suited':
      return `suited:${tile.suit}:${tile.rank}`;
    case 'wind':
      return `wind:${tile.wind}`;
    case 'dragon':
      return `dragon:${tile.dragon}`;
  }
}

function isSuited(tile: ScoringTile): tile is SuitedTile {
  return tile.kind === 'suited';
}

function isHonour(tile: ScoringTile): tile is WindTile | DragonTile {
  return tile.kind === 'wind' || tile.kind === 'dragon';
}

function isTerminal(tile: SuitedTile): boolean {
  return tile.rank === 1 || tile.rank === 9;
}

