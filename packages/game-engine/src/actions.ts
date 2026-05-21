import { getChowWaitTileKeys, validateWinningHand } from './hand-validation.js';
import {
  findTilesByKey,
  getPlayer,
  nextSeatIndex,
  type LastDiscard,
  type Meld,
  type RoundState
} from './state.js';
import type { Tile, TileId, TileKey } from './tiles.js';

export type LegalAction =
  | { readonly type: 'nextRound' }
  | { readonly type: 'draw' }
  | { readonly type: 'discard'; readonly tileId: TileId }
  | { readonly type: 'win'; readonly source: 'selfDraw' | 'discard' | 'flower'; readonly claimedTileId?: TileId }
  | { readonly type: 'chow'; readonly tiles: readonly [TileId, TileId]; readonly claimedTileId: TileId }
  | { readonly type: 'pong'; readonly tiles: readonly [TileId, TileId]; readonly claimedTileId: TileId }
  | { readonly type: 'kong'; readonly kongType: 'exposed'; readonly tiles: readonly [TileId, TileId, TileId]; readonly claimedTileId: TileId }
  | { readonly type: 'kong'; readonly kongType: 'concealed'; readonly tiles: readonly [TileId, TileId, TileId, TileId]; readonly tileKey: TileKey }
  | { readonly type: 'kong'; readonly kongType: 'added'; readonly meldId: string; readonly tileId: TileId; readonly tileKey: TileKey }
  | { readonly type: 'pass' };

function tuple2(tiles: readonly Tile[]): readonly [TileId, TileId] {
  const first = tiles[0];
  const second = tiles[1];
  if (!first || !second) {
    throw new Error('Expected two tiles');
  }
  return [first.id, second.id];
}

function tuple3(tiles: readonly Tile[]): readonly [TileId, TileId, TileId] {
  const first = tiles[0];
  const second = tiles[1];
  const third = tiles[2];
  if (!first || !second || !third) {
    throw new Error('Expected three tiles');
  }
  return [first.id, second.id, third.id];
}

function tuple4(tiles: readonly Tile[]): readonly [TileId, TileId, TileId, TileId] {
  const first = tiles[0];
  const second = tiles[1];
  const third = tiles[2];
  const fourth = tiles[3];
  if (!first || !second || !third || !fourth) {
    throw new Error('Expected four tiles');
  }
  return [first.id, second.id, third.id, fourth.id];
}

function groupedByKey(tiles: readonly Tile[]): Map<TileKey, readonly Tile[]> {
  const groups = new Map<TileKey, Tile[]>();
  for (const tile of tiles) {
    groups.set(tile.key, [...(groups.get(tile.key) ?? []), tile]);
  }
  return groups;
}

function canDeclareWin(state: RoundState, winnerSeat: number, source: 'selfDraw' | 'discard' | 'flower', winningTile?: Tile): boolean {
  const hook = state.rules.canDeclareWin;
  if (!hook) {
    return true;
  }
  return hook({
    state,
    winnerSeat,
    source,
    ...(winningTile ? { winningTile } : {})
  });
}

function winActionForSelfDraw(state: RoundState, seatIndex: number): LegalAction | undefined {
  const player = getPlayer(state, seatIndex);
  const result = validateWinningHand(player.concealedTiles, {
    melds: player.melds,
    flowers: player.flowers
  });
  if (!result.isWin || !canDeclareWin(state, seatIndex, result.kind === 'flowerWin' ? 'flower' : 'selfDraw')) {
    return undefined;
  }
  return { type: 'win', source: result.kind === 'flowerWin' ? 'flower' : 'selfDraw' };
}

function winActionForDiscard(state: RoundState, seatIndex: number, discard: LastDiscard): LegalAction | undefined {
  const player = getPlayer(state, seatIndex);
  const result = validateWinningHand([...player.concealedTiles, discard.tile], {
    melds: player.melds,
    flowers: player.flowers
  });
  if (!result.isWin || !canDeclareWin(state, seatIndex, 'discard', discard.tile)) {
    return undefined;
  }
  return { type: 'win', source: 'discard', claimedTileId: discard.tile.id };
}

