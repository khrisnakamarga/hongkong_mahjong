import {
  DEFAULT_RULESET,
  createTileSet,
  getLegalActions,
  type LegalAction,
  type PlayerState,
  type RoundState,
  type Tile,
  type TileKey,
  type WallState
} from '@hongkong-mahjong/game-engine';
import { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createServerApp } from './index.js';
import type { ServerMessage } from './types.js';

function listen(app: ReturnType<typeof createServerApp>): Promise<number> {
  return new Promise((resolve) => {
    app.server.listen(0, '127.0.0.1', () => {
      resolve((app.server.address() as AddressInfo).port);
    });
  });
}

function connect(url: string): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });
}

function connectAndWaitForMessage(url: string, predicate: (message: ServerMessage) => boolean): Promise<{ socket: WebSocket; message: ServerMessage }> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const timeout = setTimeout(() => {
      cleanup();
      socket.close();
      reject(new Error('Timed out waiting for initial WebSocket message'));
    }, 2_000);

    const onMessage = (data: WebSocket.RawData) => {
      const parsed = JSON.parse(data.toString()) as ServerMessage;
      if (predicate(parsed)) {
        cleanup();
        resolve({ socket, message: parsed });
      }
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    function cleanup() {
      clearTimeout(timeout);
      socket.off('message', onMessage);
      socket.off('error', onError);
    }

    socket.on('message', onMessage);
    socket.once('error', onError);
  });
}

function waitForMessage(socket: WebSocket, predicate: (message: ServerMessage) => boolean): Promise<ServerMessage> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for WebSocket message'));
    }, 2_000);

    const onMessage = (data: WebSocket.RawData) => {
      const parsed = JSON.parse(data.toString()) as ServerMessage;
      if (predicate(parsed)) {
        cleanup();
        resolve(parsed);
      }
    };

    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };

    function cleanup() {
      clearTimeout(timeout);
      socket.off('message', onMessage);
      socket.off('error', onError);
    }

    socket.on('message', onMessage);
    socket.on('error', onError);
  });
}

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

function emptyPlayer(seatIndex: number, concealedTiles: readonly Tile[] = [], discards: readonly Tile[] = []): PlayerState {
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
    melds: [],
    discards
  };
}

function wall(liveWall: readonly Tile[] = [], deadWall: readonly Tile[] = []): WallState {
  return { seed: 'realtime-test', liveWall, deadWall, replacementDraws: [] };
}

function roundState(overrides: Partial<RoundState>): RoundState {
  return {
    phase: 'awaitingClaims',
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

function claimWindowState(seatOneTiles: readonly Tile[], discard: Tile): RoundState {
  return roundState({
    players: [{ ...emptyPlayer(0), discards: [discard] }, emptyPlayer(1, seatOneTiles), emptyPlayer(2), emptyPlayer(3)],
    lastDiscard: { tile: discard, bySeat: 0, turnNumber: 1 }
  });
}

describe('WebSocket realtime protocol', () => {
  const apps: ReturnType<typeof createServerApp>[] = [];
  const sockets: WebSocket[] = [];

  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      socket.close();
    }
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('sends snapshots, rejects stale commands, and broadcasts accepted actions', async () => {
    const app = createServerApp();
    apps.push(app);
    const port = await listen(app);
    const created = await app.roomManager.createRoom('ws-test');
    const claimed = await app.roomManager.claimSeat(created.room.roomCode, 0, created.claimLinks[0]!.token, 'Dealer');
    const action = firstDiscard(getLegalActions(claimed.room.roundState, 0));

    const spectator = await connect(`ws://127.0.0.1:${port}/ws?room=${created.room.roomCode}`);
    const playerConnection = await connectAndWaitForMessage(
      `ws://127.0.0.1:${port}/ws?room=${created.room.roomCode}&seat=0&session=${claimed.sessionToken}`,
      (message) => message.type === 'snapshot'
    );
    const player = playerConnection.socket;
    sockets.push(spectator, player);

    const playerSnapshot = playerConnection.message;
    expect(playerSnapshot.type).toBe('snapshot');
    if (playerSnapshot.type !== 'snapshot') {
      throw new Error('Expected snapshot');
    }
    expect(playerSnapshot.payload.viewerSeatIndex).toBe(0);
    expect(playerSnapshot.payload.legalActions.some((candidate) => candidate.type === 'discard')).toBe(true);

    const stale = waitForMessage(player, (message) => message.type === 'error' && message.payload.code === 'stale_version');
    player.send(JSON.stringify({ type: 'command', id: 'stale', expectedVersion: playerSnapshot.payload.version - 1, action }));
    await expect(stale).resolves.toMatchObject({ type: 'error', id: 'stale' });

    const broadcast = waitForMessage(spectator, (message) => message.type === 'snapshot' && message.payload.version === playerSnapshot.payload.version + 1);
    const ack = waitForMessage(player, (message) => message.type === 'command_ack' && message.id === 'discard-1');
    player.send(JSON.stringify({ type: 'command', id: 'discard-1', expectedVersion: playerSnapshot.payload.version, action }));

    await expect(ack).resolves.toMatchObject({ type: 'command_ack', id: 'discard-1' });
    const spectatorSnapshot = await broadcast;
    expect(spectatorSnapshot.type).toBe('snapshot');
    if (spectatorSnapshot.type !== 'snapshot') {
      throw new Error('Expected snapshot broadcast');
    }
    expect(spectatorSnapshot.payload.round.phase).toBe('awaitingClaims');
  });

  it('sends action-required claim notifications for Chow, Pong, Kong, and Mahjong', async () => {
    const app = createServerApp();
    apps.push(app);
    const port = await listen(app);
    const cases: readonly { readonly name: string; readonly state: RoundState; readonly expectedType: LegalAction['type'] }[] = [
      {
        name: 'chow',
        state: claimWindowState(tiles(['dots-1', 'dots-2']), tiles(['dots-3'])[0]!),
        expectedType: 'chow'
      },
      {
        name: 'pong',
        state: claimWindowState(tiles(['dots-3', 'dots-3']), tiles(['dots-3'])[0]!),
        expectedType: 'pong'
      },
      {
        name: 'kong',
        state: claimWindowState(tiles(['dots-3', 'dots-3', 'dots-3']), tiles(['dots-3'])[0]!),
        expectedType: 'kong'
      },
      {
        name: 'mahjong',
        state: claimWindowState(
          tiles([
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
          ]),
          tiles(['dots-3'])[0]!
        ),
        expectedType: 'win'
      }
    ];

    for (const scenario of cases) {
      const created = await app.roomManager.createRoom(`notify-${scenario.name}`);
      const claimed = await app.roomManager.claimSeat(created.room.roomCode, 1, created.claimLinks[1]!.token, `Human ${scenario.name}`);
      const prepared = {
        ...claimed.room,
        version: claimed.room.version + 1,
        roundState: scenario.state,
        pendingClaimPasses: []
      };
      await app.roomManager.repository.save(prepared);

      const { socket, message } = await connectAndWaitForMessage(
        `ws://127.0.0.1:${port}/ws?room=${prepared.roomCode}&seat=1&session=${claimed.sessionToken}`,
        (candidate) => candidate.type === 'action_required'
      );
      sockets.push(socket);

      expect(message.type).toBe('action_required');
      if (message.type !== 'action_required') {
        throw new Error('Expected action_required message');
      }
      expect(message.payload.legalActions.some((action) => action.type === scenario.expectedType)).toBe(true);
    }
  });
});

