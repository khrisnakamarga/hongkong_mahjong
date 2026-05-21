import { getLegalActions, type LegalAction } from './actions.js';
import { calculatePayments } from './payments.js';
import { createHongKongMahjongRules } from './rules.js';
import {
  bonusTileFromEngineTile,
  scoreHand,
  scoringMeldFromEngineMeld,
  scoringTilesFromEngineTiles,
  type ExcludedFanFeature,
  type FanFeatureOccurrence,
  type ScoringMeld,
  type SpecialHand
} from './scoring.js';
import {
  SEAT_WINDS,
  getPlayer,
  nextSeatIndex,
  removeTileIds,
  replacePlayer,
  type Meld,
  type PlayerState,
  type RoundConclusion,
  type RoundFanFeature,
  type RoundRules,
  type RoundState,
  type RoundSettlement,
  type SeatController,
  type SeatWind
} from './state.js';
import { getTileDefinition, isFlowerOrSeason, isSuitTile, sortTiles, type Tile, type TileId, type TileKey } from './tiles.js';
import { validateWinningHand } from './hand-validation.js';
import { drawKongReplacementReplacingFlowers, drawLiveTileReplacingFlowers, generateWall } from './wall.js';

export const DEFAULT_RULESET: RoundRules = {
  name: 'Hong Kong Mahjong bootstrap rules',
  minFan: 3,
  playerCount: 4
};

export interface CreateRoundOptions {
  readonly seed?: string;
  readonly dealerSeat?: number;
  readonly windRoundStartDealerSeat?: number;
  readonly prevailingWind?: SeatWind;
  readonly rules?: RoundRules;
  readonly controllers?: readonly SeatController[];
  readonly displayNames?: readonly string[];
  readonly scores?: readonly number[];
}

function windForSeat(seatIndex: number, dealerSeat: number): SeatWind {
  const wind = SEAT_WINDS[(seatIndex - dealerSeat + SEAT_WINDS.length) % SEAT_WINDS.length];
  if (!wind) {
    throw new Error(`Invalid seat ${seatIndex} for dealer ${dealerSeat}.`);
  }
  return wind;
}

function nextWind(wind: SeatWind): SeatWind {
  const index = SEAT_WINDS.indexOf(wind);
  return SEAT_WINDS[(index + 1) % SEAT_WINDS.length] ?? 'east';
}

function createPlayers(
  dealerSeat: number,
  controllers: readonly SeatController[] = [],
  displayNames: readonly string[] = [],
  scores: readonly number[] = []
): readonly PlayerState[] {
  return SEAT_WINDS.map((_wind, seatIndex) => ({
    seatIndex,
    wind: windForSeat(seatIndex, dealerSeat),
    controller: controllers[seatIndex] ?? 'ai',
    displayName: displayNames[seatIndex] ?? `AI ${seatIndex + 1}`,
    score: scores[seatIndex] ?? 0,
    concealedTiles: [],
    flowers: [],
    melds: [],
    discards: []
  }));
}

function withDealtTile(state: RoundState, seatIndex: number): RoundState {
  const player = getPlayer(state, seatIndex);
  const result = drawLiveTileReplacingFlowers(player, state.wall);
  return {
    ...state,
    wall: result.wall,
    players: replacePlayer(state, seatIndex, () => result.player)
  };
}

function dealInitialHands(state: RoundState): RoundState {
  let next = state;
  for (let drawIndex = 0; drawIndex < 13; drawIndex += 1) {
    for (let seatIndex = 0; seatIndex < 4; seatIndex += 1) {
      next = withDealtTile(next, seatIndex);
    }
  }
  return withDealtTile(next, next.dealerSeat);
}

function withoutLastDiscard(state: RoundState): Omit<RoundState, 'lastDiscard'> {
  const { lastDiscard, ...rest } = state;
  void lastDiscard;
  return rest;
}

function withoutLastDraw(state: RoundState): Omit<RoundState, 'lastDraw'> {
  const { lastDraw, ...rest } = state;
  void lastDraw;
  return rest;
}