function getChowActions(state: RoundState, seatIndex: number, discard: LastDiscard): readonly LegalAction[] {
  if (seatIndex !== nextSeatIndex(discard.bySeat)) {
    return [];
  }
  const player = getPlayer(state, seatIndex);
  const actions: LegalAction[] = [];
  for (const keys of getChowWaitTileKeys(discard.tile)) {
    const selected: Tile[] = [];
    for (const key of keys) {
      const tile = player.concealedTiles.find(
        (candidate) => candidate.key === key && !selected.some((used) => used.id === candidate.id)
      );
      if (tile) {
        selected.push(tile);
      }
    }
    if (selected.length === 2) {
      actions.push({ type: 'chow', tiles: tuple2(selected), claimedTileId: discard.tile.id });
    }
  }
  return actions;
}

function getClaimActions(state: RoundState, seatIndex: number): readonly LegalAction[] {
  const discard = state.lastDiscard;
  if (!discard || discard.bySeat === seatIndex) {
    return [];
  }

  const player = getPlayer(state, seatIndex);
  const matching = player.concealedTiles.filter((tile) => tile.key === discard.tile.key);
  const actions: LegalAction[] = [{ type: 'pass' }];
  const win = winActionForDiscard(state, seatIndex, discard);
  if (win) {
    actions.push(win);
  }
  actions.push(...getChowActions(state, seatIndex, discard));
  if (matching.length >= 2) {
    actions.push({ type: 'pong', tiles: tuple2(matching), claimedTileId: discard.tile.id });
  }
  if (matching.length >= 3) {
    actions.push({ type: 'kong', kongType: 'exposed', tiles: tuple3(matching), claimedTileId: discard.tile.id });
  }
  return actions;
}

function getConcealedKongActions(playerTiles: readonly Tile[]): readonly LegalAction[] {
  const actions: LegalAction[] = [];
  for (const [key, tiles] of groupedByKey(playerTiles).entries()) {
    if (tiles.length >= 4) {
      actions.push({ type: 'kong', kongType: 'concealed', tileKey: key, tiles: tuple4(tiles) });
    }
  }
  return actions;
}

function getAddedKongActions(melds: readonly Meld[], playerTiles: readonly Tile[]): readonly LegalAction[] {
  const actions: LegalAction[] = [];
  for (const meld of melds) {
    if (meld.kind !== 'pong') {
      continue;
    }
    const tileKey = meld.tiles[0]?.key;
    if (!tileKey) {
      continue;
    }
    const tile = playerTiles.find((candidate) => candidate.key === tileKey);
    if (tile) {
      actions.push({ type: 'kong', kongType: 'added', meldId: meld.id, tileId: tile.id, tileKey });
    }
  }
  return actions;
}

export function getLegalActions(state: RoundState, seatIndex: number): readonly LegalAction[] {
  if (state.phase === 'finished') {
    return getPlayer(state, seatIndex) ? [{ type: 'nextRound' }] : [];
  }
  if (state.phase === 'awaitingDraw') {
    return seatIndex === state.currentTurn ? [{ type: 'draw' }] : [];
  }
  if (state.phase === 'awaitingClaims') {
    return getClaimActions(state, seatIndex);
  }
  if (state.phase !== 'awaitingDiscard' || seatIndex !== state.currentTurn) {
    return [];
  }

  const player = getPlayer(state, seatIndex);
  const actions: LegalAction[] = player.concealedTiles.map((tile) => ({ type: 'discard', tileId: tile.id }));
  const win = winActionForSelfDraw(state, seatIndex);
  if (win) {
    actions.push(win);
  }
  actions.push(...getConcealedKongActions(player.concealedTiles));
  actions.push(...getAddedKongActions(player.melds, player.concealedTiles));
  return actions;
}

export function getMatchingTilesForClaim(tiles: readonly Tile[], key: TileKey, count: number): readonly Tile[] {
  return findTilesByKey(tiles, key, count);
}
