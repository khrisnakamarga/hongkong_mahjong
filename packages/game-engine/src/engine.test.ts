import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULESET,
  claimDiscard,
  createInitialRoundState,
  createNextRoundState,
  createTileSet,
  declareSelfDrawWin,
  discardTile,
  drawTile,
  generateWall,
  getLegalActions,
  isFlowerWinningHand,
  passClaimWindow,
  validateWinningHand,
  type PlayerState,
  type RoundState,
  type Tile,
  type TileKey,
  type WallState
} from './index.js';

function tiles(keys: readonly TileKey[]): readonly Tile[] {
  const source = createTileSet();
  const used = new Set<string>();
  return keys.map((key) => {
    const tile = source.find((candidate) => candidate.key === key && !used.has(candidate.id));
    if (!tile) {
      throw new Error(`No unused tile for ${key}`);
    }
    used.add(tile.id);
    return tile;
  });
}

function emptyPlayer(seatIndex: number, concealedTiles: readonly Tile[] = [], flowers: readonly Tile[] = []): PlayerState {
  const winds = ['east', 'south', 'west', 'north'] as const;
  const wind = winds[seatIndex];
  if (!wind) {
    throw new Error(`Invalid seat ${seatIndex}`);
  }
  return {
    seatIndex,
    wind,
    controller: 'ai',
    displayName: `P${seatIndex}`,
    score: 0,
    concealedTiles,
    flowers,
    melds: [],
    discards: []
  };
}

function wall(liveWall: readonly Tile[] = [], deadWall: readonly Tile[] = []): WallState {
  return { seed: 'test', liveWall, deadWall, replacementDraws: [] };
}

function roundState(overrides: Partial<RoundState>): RoundState {
  return {
    phase: 'awaitingDiscard',
    rules: DEFAULT_RULESET,
    dealerSeat: 0,
    prevailingWind: 'east',
    currentTurn: 0,
    turnNumber: 1,
    players: [emptyPlayer(0), emptyPlayer(1), emptyPlayer(2), emptyPlayer(3)],
    wall: wall(),
    ...overrides
  };
}

describe('tile taxonomy and wall generation', () => {
  it('creates a complete 144-tile set with unique ids', () => {
    const set = createTileSet();

    expect(set).toHaveLength(144);
    expect(new Set(set.map((tile) => tile.id))).toHaveLength(144);
    expect(set.filter((tile) => tile.key === 'dots-1')).toHaveLength(4);
    expect(set.filter((tile) => tile.category === 'flower')).toHaveLength(4);
    expect(set.filter((tile) => tile.category === 'season')).toHaveLength(4);
  });

  it('generates deterministic live walls and dead walls from a seed', () => {
    const first = generateWall('seed-a');
    const second = generateWall('seed-a');
    const third = generateWall('seed-b');

    expect(first.liveWall).toHaveLength(130);
    expect(first.deadWall).toHaveLength(14);
    expect(first.liveWall.map((tile) => tile.id)).toEqual(second.liveWall.map((tile) => tile.id));
    expect(first.deadWall.map((tile) => tile.id)).toEqual(second.deadWall.map((tile) => tile.id));
    expect(first.liveWall.map((tile) => tile.id)).not.toEqual(third.liveWall.map((tile) => tile.id));
  });
});

describe('flower and season replacement', () => {
  it('stores flowers and seasons then recursively draws replacements from the dead wall', () => {
    const replacementTiles = tiles(['flower-plum', 'dots-1', 'season-spring']);
    const liveFlower = replacementTiles[0]!;
    const replacementTile = replacementTiles[1]!;
    const replacementSeason = replacementTiles[2]!;
    if (!liveFlower || !replacementTile || !replacementSeason) {
      throw new Error('Missing replacement test tiles');
    }
    const state = roundState({
      phase: 'awaitingDraw',
      currentTurn: 0,
      players: [emptyPlayer(0), emptyPlayer(1), emptyPlayer(2), emptyPlayer(3)],
      wall: wall([liveFlower], [replacementTile, replacementSeason])
    });

    const next = drawTile(state);
    const player = next.players[0];

    expect(next.phase).toBe('awaitingDiscard');
    expect(player?.flowers.map((tile) => tile.key)).toEqual(['flower-plum', 'season-spring']);
    expect(player?.concealedTiles.map((tile) => tile.key)).toEqual(['dots-1']);
    expect(next.lastDraw?.tile.key).toBe('dots-1');
    expect(next.lastDraw?.seatIndex).toBe(0);
    expect(next.lastDraw?.source).toBe('liveWall');
    expect(next.wall.deadWall).toHaveLength(0);
    expect(next.wall.replacementDraws.map((tile) => tile.key)).toEqual(['season-spring', 'dots-1']);
  });
});