type TileGroups = Map<TileKey, readonly Tile[]>;

interface StandardHandBreakdown {
  readonly melds: readonly ScoringMeld[];
  readonly pair: ScoringMeld;
}

function cloneGroups(groups: TileGroups): Map<TileKey, Tile[]> {
  return new Map([...groups.entries()].map(([key, tiles]) => [key, [...tiles]]));
}

function removeFromGroup(groups: Map<TileKey, Tile[]>, key: TileKey, count: number): readonly Tile[] | undefined {
  const group = groups.get(key);
  if (!group || group.length < count) {
    return undefined;
  }
  const removed = group.slice(0, count);
  const remaining = group.slice(count);
  if (remaining.length === 0) {
    groups.delete(key);
  } else {
    groups.set(key, remaining);
  }
  return removed;
}

function firstRemainingGroupKey(groups: TileGroups): TileKey | undefined {
  return [...groups.keys()].find((key) => (groups.get(key)?.length ?? 0) > 0);
}

function nextSuitKey(key: TileKey, offset: 1 | 2): TileKey | undefined {
  const definition = getTileDefinition(key);
  if (!isSuitTile(definition) || definition.rank + offset > 9) {
    return undefined;
  }
  return `${definition.suit}-${definition.rank + offset}` as TileKey;
}

function toScoringMeld(type: ScoringMeld['type'], tiles: readonly Tile[], concealed = true): ScoringMeld | undefined {
  const scoringTiles = scoringTilesFromEngineTiles(tiles);
  if (scoringTiles.length !== tiles.length) {
    return undefined;
  }
  return {
    type,
    tiles: scoringTiles,
    concealed
  };
}

function decomposeSets(groups: TileGroups, setsNeeded: number): readonly ScoringMeld[] | undefined {
  if (setsNeeded === 0) {
    return firstRemainingGroupKey(groups) === undefined ? [] : undefined;
  }

  const key = firstRemainingGroupKey(groups);
  if (!key) {
    return undefined;
  }

  const pongGroups = cloneGroups(groups);
  const pongTiles = removeFromGroup(pongGroups, key, 3);
  if (pongTiles) {
    const pongMeld = toScoringMeld('pong', pongTiles);
    const remainder = pongMeld ? decomposeSets(pongGroups, setsNeeded - 1) : undefined;
    if (pongMeld && remainder) {
      return [pongMeld, ...remainder];
    }
  }

  const secondKey = nextSuitKey(key, 1);
  const thirdKey = nextSuitKey(key, 2);
  if (secondKey && thirdKey) {
    const chowGroups = cloneGroups(groups);
    const first = removeFromGroup(chowGroups, key, 1);
    const second = removeFromGroup(chowGroups, secondKey, 1);
    const third = removeFromGroup(chowGroups, thirdKey, 1);
    if (first && second && third) {
      const chowMeld = toScoringMeld('chow', [...first, ...second, ...third]);
      const remainder = chowMeld ? decomposeSets(chowGroups, setsNeeded - 1) : undefined;
      if (chowMeld && remainder) {
        return [chowMeld, ...remainder];
      }
    }
  }

  return undefined;
}

function decomposeStandardHand(tiles: readonly Tile[], exposedMeldCount: number): StandardHandBreakdown | undefined {
  const concealedTiles = sortTiles(tiles.filter((tile) => !isFlowerOrSeason(tile)));
  const setsNeeded = 4 - exposedMeldCount;
  if (setsNeeded < 0 || concealedTiles.length !== setsNeeded * 3 + 2) {
    return undefined;
  }

  const groups = new Map<TileKey, Tile[]>();
  for (const tile of concealedTiles) {
    groups.set(tile.key, [...(groups.get(tile.key) ?? []), tile]);
  }

  for (const key of groups.keys()) {
    const pairGroups = cloneGroups(groups);
    const pairTiles = removeFromGroup(pairGroups, key, 2);
    if (!pairTiles) {
      continue;
    }
    const pair = toScoringMeld('pair', pairTiles);
    const melds = pair ? decomposeSets(pairGroups, setsNeeded) : undefined;
    if (pair && melds) {
      return { melds, pair };
    }
  }

  return undefined;
}

