import {
  FLOWERS,
  SEASONS,
  SUITS,
  TERMINAL_AND_HONOR_KEYS,
  getTileDefinition,
  isFlowerOrSeason,
  isSuitTile,
  type Tile,
  type TileKey
} from './tiles.js';

export type WinningHandKind = 'standard' | 'sevenPairs' | 'thirteenOrphans' | 'nineGates' | 'flowerWin';

export interface MeldLike {
  readonly tiles: readonly Tile[];
}

export interface WinningHandResult {
  readonly isWin: boolean;
  readonly kind?: WinningHandKind;
  readonly reason?: string;
}

export interface WinValidationOptions {
  readonly melds?: readonly MeldLike[];
  readonly flowers?: readonly Tile[];
  readonly allowSpecialHands?: boolean;
  readonly allowFlowerWins?: boolean;
}

function countTileKeys(tiles: readonly Tile[]): Map<TileKey, number> {
  const counts = new Map<TileKey, number>();
  for (const tile of tiles) {
    if (!isFlowerOrSeason(tile)) {
      counts.set(tile.key, (counts.get(tile.key) ?? 0) + 1);
    }
  }
  return counts;
}

function cloneCounts(counts: Map<TileKey, number>): Map<TileKey, number> {
  return new Map([...counts.entries()]);
}

function decrement(counts: Map<TileKey, number>, key: TileKey, amount: number): void {
  const current = counts.get(key) ?? 0;
  if (current < amount) {
    throw new Error(`Cannot remove ${amount} ${key} tile(s) from count ${current}`);
  }
  if (current === amount) {
    counts.delete(key);
  } else {
    counts.set(key, current - amount);
  }
}

function firstRemainingKey(counts: Map<TileKey, number>): TileKey | undefined {
  for (const [key, count] of counts.entries()) {
    if (count > 0) {
      return key;
    }
  }
  return undefined;
}

function nextRankKey(key: TileKey, offset: 1 | 2): TileKey | undefined {
  const definition = getTileDefinition(key);
  if (!isSuitTile(definition) || definition.rank + offset > 9) {
    return undefined;
  }
  return `${definition.suit}-${definition.rank + offset}` as TileKey;
}

function canFormSets(counts: Map<TileKey, number>, setsNeeded: number): boolean {
  if (setsNeeded === 0) {
    return firstRemainingKey(counts) === undefined;
  }

  const key = firstRemainingKey(counts);
  if (!key) {
    return false;
  }

  if ((counts.get(key) ?? 0) >= 3) {
    const pongCounts = cloneCounts(counts);
    decrement(pongCounts, key, 3);
    if (canFormSets(pongCounts, setsNeeded - 1)) {
      return true;
    }
  }

  const second = nextRankKey(key, 1);
  const third = nextRankKey(key, 2);
  if (second && third && (counts.get(second) ?? 0) > 0 && (counts.get(third) ?? 0) > 0) {
    const chowCounts = cloneCounts(counts);
    decrement(chowCounts, key, 1);
    decrement(chowCounts, second, 1);
    decrement(chowCounts, third, 1);
    if (canFormSets(chowCounts, setsNeeded - 1)) {
      return true;
    }
  }

  return false;
}

export function isStandardWinningHand(tiles: readonly Tile[], melds: readonly MeldLike[] = []): boolean {
  const concealedTiles = tiles.filter((tile) => !isFlowerOrSeason(tile));
  const setsNeeded = 4 - melds.length;
  if (setsNeeded < 0 || concealedTiles.length !== setsNeeded * 3 + 2) {
    return false;
  }

  const counts = countTileKeys(concealedTiles);
  for (const [pairKey, count] of counts.entries()) {
    if (count < 2) {
      continue;
    }
    const remainder = cloneCounts(counts);
    decrement(remainder, pairKey, 2);
    if (canFormSets(remainder, setsNeeded)) {
      return true;
    }
  }
  return false;
}

export function isSevenPairs(tiles: readonly Tile[]): boolean {
  const concealedTiles = tiles.filter((tile) => !isFlowerOrSeason(tile));
  if (concealedTiles.length !== 14) {
    return false;
  }
  const counts = countTileKeys(concealedTiles);
  let pairs = 0;
  for (const count of counts.values()) {
    if (count !== 2 && count !== 4) {
      return false;
    }
    pairs += count / 2;
  }
  return pairs === 7;
}

