import {
  DEFAULT_RULESET,
  createTileSet,
  declareSelfDrawWin,
  getLegalActions,
  type LegalAction,
  type Meld,
  type PlayerState,
  type RoundState,
  type Tile,
  type TileKey,
  type WallState
} from '@hongkong-mahjong/game-engine';
import { describe, expect, it } from 'vitest';
import { RoomManager } from './room-manager.js';

function firstDiscard(actions: readonly LegalAction[]): LegalAction {
  const action = actions.find((candidate) => candidate.type === 'discard');
  if (!action) {
    throw new Error('Expected discard action');
  }
  return action;
}

const WINDS = ['east', 'south', 'west', 'north'] as const;

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

function emptyPlayer(seatIndex: number, concealedTiles: readonly Tile[] = [], discards: readonly Tile[] = [], melds: readonly Meld[] = []): PlayerState {
  const wind = WINDS[seatIndex];
  if (!wind) {
    throw new Error(`Invalid seat ${seatIndex}`);
  }
  return {
    seatIndex,
    wind,
    controller: 'human',
    displayName: `P${seatIndex}`,
    score: 0,
    concealedTiles,
    flowers: [],
    melds,
    discards
  };
}

function wall(liveWall: readonly Tile[] = [], deadWall: readonly Tile[] = []): WallState {
  return { seed: 'room-manager-test', liveWall, deadWall, replacementDraws: [] };
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

function pongMeld(tileKey: TileKey, pongTiles = tiles([tileKey, tileKey, tileKey])): Meld {
  const claimedTile = pongTiles[0];
  if (!claimedTile) {
    throw new Error(`Missing pong tile for ${tileKey}`);
  }
  return {
    id: `pong-${tileKey}`,
    kind: 'pong',
    tiles: pongTiles,
    claimedTileId: claimedTile.id,
    fromSeat: 3
  };
}

async function submitPreparedHumanAction(
  state: RoundState,
  seatIndex: number,
  actionPredicate: (action: LegalAction) => boolean
): Promise<RoundState> {
  const manager = new RoomManager();
  const created = await manager.createRoom('legal-action-parity');
  const claimed = await manager.claimSeat(created.room.roomCode, seatIndex, created.claimLinks[seatIndex]!.token, `Human ${seatIndex}`);
  const prepared = {
    ...claimed.room,
    version: 10,
    roundState: state,
    pendingClaimPasses: []
  };
  await manager.repository.save(prepared);
  const action = getLegalActions(state, seatIndex).find(actionPredicate);
  expect(action, `missing action for seat ${seatIndex}`).toBeDefined();
  if (!action) {
    throw new Error(`Expected legal action for seat ${seatIndex}`);
  }

  const accepted = await manager.submitHumanAction(prepared.roomCode.toLowerCase(), seatIndex, claimed.sessionToken, prepared.version, action);
  expect(accepted.ok).toBe(true);
  if (!accepted.ok) {
    throw new Error(accepted.message);
  }
  return accepted.room.roundState;
}

describe('RoomManager realtime room lifecycle', () => {
  it('creates rooms with four AI seats and private claim links', async () => {
    const manager = new RoomManager({ publicBaseUrl: 'http://lan-host:8787' });

    const result = await manager.createRoom('room-create-test');

    expect(result.room.roomCode).toMatch(/^[A-Z2-9]{6}$/);
    expect(result.room.seats).toHaveLength(4);
    expect(result.room.seats.every((seat) => seat.controller === 'ai')).toBe(true);
    expect(result.claimLinks).toHaveLength(4);
    expect(new Set(result.claimLinks.map((link) => link.token)).size).toBe(4);
    expect(result.claimLinks[0]?.url).toContain('/claim?room=');
    expect(manager.createSnapshot(result.room).seats.every((seat) => seat.claimed === false)).toBe(true);
  });

  it('claims a private seat token and turns the AI seat into a human seat', async () => {
    const manager = new RoomManager();
    const created = await manager.createRoom('claim-test');
    const claim = created.claimLinks[1]!;

    await expect(manager.claimSeat(created.room.roomCode, 1, 'bad-token')).rejects.toThrow('Invalid private seat claim token');

    const claimed = await manager.claimSeat(created.room.roomCode, 1, claim.token, 'Kara');
    const snapshot = manager.createSnapshot(claimed.room, 1);

    expect(claimed.sessionToken).toHaveLength(32);
    expect(snapshot.seats[1]).toMatchObject({ controller: 'human', displayName: 'Kara', claimed: true });
    expect(snapshot.viewerSeatIndex).toBe(1);
    expect(snapshot.round.players[1]?.concealedTiles).toBeDefined();
    expect(snapshot.round.players[0]?.concealedTiles).toBeUndefined();
  });

  it('normalizes room codes and allows private claim-token takeover while invalidating the old session', async () => {
    const manager = new RoomManager();
    const created = await manager.createRoom('takeover-test');
    const link = created.claimLinks[2]!;
    const firstClaim = await manager.claimSeat(created.room.roomCode.toLowerCase(), 2, link.token, 'First');
    const secondClaim = await manager.claimSeat(created.room.roomCode, 2, link.token, 'Second');
    const action = firstDiscard(getLegalActions(secondClaim.room.roundState, secondClaim.room.roundState.currentTurn));

    expect(secondClaim.sessionToken).not.toBe(firstClaim.sessionToken);
    expect(manager.createSnapshot(secondClaim.room, 2).seats[2]).toMatchObject({ displayName: 'Second', claimed: true });
    await expect(manager.connectSeat(created.room.roomCode.toLowerCase(), 2, firstClaim.sessionToken)).rejects.toThrow('Unauthorized seat session');
    const oldSessionAction = await manager.submitHumanAction(secondClaim.room.roomCode, 2, firstClaim.sessionToken, secondClaim.room.version, action);
    expect(oldSessionAction).toMatchObject({ ok: false, code: 'unauthorized' });
  });

  it('rejects unauthorized and stale commands before accepting legal game-engine actions', async () => {
    const manager = new RoomManager();
    const created = await manager.createRoom('command-test');
    const claimed = await manager.claimSeat(created.room.roomCode, 0, created.claimLinks[0]!.token, 'Dealer');
    const room = claimed.room;
    const action = firstDiscard(getLegalActions(room.roundState, 0));

    const unauthorized = await manager.submitHumanAction(room.roomCode, 0, 'wrong-session', room.version, action);
    expect(unauthorized).toMatchObject({ ok: false, code: 'unauthorized' });

    const stale = await manager.submitHumanAction(room.roomCode, 0, claimed.sessionToken, room.version - 1, action);
    expect(stale).toMatchObject({ ok: false, code: 'stale_version' });

    const accepted = await manager.submitHumanAction(room.roomCode, 0, claimed.sessionToken, room.version, action);
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      throw new Error(accepted.message);
    }
    expect(accepted.room.version).toBe(room.version + 1);
    expect(accepted.room.roundState.phase).toBe('awaitingClaims');
  });

  it('accepts every legal action type a human can share with AI policies', async () => {
    const [drawTile] = tiles(['dots-1']);
    const [discard] = tiles(['east']);
    const [claimDiscardTile] = tiles(['dots-3']);
    const chowTiles = tiles(['dots-1', 'dots-2']);
    const pongTiles = tiles(['dots-3', 'dots-3']);
    const kongTiles = tiles(['dots-3', 'dots-3', 'dots-3']);
    const concealedKongTiles = tiles(['east', 'east', 'east', 'east']);
    const addedKongTiles = tiles(['dots-7', 'dots-7', 'dots-7', 'dots-7']);
    const addedKongTile = addedKongTiles[3]!;
    const winningSelfDraw = tiles([
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
    const discardWinTiles = tiles([
      'dots-1',
      'dots-2',
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
    const [winningDiscard] = tiles(['dots-3']);

    await expect(
      submitPreparedHumanAction(
        roundState({ phase: 'awaitingDraw', currentTurn: 0, players: [emptyPlayer(0), emptyPlayer(1), emptyPlayer(2), emptyPlayer(3)], wall: wall([drawTile!]) }),
        0,
        (action) => action.type === 'draw'
      )
    ).resolves.toMatchObject({ phase: 'awaitingDiscard' });

    await expect(
      submitPreparedHumanAction(
        roundState({ players: [emptyPlayer(0, [discard!]), emptyPlayer(1), emptyPlayer(2), emptyPlayer(3)] }),
        0,
        (action) => action.type === 'discard'
      )
    ).resolves.toMatchObject({ phase: 'awaitingClaims' });

    await expect(
      submitPreparedHumanAction(
        roundState({
          phase: 'awaitingClaims',
          players: [{ ...emptyPlayer(0), discards: [claimDiscardTile!] }, emptyPlayer(1), emptyPlayer(2), emptyPlayer(3)],
          lastDiscard: { tile: claimDiscardTile!, bySeat: 0, turnNumber: 1 }
        }),
        1,
        (action) => action.type === 'pass'
      )
    ).resolves.toMatchObject({ phase: 'awaitingClaims' });

    await expect(
      submitPreparedHumanAction(
        roundState({
          phase: 'awaitingClaims',
          players: [{ ...emptyPlayer(0), discards: [claimDiscardTile!] }, emptyPlayer(1, chowTiles), emptyPlayer(2), emptyPlayer(3)],
          lastDiscard: { tile: claimDiscardTile!, bySeat: 0, turnNumber: 1 }
        }),
        1,
        (action) => action.type === 'chow'
      )
    ).resolves.toMatchObject({ phase: 'awaitingDiscard', currentTurn: 1 });

    await expect(
      submitPreparedHumanAction(
        roundState({
          phase: 'awaitingClaims',
          players: [{ ...emptyPlayer(0), discards: [claimDiscardTile!] }, emptyPlayer(1, pongTiles), emptyPlayer(2), emptyPlayer(3)],
          lastDiscard: { tile: claimDiscardTile!, bySeat: 0, turnNumber: 1 }
        }),
        1,
        (action) => action.type === 'pong'
      )
    ).resolves.toMatchObject({ phase: 'awaitingDiscard', currentTurn: 1 });

    await expect(
      submitPreparedHumanAction(
        roundState({
          phase: 'awaitingClaims',
          players: [{ ...emptyPlayer(0), discards: [claimDiscardTile!] }, emptyPlayer(1, kongTiles), emptyPlayer(2), emptyPlayer(3)],
          lastDiscard: { tile: claimDiscardTile!, bySeat: 0, turnNumber: 1 }
        }),
        1,
        (action) => action.type === 'kong' && action.kongType === 'exposed'
      )
    ).resolves.toMatchObject({ phase: 'awaitingDiscard', currentTurn: 1 });

    await expect(
      submitPreparedHumanAction(
        roundState({ players: [emptyPlayer(0, concealedKongTiles), emptyPlayer(1), emptyPlayer(2), emptyPlayer(3)] }),
        0,
        (action) => action.type === 'kong' && action.kongType === 'concealed'
      )
    ).resolves.toMatchObject({ phase: 'awaitingDiscard' });

    await expect(
      submitPreparedHumanAction(
        roundState({ players: [emptyPlayer(0, [addedKongTile], [], [pongMeld('dots-7', addedKongTiles.slice(0, 3))]), emptyPlayer(1), emptyPlayer(2), emptyPlayer(3)] }),
        0,
        (action) => action.type === 'kong' && action.kongType === 'added'
      )
    ).resolves.toMatchObject({ phase: 'awaitingDiscard' });

    await expect(
      submitPreparedHumanAction(
        roundState({ players: [emptyPlayer(0, winningSelfDraw), emptyPlayer(1), emptyPlayer(2), emptyPlayer(3)] }),
        0,
        (action) => action.type === 'win' && action.source === 'selfDraw'
      )
    ).resolves.toMatchObject({ phase: 'finished', conclusion: { reason: 'win', source: 'selfDraw' } });

    await expect(
      submitPreparedHumanAction(
        roundState({
          phase: 'awaitingClaims',
          players: [{ ...emptyPlayer(0), discards: [winningDiscard!] }, emptyPlayer(1, discardWinTiles), emptyPlayer(2), emptyPlayer(3)],
          lastDiscard: { tile: winningDiscard!, bySeat: 0, turnNumber: 1 }
        }),
        1,
        (action) => action.type === 'win' && action.source === 'discard'
      )
    ).resolves.toMatchObject({ phase: 'finished', conclusion: { reason: 'win', source: 'discard' } });
  });

  it('reveals every concealed hand and settlement details after a win', async () => {
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
    const manager = new RoomManager();
    const created = await manager.createRoom('snapshot-win-reveal');
    const finished = declareSelfDrawWin(roundState({
      phase: 'awaitingDiscard',
      currentTurn: 1,
      players: [emptyPlayer(0, tiles(['red'])), emptyPlayer(1, hand), emptyPlayer(2, tiles(['green'])), emptyPlayer(3, tiles(['white']))],
      lastDraw: { tile: winningTile, seatIndex: 1, source: 'liveWall', turnNumber: 1 }
    }));

    const snapshot = manager.createSnapshot({ ...created.room, roundState: finished }, undefined);

    expect(snapshot.round.players.every((player) => player.concealedTiles && player.concealedTiles.length > 0)).toBe(true);
    expect(snapshot.round.conclusion?.winningTile?.id).toBe(winningTile.id);
    expect(snapshot.round.conclusion?.settlement?.fan).toBe(7);
    expect(snapshot.round.conclusion?.settlement?.paymentLines).toHaveLength(3);
  });

  it('accepts next-round commands after a finished round and updates seat winds', async () => {
    const manager = new RoomManager();
    const created = await manager.createRoom('next-round-room');
    const claimed = await manager.claimSeat(created.room.roomCode, 0, created.claimLinks[0]!.token, 'Host');
    const finished = roundState({
      phase: 'finished',
      dealerSeat: 3,
      windRoundStartDealerSeat: 0,
      prevailingWind: 'east',
      players: [emptyPlayer(0), emptyPlayer(1), { ...emptyPlayer(2), score: 24 }, emptyPlayer(3)],
      conclusion: { reason: 'win', winnerSeat: 2, source: 'discard', message: 'Non-dealer wins.' }
    });
    const prepared = {
      ...claimed.room,
      version: 20,
      roundState: finished,
      pendingClaimPasses: []
    };
    await manager.repository.save(prepared);

    const accepted = await manager.submitHumanAction(prepared.roomCode, 0, claimed.sessionToken, prepared.version, { type: 'nextRound' });

    expect(accepted.ok).toBe(true);
    if (!accepted.ok) {
      throw new Error(accepted.message);
    }
    expect(accepted.room.roundState.phase).toBe('awaitingDiscard');
    expect(accepted.room.roundState.dealerSeat).toBe(0);
    expect(accepted.room.roundState.prevailingWind).toBe('south');
    expect(accepted.room.roundState.players[2]?.score).toBe(24);
    expect(accepted.room.seats[0]?.wind).toBe('east');
    expect(accepted.room.seats[1]?.wind).toBe('south');
  });
});