function specialHandFromKind(kind: ReturnType<typeof validateWinningHand>['kind']): SpecialHand | undefined {
  if (kind === 'sevenPairs') {
    return 'seven-pairs';
  }
  if (kind === 'thirteenOrphans') {
    return 'thirteen-orphans';
  }
  return undefined;
}

function roundFanFeature(feature: FanFeatureOccurrence | ExcludedFanFeature): RoundFanFeature {
  return {
    id: feature.id,
    name: feature.name,
    fan: feature.fan,
    ...(feature.source !== undefined ? { source: feature.source } : {}),
    ...('replacedBy' in feature ? { replacedBy: feature.replacedBy } : {})
  };
}

function buildWinSettlement(state: RoundState, conclusion: RoundConclusion): RoundSettlement | undefined {
  if (conclusion.reason !== 'win' || conclusion.winnerSeat === undefined || !conclusion.source) {
    return undefined;
  }

  const winner = getPlayer(state, conclusion.winnerSeat);
  const concealedWinningTiles = conclusion.source === 'discard' && conclusion.winningTile
    ? [...winner.concealedTiles, conclusion.winningTile]
    : winner.concealedTiles;
  const allWinningTiles = [...concealedWinningTiles, ...winner.melds.flatMap((meld) => meld.tiles)];
  const validation = validateWinningHand(concealedWinningTiles, {
    melds: winner.melds,
    flowers: winner.flowers
  });
  const standardBreakdown = validation.kind === 'standard'
    ? decomposeStandardHand(concealedWinningTiles, winner.melds.length)
    : undefined;
  const melds = [
    ...winner.melds.flatMap((meld) => {
      const scoringMeld = scoringMeldFromEngineMeld(meld);
      return scoringMeld ? [scoringMeld] : [];
    }),
    ...(standardBreakdown?.melds ?? [])
  ];
  const rules = createHongKongMahjongRules({ minFan: state.rules.minFan });
  const specialHand = specialHandFromKind(validation.kind);
  const fanScore = scoreHand(
    {
      tiles: scoringTilesFromEngineTiles(allWinningTiles),
      ...(melds.length > 0 ? { melds } : {}),
      ...(standardBreakdown?.pair ? { pair: standardBreakdown.pair } : {}),
      bonusTiles: winner.flowers.flatMap((tile) => {
        const bonusTile = bonusTileFromEngineTile(tile);
        return bonusTile ? [bonusTile] : [];
      }),
      seatWind: winner.wind,
      roundWind: state.prevailingWind,
      ...(specialHand ? { specialHand } : {})
    },
    rules
  );
  const discarder = conclusion.source === 'discard' && state.lastDiscard ? getPlayer(state, state.lastDiscard.bySeat).wind : undefined;
  const payment = calculatePayments(
    {
      fan: fanScore.fan,
      winner: winner.wind,
      winType: conclusion.source === 'discard' ? 'discard' : 'self-pick',
      ...(discarder ? { discarder } : {}),
      eastSeat: getPlayer(state, state.dealerSeat).wind,
      players: state.players.map((player) => player.wind)
    },
    rules
  );

  return {
    fan: fanScore.fan,
    minFan: fanScore.minFan,
    eligible: payment.eligible,
    basePoints: payment.basePoints,
    includedFeatures: fanScore.includedFeatures.map(roundFanFeature),
    excludedFeatures: fanScore.excludedFeatures.map(roundFanFeature),
    paymentLines: payment.lines.map((line) => ({
      from: line.from,
      to: line.to,
      basePoints: line.basePoints,
      doublings: line.doublings,
      points: line.points,
      reasons: line.reasons
    })),
    deltas: payment.deltas
  };
}

function applySettlementDeltas(players: readonly PlayerState[], settlement: RoundSettlement | undefined): readonly PlayerState[] {
  if (!settlement) {
    return players;
  }
  return players.map((player) => ({
    ...player,
    score: player.score + settlement.deltas[player.wind]
  }));
}

