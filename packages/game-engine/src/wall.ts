import { createTileSet, isFlowerOrSeason, type Tile } from './tiles.js';
import type { PlayerState, WallState } from './state.js';

export interface DrawResult {
  readonly wall: WallState;
  readonly tile?: Tile;
}

export interface PlayerDrawResult {
  readonly wall: WallState;
  readonly player: PlayerState;
  readonly drawnTile?: Tile;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function createRandom(seed: string): () => number {
  let value = hashSeed(seed) || 0x6d2b79f5;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffleTiles(tiles: readonly Tile[], seed: string): readonly Tile[] {
  const shuffled = [...tiles];
  const random = createRandom(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    const current = shuffled[index];
    const replacement = shuffled[swapIndex];
    if (!current || !replacement) {
      throw new Error('Unexpected shuffle index');
    }
    shuffled[index] = replacement;
    shuffled[swapIndex] = current;
  }
  return shuffled;
}

export function generateWall(seed = 'default'): WallState {
  const shuffled = shuffleTiles(createTileSet(), seed);
  return {
    seed,
    liveWall: shuffled.slice(0, -14),
    deadWall: shuffled.slice(-14),
    replacementDraws: []
  };
}

export function drawFromLiveWall(wall: WallState): DrawResult {
  const tile = wall.liveWall[0];
  if (!tile) {
    return { wall };
  }
  return {
    tile,
    wall: {
      ...wall,
      liveWall: wall.liveWall.slice(1)
    }
  };
}

export function drawReplacementTile(wall: WallState): DrawResult {
  const tile = wall.deadWall[wall.deadWall.length - 1];
  if (!tile) {
    return { wall };
  }
  return {
    tile,
    wall: {
      ...wall,
      deadWall: wall.deadWall.slice(0, -1),
      replacementDraws: [...wall.replacementDraws, tile]
    }
  };
}

export function addDrawnTileReplacingFlowers(
  player: PlayerState,
  wall: WallState,
  tile: Tile
): PlayerDrawResult {
  if (!isFlowerOrSeason(tile)) {
    return {
      wall,
      player: {
        ...player,
        concealedTiles: [...player.concealedTiles, tile]
      },
      drawnTile: tile
    };
  }

  const withFlower = {
    ...player,
    flowers: [...player.flowers, tile]
  };
  const replacement = drawReplacementTile(wall);
  if (!replacement.tile) {
    return { wall: replacement.wall, player: withFlower };
  }
  return addDrawnTileReplacingFlowers(withFlower, replacement.wall, replacement.tile);
}

export function drawLiveTileReplacingFlowers(player: PlayerState, wall: WallState): PlayerDrawResult {
  const draw = drawFromLiveWall(wall);
  if (!draw.tile) {
    return { wall: draw.wall, player };
  }
  return addDrawnTileReplacingFlowers(player, draw.wall, draw.tile);
}

export function drawKongReplacementReplacingFlowers(player: PlayerState, wall: WallState): PlayerDrawResult {
  const draw = drawReplacementTile(wall);
  if (!draw.tile) {
    return { wall: draw.wall, player };
  }
  return addDrawnTileReplacingFlowers(player, draw.wall, draw.tile);
}