describe('winning hand validation', () => {
  it('validates a standard four-sets-and-pair hand', () => {
    const hand = tiles([
      'dots-1',
      'dots-2',
      'dots-3',
      'bamboo-1',
      'bamboo-2',
      'bamboo-3',
      'characters-1',
      'characters-2',
      'characters-3',
      'east',
      'east',
      'east',
      'red',
      'red'
    ]);

    expect(validateWinningHand(hand)).toEqual({ isWin: true, kind: 'standard' });
  });

  it('validates Seven Pairs, Thirteen Orphans, Nine Gates, and practical flower wins', () => {
    expect(
      validateWinningHand(
        tiles(['dots-1', 'dots-1', 'dots-2', 'dots-2', 'dots-3', 'dots-3', 'dots-4', 'dots-4', 'dots-5', 'dots-5', 'dots-6', 'dots-6', 'dots-7', 'dots-7'])
      ).kind
    ).toBe('sevenPairs');

    expect(
      validateWinningHand(
        tiles(['dots-1', 'dots-9', 'bamboo-1', 'bamboo-9', 'characters-1', 'characters-9', 'east', 'south', 'west', 'north', 'red', 'green', 'white', 'red'])
      ).kind
    ).toBe('thirteenOrphans');

    expect(
      validateWinningHand(
        tiles(['dots-1', 'dots-1', 'dots-1', 'dots-2', 'dots-3', 'dots-4', 'dots-5', 'dots-5', 'dots-6', 'dots-7', 'dots-8', 'dots-9', 'dots-9', 'dots-9'])
      ).kind
    ).toBe('nineGates');

    expect(isFlowerWinningHand(tiles(['flower-plum', 'flower-orchid', 'flower-chrysanthemum', 'flower-bamboo']))).toBe(true);
  });
});