export function createInitialRoundState(options: CreateRoundOptions = {}): RoundState {
  const seed = options.seed ?? 'local-round';
  const dealerSeat = options.dealerSeat ?? 0;
  const initial: RoundState = {
    phase: 'awaitingDiscard',
    rules: options.rules ?? DEFAULT_RULESET,
    dealerSeat,
    windRoundStartDealerSeat: options.windRoundStartDealerSeat ?? dealerSeat,
    prevailingWind: options.prevailingWind ?? 'east',
    currentTurn: dealerSeat,
    turnNumber: 1,
    players: createPlayers(dealerSeat, options.controllers, options.displayNames, options.scores),
    wall: generateWall(seed)
  };
  return dealInitialHands(initial);
}

export interface CreateNextRoundOptions {
  readonly seed?: string;
}

export function createNextRoundState(state: RoundState, options: CreateNextRoundOptions = {}): RoundState {
  if (state.phase !== 'finished') {
    throw new Error(`Cannot start next round while phase is ${state.phase}.`);
  }

  const dealerRetains =
    state.conclusion?.reason !== 'win' ||
    state.conclusion.winnerSeat === undefined ||
    state.conclusion.winnerSeat === state.dealerSeat;
  const dealerSeat = dealerRetains ? state.dealerSeat : nextSeatIndex(state.dealerSeat);
  const windRoundStartDealerSeat = state.windRoundStartDealerSeat ?? 0;
  const advancedWind = !dealerRetains && dealerSeat === windRoundStartDealerSeat;
  const prevailingWind = advancedWind ? nextWind(state.prevailingWind) : state.prevailingWind;
  const nextWindRoundStartDealerSeat = advancedWind ? dealerSeat : windRoundStartDealerSeat;

  return createInitialRoundState({
    seed: options.seed ?? `${state.wall.seed}:next:${state.turnNumber}:${dealerSeat}:${prevailingWind}`,
    dealerSeat,
    windRoundStartDealerSeat: nextWindRoundStartDealerSeat,
    prevailingWind,
    rules: state.rules,
    controllers: state.players.map((player) => player.controller),
    displayNames: state.players.map((player) => player.displayName),
    scores: state.players.map((player) => player.score)
  });
}

function finish(state: RoundState, conclusion: RoundConclusion): RoundState {
  const settlement = buildWinSettlement(state, conclusion);
  return {
    ...withoutLastDraw(withoutLastDiscard(state)),
    phase: 'finished',
    players: applySettlementDeltas(state.players, settlement),
    conclusion: {
      ...conclusion,
      ...(settlement ? { settlement } : {})
    }
  };
}

export function finishRoundAsExhaustiveDraw(state: RoundState): RoundState {
  return finish(state, {
    reason: 'exhaustiveDraw',
    message: 'The live wall is exhausted.'
  });
}

export function drawTile(state: RoundState, seatIndex = state.currentTurn): RoundState {
  if (state.phase !== 'awaitingDraw') {
    throw new Error(`Cannot draw while phase is ${state.phase}`);
  }
  if (seatIndex !== state.currentTurn) {
    throw new Error(`It is seat ${state.currentTurn}'s turn to draw.`);
  }
  if (state.wall.liveWall.length === 0) {
    return finishRoundAsExhaustiveDraw(state);
  }

  const player = getPlayer(state, seatIndex);
  const result = drawLiveTileReplacingFlowers(player, state.wall);
  const nextState = withoutLastDraw(state);
  return {
    ...nextState,
    phase: 'awaitingDiscard',
    wall: result.wall,
    players: replacePlayer(state, seatIndex, () => result.player),
    ...(result.drawnTile ? { lastDraw: { tile: result.drawnTile, seatIndex, source: 'liveWall' as const, turnNumber: state.turnNumber } } : {})
  };
}

