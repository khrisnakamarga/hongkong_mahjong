export const SUITS = ['dots', 'bamboo', 'characters'] as const;
export const WINDS = ['east', 'south', 'west', 'north'] as const;
export const DRAGONS = ['red', 'green', 'white'] as const;
export const FLOWERS = ['plum', 'orchid', 'chrysanthemum', 'bamboo'] as const;
export const SEASONS = ['spring', 'summer', 'autumn', 'winter'] as const;

export type Suit = (typeof SUITS)[number];
export type Wind = (typeof WINDS)[number];
export type Dragon = (typeof DRAGONS)[number];
export type Flower = (typeof FLOWERS)[number];
export type Season = (typeof SEASONS)[number];
export type TileCategory = 'suit' | 'wind' | 'dragon' | 'flower' | 'season';
export type TileKey =
  | `${Suit}-${1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9}`
  | Wind
  | Dragon
  | `flower-${Flower}`
  | `season-${Season}`;
export type TileId = string;

export interface TileDefinition {
  readonly key: TileKey;
  readonly category: TileCategory;
  readonly name: string;
  readonly suit?: Suit;
  readonly rank?: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  readonly wind?: Wind;
  readonly dragon?: Dragon;
  readonly flower?: Flower;
  readonly season?: Season;
}

export interface Tile extends TileDefinition {
  readonly id: TileId;
  readonly copy: number;
}

const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

function titleCase(value: string): string {
  return `${value.slice(0, 1).toUpperCase()}${value.slice(1)}`;
}

function createDefinitions(): readonly TileDefinition[] {
  const suited = SUITS.flatMap((suit) =>
    RANKS.map((rank) => ({
      key: `${suit}-${rank}` as TileKey,
      category: 'suit' as const,
      suit,
      rank,
      name: `${rank} ${titleCase(suit)}`
    }))
  );
  const winds = WINDS.map((wind) => ({
    key: wind as TileKey,
    category: 'wind' as const,
    wind,
    name: `${titleCase(wind)} Wind`
  }));
  const dragons = DRAGONS.map((dragon) => ({
    key: dragon as TileKey,
    category: 'dragon' as const,
    dragon,
    name: `${titleCase(dragon)} Dragon`
  }));
  const flowers = FLOWERS.map((flower) => ({
    key: `flower-${flower}` as TileKey,
    category: 'flower' as const,
    flower,
    name: titleCase(flower)
  }));
  const seasons = SEASONS.map((season) => ({
    key: `season-${season}` as TileKey,
    category: 'season' as const,
    season,
    name: titleCase(season)
  }));

  return [...suited, ...winds, ...dragons, ...flowers, ...seasons];
}

export const TILE_DEFINITIONS = createDefinitions();
export const TILE_KEYS = TILE_DEFINITIONS.map((tile) => tile.key);
export const TERMINAL_AND_HONOR_KEYS = TILE_DEFINITIONS.filter(
  (tile) =>
    tile.category === 'wind' ||
    tile.category === 'dragon' ||
    (tile.category === 'suit' && (tile.rank === 1 || tile.rank === 9))
).map((tile) => tile.key);

const DEFINITION_BY_KEY = new Map<TileKey, TileDefinition>(
  TILE_DEFINITIONS.map((definition) => [definition.key, definition])
);

export function getTileDefinition(key: TileKey): TileDefinition {
  const definition = DEFINITION_BY_KEY.get(key);
  if (!definition) {
    throw new Error(`Unknown tile key: ${key}`);
  }
  return definition;
}

export function createTileSet(): readonly Tile[] {
  return TILE_DEFINITIONS.flatMap((definition) => {
    const copies = definition.category === 'flower' || definition.category === 'season' ? 1 : 4;
    return Array.from({ length: copies }, (_, copy) => ({
      ...definition,
      id: `${definition.key}#${copy}`,
      copy
    }));
  });
}

export function isFlowerOrSeason(tile: Pick<TileDefinition, 'category'>): boolean {
  return tile.category === 'flower' || tile.category === 'season';
}

export function isSuitTile(tile: Pick<TileDefinition, 'category'>): tile is TileDefinition & { readonly suit: Suit; readonly rank: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 } {
  return tile.category === 'suit';
}

export function isHonorTile(tile: Pick<TileDefinition, 'category'>): boolean {
  return tile.category === 'wind' || tile.category === 'dragon';
}

export function sameTileKey(left: Pick<Tile, 'key'>, right: Pick<Tile, 'key'>): boolean {
  return left.key === right.key;
}

export function tileKeySortValue(key: TileKey): number {
  const definition = getTileDefinition(key);
  if (definition.category === 'suit') {
    if (!definition.suit || !definition.rank) {
      throw new Error(`Invalid suited tile definition: ${definition.key}`);
    }
    const suitIndex = SUITS.indexOf(definition.suit);
    return suitIndex * 10 + definition.rank;
  }
  if (definition.category === 'wind') {
    if (!definition.wind) {
      throw new Error(`Invalid wind tile definition: ${definition.key}`);
    }
    return 100 + WINDS.indexOf(definition.wind);
  }
  if (definition.category === 'dragon') {
    if (!definition.dragon) {
      throw new Error(`Invalid dragon tile definition: ${definition.key}`);
    }
    return 110 + DRAGONS.indexOf(definition.dragon);
  }
  if (definition.category === 'flower') {
    if (!definition.flower) {
      throw new Error(`Invalid flower tile definition: ${definition.key}`);
    }
    return 120 + FLOWERS.indexOf(definition.flower);
  }
  if (!definition.season) {
    throw new Error(`Invalid season tile definition: ${definition.key}`);
  }
  return 130 + SEASONS.indexOf(definition.season);
}

export function sortTiles<T extends Pick<Tile, 'key' | 'id'>>(tiles: readonly T[]): readonly T[] {
  return [...tiles].sort((left, right) => {
    const keySort = tileKeySortValue(left.key) - tileKeySortValue(right.key);
    return keySort === 0 ? left.id.localeCompare(right.id) : keySort;
  });
}