describe('legal actions and claim lifecycle', () => {
  it('generates legal Chow, Pong, and Kong claims for a discard', () => {
    const [discard, ...claimerTiles] = tiles([
      'dots-3',
      'dots-1',
      'dots-2',
      'dots-2',
      'dots-4',
      'dots-4',
      'dots-5',
      'dots-3',
      'dots-3',
      'dots-3'
    ]);
    if (!discard) {
      throw new Error('Missing discard tile');
    }
    const state = roundState({
      phase: 'awaitingClaims',
      players: [
        { ...emptyPlayer(0), discards: [discard] },
        emptyPlayer(1, claimerTiles),
        emptyPlayer(2),
        emptyPlayer(3)
      ],
      lastDiscard: { tile: discard, bySeat: 0, turnNumber: 1 }
    });

    const actions = getLegalActions(state, 1);

    expect(actions.filter((action) => action.type === 'chow')).toHaveLength(3);
    expect(actions.some((action) => action.type === 'pong')).toBe(true);
    expect(actions.some((action) => action.type === 'kong' && action.kongType === 'exposed')).toBe(true);
  });

  it('claims a Pong and transfers the turn to the claimer', () => {
    const [discard, first, second] = tiles(['dots-3', 'dots-3', 'dots-3']);
    if (!discard || !first || !second) {
      throw new Error('Missing claim tiles');
    }
    const state = roundState({
      phase: 'awaitingClaims',
      players: [
        { ...emptyPlayer(0), discards: [discard] },
        emptyPlayer(1, [first, second]),
        emptyPlayer(2),
        emptyPlayer(3)
      ],
      lastDiscard: { tile: discard, bySeat: 0, turnNumber: 1 }
    });
    const pong = getLegalActions(state, 1).find((action) => action.type === 'pong');
    if (!pong) {
      throw new Error('Expected Pong action');
    }

    const next = claimDiscard(state, 1, pong);

    expect(next.phase).toBe('awaitingDiscard');
    expect(next.currentTurn).toBe(1);
    expect(next.players[0]?.discards).toHaveLength(0);
    expect(next.players[1]?.concealedTiles).toHaveLength(0);
    expect(next.players[1]?.melds[0]?.kind).toBe('pong');
    expect(next.players[1]?.melds[0]?.tiles.map((tile) => tile.id)).toContain(discard.id);
  });

  it('passes an unclaimed discard to the next player draw', () => {
    const [tile] = tiles(['east']);
    if (!tile) {
      throw new Error('Missing tile');
    }
    const state = roundState({
      phase: 'awaitingClaims',
      currentTurn: 0,
      players: [{ ...emptyPlayer(0), discards: [tile] }, emptyPlayer(1), emptyPlayer(2), emptyPlayer(3)],
      lastDiscard: { tile, bySeat: 0, turnNumber: 1 }
    });

    const next = passClaimWindow(state);

    expect(next.phase).toBe('awaitingDraw');
    expect(next.currentTurn).toBe(1);
    expect(next.lastDiscard).toBeUndefined();
  });

  it('deals deterministic initial hands and opens on the dealer discard', () => {
    const first = createInitialRoundState({ seed: 'deal-seed' });
    const second = createInitialRoundState({ seed: 'deal-seed' });
    const dealer = first.players[first.dealerSeat];

    expect(first.phase).toBe('awaitingDiscard');
    expect(dealer?.concealedTiles).toHaveLength(14);
    expect(first.players.filter((player) => player.seatIndex !== first.dealerSeat).every((player) => player.concealedTiles.length === 13)).toBe(true);
    expect(first.players.map((player) => player.concealedTiles.map((tile) => tile.id))).toEqual(
      second.players.map((player) => player.concealedTiles.map((tile) => tile.id))
    );
  });

  it('opens a claim window after the current player discards', () => {
    const [tile] = tiles(['east']);
    if (!tile) {
      throw new Error('Missing tile');
    }
    const state = roundState({
      players: [emptyPlayer(0, [tile]), emptyPlayer(1), emptyPlayer(2), emptyPlayer(3)],
      lastDraw: { tile, seatIndex: 0, source: 'liveWall', turnNumber: 1 }
    });

    const next = discardTile(state, tile.id);

    expect(next.phase).toBe('awaitingClaims');
    expect(next.lastDiscard?.tile.id).toBe(tile.id);
    expect(next.lastDraw).toBeUndefined();
    expect(next.players[0]?.concealedTiles).toHaveLength(0);
    expect(next.players[0]?.discards.map((discard) => discard.id)).toEqual([tile.id]);
  });

  it('settles a winning hand with Fan, payment lines, score deltas, and winning tile', () => {
    const hand = tiles([
      'dots-1',
      'dots-1',
      'dots-1',
      'dots-2',
      'dots-2',
      'dots-2',
      'dots-3',
      'dots-3',
      'dots-3',
      'dots-4',
      'dots-4',
      'dots-4',
      'east',
      'east'
    ]);
    const winningTile = hand[hand.length - 1];
    if (!winningTile) {
      throw new Error('Missing winning tile');
    }
    const state = roundState({
      phase: 'awaitingDiscard',
      currentTurn: 1,
      dealerSeat: 0,
      players: [emptyPlayer(0), emptyPlayer(1, hand), emptyPlayer(2), emptyPlayer(3)],
      lastDraw: { tile: winningTile, seatIndex: 1, source: 'liveWall', turnNumber: 1 }
    });

    const next = declareSelfDrawWin(state);
    const settlement = next.conclusion?.settlement;

    expect(next.phase).toBe('finished');
    expect(next.lastDraw).toBeUndefined();
    expect(next.conclusion?.winningTile?.id).toBe(winningTile.id);
    expect(settlement?.fan).toBe(7);
    expect(settlement?.includedFeatures.map((feature) => feature.id)).toEqual(['no-bonus-tiles', 'all-pongs', 'mixed-one-suit']);
    expect(settlement?.paymentLines).toHaveLength(3);
    expect(settlement?.deltas.south).toBe(256);
    expect(next.players[1]?.score).toBe(256);
    expect(next.players[0]?.score).toBe(-128);
    expect(next.players[2]?.score).toBe(-64);
    expect(next.players[3]?.score).toBe(-64);
  });

  it('starts the next round while retaining dealer after dealer win or draw', () => {
    const dealerWin = roundState({
      phase: 'finished',
      dealerSeat: 2,
      windRoundStartDealerSeat: 2,
      prevailingWind: 'east',
      players: [emptyPlayer(0), emptyPlayer(1), { ...emptyPlayer(2), score: 32 }, emptyPlayer(3)],
      conclusion: { reason: 'win', winnerSeat: 2, source: 'selfDraw', message: 'Dealer wins.' }
    });
    const afterDealerWin = createNextRoundState(dealerWin, { seed: 'after-dealer-win' });

    expect(afterDealerWin.dealerSeat).toBe(2);
    expect(afterDealerWin.windRoundStartDealerSeat).toBe(2);
    expect(afterDealerWin.prevailingWind).toBe('east');
    expect(afterDealerWin.players[2]?.wind).toBe('east');
    expect(afterDealerWin.players[2]?.score).toBe(32);
    expect(afterDealerWin.players[2]?.concealedTiles).toHaveLength(14);

    const draw = roundState({
      phase: 'finished',
      dealerSeat: 1,
      windRoundStartDealerSeat: 0,
      prevailingWind: 'south',
      conclusion: { reason: 'exhaustiveDraw', message: 'Wall exhausted.' }
    });
    const afterDraw = createNextRoundState(draw, { seed: 'after-draw' });

    expect(afterDraw.dealerSeat).toBe(1);
    expect(afterDraw.windRoundStartDealerSeat).toBe(0);
    expect(afterDraw.prevailingWind).toBe('south');
  });

  it('rotates dealer after non-dealer wins and advances wind after every seat dealt once', () => {
    const southWindLastDealer = roundState({
      phase: 'finished',
      dealerSeat: 3,
      windRoundStartDealerSeat: 0,
      prevailingWind: 'east',
      players: [emptyPlayer(0), emptyPlayer(1), { ...emptyPlayer(2), score: 16 }, emptyPlayer(3)],
      conclusion: { reason: 'win', winnerSeat: 2, source: 'discard', message: 'Non-dealer wins.' }
    });
    const nextWindRound = createNextRoundState(southWindLastDealer, { seed: 'south-wind-start' });

    expect(nextWindRound.dealerSeat).toBe(0);
    expect(nextWindRound.windRoundStartDealerSeat).toBe(0);
    expect(nextWindRound.prevailingWind).toBe('south');
    expect(nextWindRound.players[0]?.wind).toBe('east');
    expect(nextWindRound.players[2]?.score).toBe(16);

    const nonZeroStartingDealer = roundState({
      phase: 'finished',
      dealerSeat: 1,
      windRoundStartDealerSeat: 2,
      prevailingWind: 'west',
      conclusion: { reason: 'win', winnerSeat: 0, source: 'discard', message: 'Non-dealer wins.' }
    });
    const beforeWrap = createNextRoundState(nonZeroStartingDealer, { seed: 'nonzero-before-wrap' });

    expect(beforeWrap.dealerSeat).toBe(2);
    expect(beforeWrap.windRoundStartDealerSeat).toBe(2);
    expect(beforeWrap.prevailingWind).toBe('north');
    expect(beforeWrap.players[2]?.wind).toBe('east');
  });
});