export function discardTile(state: RoundState, tileId: TileId): RoundState {
  if (state.phase !== 'awaitingDiscard') {
    throw new Error(`Cannot discard while phase is ${state.phase}`);
  }
  const seatIndex = state.currentTurn;
  const player = getPlayer(state, seatIndex);
  const tile = player.concealedTiles.find((candidate) => candidate.id === tileId);
  if (!tile) {
    throw new Error(`Tile ${tileId} is not in seat ${seatIndex}'s concealed hand.`);
  }
  return {
    ...withoutLastDraw(state),
    phase: 'awaitingClaims',
    players: replacePlayer(state, seatIndex, (current) => ({
      ...current,
      concealedTiles: removeTileIds(current.concealedTiles, [tileId]),
      discards: [...current.discards, tile]
    })),
    lastDiscard: {
      tile,
      bySeat: seatIndex,
      turnNumber: state.turnNumber
    }
  };
}

export function passClaimWindow(state: RoundState): RoundState {
  if (state.phase !== 'awaitingClaims' || !state.lastDiscard) {
    throw new Error('No claim window is open.');
  }
  const nextTurn = nextSeatIndex(state.lastDiscard.bySeat);
  return {
    ...withoutLastDiscard(state),
    phase: 'awaitingDraw',
    currentTurn: nextTurn,
    turnNumber: state.turnNumber + 1
  };
}

function makeMeld(kind: Meld['kind'], tiles: readonly Tile[], claimedTileId?: TileId, fromSeat?: number): Meld {
  return {
    id: `${kind}-${tiles.map((tile) => tile.id).join('|')}`,
    kind,
    tiles,
    ...(claimedTileId ? { claimedTileId } : {}),
    ...(fromSeat !== undefined ? { fromSeat } : {}),
    ...(kind === 'concealedKong' ? { concealed: true } : {})
  };
}

function removeLastDiscardFromOwner(state: RoundState): readonly PlayerState[] {
  const discard = state.lastDiscard;
  if (!discard) {
    return state.players;
  }
  return replacePlayer(state, discard.bySeat, (player) => ({
    ...player,
    discards: player.discards.filter((tile) => tile.id !== discard.tile.id)
  }));
}

function actionMatches(requested: LegalAction, legal: LegalAction): boolean {
  return requested.type === legal.type && JSON.stringify(requested) === JSON.stringify(legal);
}

export function claimDiscard(state: RoundState, seatIndex: number, action: LegalAction): RoundState {
  if (state.phase !== 'awaitingClaims' || !state.lastDiscard) {
    throw new Error('No discard is available to claim.');
  }
  const legal = getLegalActions(state, seatIndex);
  if (!legal.some((candidate) => actionMatches(action, candidate))) {
    throw new Error(`Illegal claim action for seat ${seatIndex}: ${action.type}`);
  }
  if (action.type === 'pass') {
    return state;
  }
  if (action.type === 'win') {
    return finish(state, {
      reason: 'win',
      winnerSeat: seatIndex,
      winningTile: state.lastDiscard.tile,
      source: 'discard',
      message: `Seat ${seatIndex} wins on discard.`
    });
  }
  if (action.type !== 'chow' && action.type !== 'pong' && !(action.type === 'kong' && action.kongType === 'exposed')) {
    throw new Error(`Unsupported claim action: ${action.type}`);
  }

  const claimedTile = state.lastDiscard.tile;
  const player = getPlayer(state, seatIndex);
  const usedIds = action.tiles;
  const usedTiles = usedIds.map((id) => {
    const tile = player.concealedTiles.find((candidate) => candidate.id === id);
    if (!tile) {
      throw new Error(`Tile ${id} not found for claim.`);
    }
    return tile;
  });
  const kind = action.type === 'kong' ? 'exposedKong' : action.type;
  const meld = makeMeld(kind, [...usedTiles, claimedTile], claimedTile.id, state.lastDiscard.bySeat);
  let players = removeLastDiscardFromOwner(state);
  players = players.map((current, index) =>
    index === seatIndex
      ? {
          ...current,
          concealedTiles: removeTileIds(current.concealedTiles, usedIds),
          melds: [...current.melds, meld]
        }
      : current
  );

  const nextState: RoundState = {
    ...withoutLastDiscard(state),
    phase: 'awaitingDiscard',
    currentTurn: seatIndex,
    turnNumber: state.turnNumber + 1,
    players
  };

  if (kind === 'exposedKong') {
    const kongPlayer = getPlayer(nextState, seatIndex);
    const result = drawKongReplacementReplacingFlowers(kongPlayer, nextState.wall);
    return {
      ...nextState,
      wall: result.wall,
      players: replacePlayer(nextState, seatIndex, () => result.player),
      ...(result.drawnTile ? { lastDraw: { tile: result.drawnTile, seatIndex, source: 'replacement' as const, turnNumber: nextState.turnNumber } } : {})
    };
  }

  return nextState;
}