export function isThirteenOrphans(tiles: readonly Tile[]): boolean {
  const concealedTiles = tiles.filter((tile) => !isFlowerOrSeason(tile));
  if (concealedTiles.length !== 14) {
    return false;
  }
  const required = new Set<TileKey>(TERMINAL_AND_HONOR_KEYS);
  const counts = countTileKeys(concealedTiles);
  let duplicateFound = false;
  for (const key of required) {
    const count = counts.get(key) ?? 0;
    if (count === 0 || count > 2) {
      return false;
    }
    if (count === 2) {
      if (duplicateFound) {
        return false;
      }
      duplicateFound = true;
    }
  }
  return duplicateFound && [...counts.keys()].every((key) => required.has(key));
}

export function isNineGates(tiles: readonly Tile[]): boolean {
  const concealedTiles = tiles.filter((tile) => !isFlowerOrSeason(tile));
  if (concealedTiles.length !== 14) {
    return false;
  }

  const first = concealedTiles[0];
  if (!first || !first.suit) {
    return false;
  }
  const suit = first.suit;
  if (!concealedTiles.every((tile) => tile.suit === suit)) {
    return false;
  }

  const counts = countTileKeys(concealedTiles);
  const requiredMinimums = [3, 1, 1, 1, 1, 1, 1, 1, 3] as const;
  return requiredMinimums.every((minimum, index) => {
    const rank = index + 1;
    return (counts.get(`${suit}-${rank}` as TileKey) ?? 0) >= minimum;
  });
}

export function isFlowerWinningHand(flowers: readonly Tile[]): boolean {
  const keys = new Set(flowers.map((tile) => tile.key));
  const hasAllFlowers = FLOWERS.every((flower) => keys.has(`flower-${flower}` as TileKey));
  const hasAllSeasons = SEASONS.every((season) => keys.has(`season-${season}` as TileKey));
  return flowers.length >= 8 || hasAllFlowers || hasAllSeasons;
}

export function validateWinningHand(
  tiles: readonly Tile[],
  options: WinValidationOptions = {}
): WinningHandResult {
  const melds = options.melds ?? [];
  const flowers = options.flowers ?? [];
  const allowSpecialHands = options.allowSpecialHands ?? true;
  const allowFlowerWins = options.allowFlowerWins ?? true;

  if (allowFlowerWins && isFlowerWinningHand(flowers)) {
    return { isWin: true, kind: 'flowerWin' };
  }
  if (allowSpecialHands && melds.length === 0) {
    if (isSevenPairs(tiles)) {
      return { isWin: true, kind: 'sevenPairs' };
    }
    if (isThirteenOrphans(tiles)) {
      return { isWin: true, kind: 'thirteenOrphans' };
    }
    if (isNineGates(tiles)) {
      return { isWin: true, kind: 'nineGates' };
    }
  }
  if (isStandardWinningHand(tiles, melds)) {
    return { isWin: true, kind: 'standard' };
  }

  return { isWin: false, reason: 'Hand does not match a supported Hong Kong Mahjong winning shape.' };
}

export function getChowWaitTileKeys(tile: Tile): readonly (readonly TileKey[])[] {
  if (!isSuitTile(tile)) {
    return [];
  }
  const combinations: TileKey[][] = [];
  for (const start of [tile.rank - 2, tile.rank - 1, tile.rank] as const) {
    if (start < 1 || start + 2 > 9) {
      continue;
    }
    const keys = [start, start + 1, start + 2]
      .filter((rank) => rank !== tile.rank)
      .map((rank) => `${tile.suit}-${rank}` as TileKey);
    combinations.push(keys);
  }
  return combinations;
}

export function isTerminalOrHonor(key: TileKey): boolean {
  return TERMINAL_AND_HONOR_KEYS.includes(key);
}

export function suitKeys(suit: (typeof SUITS)[number]): readonly TileKey[] {
  return [1, 2, 3, 4, 5, 6, 7, 8, 9].map((rank) => `${suit}-${rank}` as TileKey);
}