export function declareKong(state: RoundState, tileKey: TileKey, meldId?: string): RoundState {
  if (state.phase !== 'awaitingDiscard') {
    throw new Error(`Cannot declare kong while phase is ${state.phase}`);
  }
  const seatIndex = state.currentTurn;
  const player = getPlayer(state, seatIndex);

  if (meldId) {
    const meld = player.melds.find((candidate) => candidate.id === meldId);
    const tile = player.concealedTiles.find((candidate) => candidate.key === tileKey);
    if (!meld || meld.kind !== 'pong' || !tile || meld.tiles[0]?.key !== tileKey) {
      throw new Error(`Cannot add kong for meld ${meldId} and tile ${tileKey}.`);
    }
    const upgraded = makeMeld('addedKong', [...meld.tiles, tile], meld.claimedTileId, meld.fromSeat);
    const upgradedPlayer: PlayerState = {
      ...player,
      concealedTiles: removeTileIds(player.concealedTiles, [tile.id]),
      melds: player.melds.map((candidate) => (candidate.id === meldId ? upgraded : candidate))
    };
    const result = drawKongReplacementReplacingFlowers(upgradedPlayer, state.wall);
    const nextState = withoutLastDraw(state);
    return {
      ...nextState,
      wall: result.wall,
      players: replacePlayer(nextState, seatIndex, () => result.player),
      ...(result.drawnTile ? { lastDraw: { tile: result.drawnTile, seatIndex, source: 'replacement' as const, turnNumber: state.turnNumber } } : {})
    };
  }

  const tiles = player.concealedTiles.filter((tile) => tile.key === tileKey).slice(0, 4);
  if (tiles.length !== 4) {
    throw new Error(`Cannot declare concealed kong for ${tileKey}.`);
  }
  const kong = makeMeld('concealedKong', tiles);
  const kongPlayer: PlayerState = {
    ...player,
    concealedTiles: removeTileIds(player.concealedTiles, tiles.map((tile) => tile.id)),
    melds: [...player.melds, kong]
  };
  const result = drawKongReplacementReplacingFlowers(kongPlayer, state.wall);
  const nextState = withoutLastDraw(state);
  return {
    ...nextState,
    wall: result.wall,
    players: replacePlayer(nextState, seatIndex, () => result.player),
    ...(result.drawnTile ? { lastDraw: { tile: result.drawnTile, seatIndex, source: 'replacement' as const, turnNumber: state.turnNumber } } : {})
  };
}

export function declareSelfDrawWin(state: RoundState): RoundState {
  if (state.phase !== 'awaitingDiscard') {
    throw new Error(`Cannot declare win while phase is ${state.phase}`);
  }
  const action = getLegalActions(state, state.currentTurn).find((candidate) => candidate.type === 'win');
  if (!action) {
    throw new Error('Current player does not have a legal win.');
  }
  const player = getPlayer(state, state.currentTurn);
  const fallbackTile = player.concealedTiles[player.concealedTiles.length - 1];
  const flowerWinningTile = player.flowers[player.flowers.length - 1];
  const winningTile = action.source === 'flower'
    ? flowerWinningTile
    : state.lastDraw?.tile ?? fallbackTile;
  return finish(state, {
    reason: 'win',
    winnerSeat: state.currentTurn,
    ...(winningTile ? { winningTile } : {}),
    source: action.source,
    message: `Seat ${state.currentTurn} wins by ${action.source}.`
  });
}
