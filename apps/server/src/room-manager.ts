import { randomBytes, createHash } from 'node:crypto';
import {
  claimDiscard,
  createInitialRoundState,
  createNextRoundState,
  declareKong,
  declareSelfDrawWin,
  discardTile,
  drawTile,
  getLegalActions,
  passClaimWindow,
  type LegalAction,
  type RoundState
} from '@hongkong-mahjong/game-engine';
import { InMemoryCoordinationAdapter, InMemoryRoomRepository, type CoordinationAdapter, type RoomRepository } from './adapters.js';
import type {
  ClaimSeatResult,
  CreateRoomResult,
  PublicPlayerSnapshot,
  RoomEvent,
  RoomRecord,
  RoomSeatRecord,
  RoomSnapshot,
  SubmitActionResult
} from './types.js';

export interface AiActionContext {
  readonly roomCode: string;
  readonly seatIndex: number;
  readonly roomVersion: number;
  readonly legalActions: readonly LegalAction[];
  submitAction(action: LegalAction): Promise<SubmitActionResult>;
}

export interface AiController {
  scheduleAction(context: AiActionContext): void | Promise<void>;
}

export class NoopAiController implements AiController {
  scheduleAction(): void {
    // Intentionally empty: production AI can plug in through AiController.
  }
}

export interface RoomManagerOptions {
  readonly repository?: RoomRepository;
  readonly coordination?: CoordinationAdapter;
  readonly publicBaseUrl?: string;
  readonly aiController?: AiController;
}

const ROOM_CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function nowIso(): string {
  return new Date().toISOString();
}

function randomToken(): string {
  return randomBytes(24).toString('base64url');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('base64url');
}

function normalizeRoomCode(roomCode: string): string {
  return roomCode.trim().toUpperCase();
}

function createRoomCode(): string {
  let code = '';
  for (let index = 0; index < 6; index += 1) {
    code += ROOM_CODE_ALPHABET[randomBytes(1)[0]! % ROOM_CODE_ALPHABET.length];
  }
  return code;
}

function ensureSeat(seatIndex: number): void {
  if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex > 3) {
    throw new Error(`Invalid seat index: ${seatIndex}`);
  }
}

function actionMatches(requested: LegalAction, legal: LegalAction): boolean {
  return requested.type === legal.type && JSON.stringify(requested) === JSON.stringify(legal);
}

function isLegalAction(value: unknown): value is LegalAction {
  return typeof value === 'object' && value !== null && 'type' in value && typeof (value as { type: unknown }).type === 'string';
}

function updateRoundPlayerIdentity(state: RoundState, seat: RoomSeatRecord): RoundState {
  return {
    ...state,
    players: state.players.map((player, index) =>
      index === seat.seatIndex
        ? {
            ...player,
            controller: seat.controller,
            displayName: seat.displayName
          }
        : player
    )
  };
}

function publicPlayers(state: RoundState, viewerSeatIndex?: number): readonly PublicPlayerSnapshot[] {
  const revealAllHands = state.phase === 'finished';
  return state.players.map((player) => ({
    seatIndex: player.seatIndex,
    wind: player.wind,
    controller: player.controller,
    displayName: player.displayName,
    score: player.score,
    concealedCount: player.concealedTiles.length,
    ...(revealAllHands || viewerSeatIndex === player.seatIndex ? { concealedTiles: player.concealedTiles } : {}),
    flowers: player.flowers,
    melds: player.melds,
    discards: player.discards
  }));
}

function isSessionAuthorized(seat: RoomSeatRecord, sessionToken: string): boolean {
  return seat.controller === 'human' && seat.sessionTokenHash === hashToken(sessionToken);
}

export class RoomManager {
  readonly repository: RoomRepository;
  readonly coordination: CoordinationAdapter;
  private readonly publicBaseUrl: string;
  private readonly aiController: AiController;

  constructor(options: RoomManagerOptions = {}) {
    this.repository = options.repository ?? new InMemoryRoomRepository();
    this.coordination = options.coordination ?? new InMemoryCoordinationAdapter();
    this.publicBaseUrl = options.publicBaseUrl ?? 'http://127.0.0.1:8787';
    this.aiController = options.aiController ?? new NoopAiController();
  }

  async createRoom(seed?: string): Promise<CreateRoomResult> {
    let roomCode = createRoomCode();
    while (await this.repository.get(roomCode)) {
      roomCode = createRoomCode();
    }

    const claimTokens = [randomToken(), randomToken(), randomToken(), randomToken()] as const;
    const createdAt = nowIso();
    const roundState = createInitialRoundState({ seed: seed ?? roomCode });
    const seats: readonly RoomSeatRecord[] = roundState.players.map((player, seatIndex) => ({
      seatIndex,
      wind: player.wind,
      controller: 'ai',
      displayName: `AI ${seatIndex + 1}`,
      claimTokenHash: hashToken(claimTokens[seatIndex]!),
      connected: false
    }));
    const room: RoomRecord = {
      roomCode,
      version: 1,
      createdAt,
      updatedAt: createdAt,
      seats,
      roundState,
      pendingClaimPasses: []
    };
    await this.repository.save(room);
    await this.scheduleAiForRoom(room);

    return {
      room,
      claimLinks: claimTokens.map((token, seatIndex) => ({
        seatIndex,
        token,
        url: `${this.publicBaseUrl}/claim?room=${encodeURIComponent(roomCode)}&seat=${seatIndex}&token=${encodeURIComponent(token)}`
      }))
    };
  }

  async getRoom(roomCode: string): Promise<RoomRecord | undefined> {
    return this.repository.get(normalizeRoomCode(roomCode));
  }

  async listRooms(): Promise<readonly RoomRecord[]> {
    return this.repository.list();
  }

  createSnapshot(room: RoomRecord, viewerSeatIndex?: number): RoomSnapshot {
    const legalActions = viewerSeatIndex === undefined ? [] : getLegalActions(room.roundState, viewerSeatIndex);
    return {
      roomCode: room.roomCode,
      version: room.version,
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
      seats: room.seats.map((seat) => ({
        seatIndex: seat.seatIndex,
        wind: seat.wind,
        controller: seat.controller,
        displayName: seat.displayName,
        claimed: seat.controller === 'human',
        connected: seat.connected
      })),
      round: {
        phase: room.roundState.phase,
        rules: room.roundState.rules,
        dealerSeat: room.roundState.dealerSeat,
        prevailingWind: room.roundState.prevailingWind,
        currentTurn: room.roundState.currentTurn,
        turnNumber: room.roundState.turnNumber,
        players: publicPlayers(room.roundState, viewerSeatIndex),
        wall: {
          liveCount: room.roundState.wall.liveWall.length,
          deadCount: room.roundState.wall.deadWall.length,
          replacementDrawCount: room.roundState.wall.replacementDraws.length
        },
        ...(room.roundState.lastDiscard ? { lastDiscard: room.roundState.lastDiscard } : {}),
        ...(room.roundState.lastDraw ? { lastDraw: room.roundState.lastDraw } : {}),
        ...(room.roundState.conclusion ? { conclusion: room.roundState.conclusion } : {})
      },
      ...(viewerSeatIndex !== undefined ? { viewerSeatIndex } : {}),
      legalActions
    };
  }

  async claimSeat(roomCode: string, seatIndex: number, claimToken: string, displayName = `Player ${seatIndex + 1}`): Promise<ClaimSeatResult> {
    ensureSeat(seatIndex);
    const normalized = normalizeRoomCode(roomCode);
    const result = await this.coordination.withRoomLock(normalized, async () => {
      const room = await this.repository.get(normalized);
      if (!room) {
        throw new Error(`Room ${normalized} not found.`);
      }
      const seat = room.seats[seatIndex];
      if (!seat || seat.claimTokenHash !== hashToken(claimToken)) {
        throw new Error('Invalid private seat claim token.');
      }
      const sessionToken = randomToken();
      const updatedSeat: RoomSeatRecord = {
        ...seat,
        controller: 'human',
        displayName: displayName.trim() || `Player ${seatIndex + 1}`,
        sessionTokenHash: hashToken(sessionToken),
        claimedAt: nowIso(),
        connected: false
      };
      const seats = room.seats.map((candidate, index) => (index === seatIndex ? updatedSeat : candidate));
      const nextRoom: RoomRecord = {
        ...room,
        version: room.version + 1,
        updatedAt: nowIso(),
        seats,
        roundState: updateRoundPlayerIdentity(room.roundState, updatedSeat)
      };
      await this.repository.save(nextRoom);
      return { room: nextRoom, sessionToken } satisfies ClaimSeatResult;
    });

    await this.publish({ type: 'seat_claimed', roomCode: normalized, version: result.room.version, seatIndex, message: `Seat ${seatIndex} claimed.` });
    await this.publish({ type: 'room_updated', roomCode: normalized, version: result.room.version, message: 'Room state updated.' });
    return result;
  }

  async connectSeat(roomCode: string, seatIndex?: number, sessionToken?: string): Promise<{ room: RoomRecord; viewerSeatIndex?: number }> {
    const normalized = normalizeRoomCode(roomCode);
    if (seatIndex === undefined || sessionToken === undefined) {
      const room = await this.repository.get(normalized);
      if (!room) {
        throw new Error(`Room ${normalized} not found.`);
      }
      return { room };
    }

    ensureSeat(seatIndex);
    return this.coordination.withRoomLock(normalized, async () => {
      const room = await this.repository.get(normalized);
      if (!room) {
        throw new Error(`Room ${normalized} not found.`);
      }
      const seat = room.seats[seatIndex];
      if (!seat || !isSessionAuthorized(seat, sessionToken)) {
        throw new Error('Unauthorized seat session.');
      }
      const updatedSeat: RoomSeatRecord = { ...seat, connected: true, lastSeenAt: nowIso() };
      const nextRoom: RoomRecord = {
        ...room,
        updatedAt: nowIso(),
        seats: room.seats.map((candidate, index) => (index === seatIndex ? updatedSeat : candidate))
      };
      await this.repository.save(nextRoom);
      await this.publish({ type: 'room_updated', roomCode: normalized, version: nextRoom.version, seatIndex, message: `Seat ${seatIndex} connected.` });
      return { room: nextRoom, viewerSeatIndex: seatIndex };
    });
  }

  async disconnectSeat(roomCode: string, seatIndex?: number, sessionToken?: string): Promise<void> {
    if (seatIndex === undefined || sessionToken === undefined) {
      return;
    }
    ensureSeat(seatIndex);
    const normalized = normalizeRoomCode(roomCode);
    await this.coordination.withRoomLock(normalized, async () => {
      const room = await this.repository.get(normalized);
      const seat = room?.seats[seatIndex];
      if (!room || !seat || !isSessionAuthorized(seat, sessionToken)) {
        return;
      }
      const updatedSeat: RoomSeatRecord = { ...seat, connected: false, lastSeenAt: nowIso() };
      const nextRoom: RoomRecord = {
        ...room,
        updatedAt: nowIso(),
        seats: room.seats.map((candidate, index) => (index === seatIndex ? updatedSeat : candidate))
      };
      await this.repository.save(nextRoom);
      await this.publish({ type: 'room_updated', roomCode: normalized, version: nextRoom.version, seatIndex, message: `Seat ${seatIndex} disconnected.` });
    });
  }

  async submitHumanAction(roomCode: string, seatIndex: number | undefined, sessionToken: string | undefined, expectedVersion: number, action: unknown): Promise<SubmitActionResult> {
    if (seatIndex === undefined || sessionToken === undefined) {
      return { ok: false, code: 'unauthorized', message: 'Command requires an authenticated claimed seat.' };
    }
    ensureSeat(seatIndex);
    return this.submitSeatAction({ roomCode, seatIndex, sessionToken, expectedVersion, action, actor: 'human' });
  }

  private async submitAiAction(roomCode: string, seatIndex: number, expectedVersion: number, action: LegalAction): Promise<SubmitActionResult> {
    ensureSeat(seatIndex);
    return this.submitSeatAction({ roomCode, seatIndex, expectedVersion, action, actor: 'ai' });
  }

  private async submitSeatAction(input: {
    readonly roomCode: string;
    readonly seatIndex: number;
    readonly sessionToken?: string;
    readonly expectedVersion: number;
    readonly action: unknown;
    readonly actor: 'human' | 'ai';
  }): Promise<SubmitActionResult> {
    const normalized = normalizeRoomCode(input.roomCode);
    const result = await this.coordination.withRoomLock(normalized, async () => {
      const room = await this.repository.get(normalized);
      if (!room) {
        return { ok: false, code: 'not_found', message: `Room ${normalized} not found.` } satisfies SubmitActionResult;
      }
      const seat = room.seats[input.seatIndex];
      if (!seat) {
        return { ok: false, code: 'unauthorized', message: 'Invalid seat.', room } satisfies SubmitActionResult;
      }
      if (input.actor === 'human' && (!input.sessionToken || !isSessionAuthorized(seat, input.sessionToken))) {
        return { ok: false, code: 'unauthorized', message: 'Unauthorized seat session.', room } satisfies SubmitActionResult;
      }
      if (input.actor === 'ai' && seat.controller !== 'ai') {
        return { ok: false, code: 'unauthorized', message: 'AI hook cannot act for a human seat.', room } satisfies SubmitActionResult;
      }
      if (input.expectedVersion !== room.version) {
        return { ok: false, code: 'stale_version', message: `Expected version ${room.version}, received ${input.expectedVersion}.`, room } satisfies SubmitActionResult;
      }
      const action = input.action;
      if (!isLegalAction(action)) {
        return { ok: false, code: 'invalid_action', message: 'Command action is malformed.', room } satisfies SubmitActionResult;
      }

      const legalActions = getLegalActions(room.roundState, input.seatIndex);
      if (!legalActions.some((candidate) => actionMatches(action, candidate))) {
        return { ok: false, code: 'illegal_action', message: `Illegal ${action.type} for seat ${input.seatIndex}.`, room } satisfies SubmitActionResult;
      }

      const nextRound = this.applyLegalAction(room, input.seatIndex, action);
      const seats = room.seats.map((seat) => ({
        ...seat,
        wind: nextRound.players[seat.seatIndex]?.wind ?? seat.wind
      }));
      const pendingClaimPasses = nextRound.phase === 'awaitingClaims'
        ? action.type === 'pass'
          ? [...new Set([...room.pendingClaimPasses, input.seatIndex])]
          : []
        : [];
      const nextRoom: RoomRecord = {
        ...room,
        version: room.version + 1,
        updatedAt: nowIso(),
        seats,
        roundState: nextRound,
        pendingClaimPasses
      };
      await this.repository.save(nextRoom);
      return { ok: true, room: nextRoom } satisfies SubmitActionResult;
    });

    if (result.ok) {
      await this.publish({ type: 'action_accepted', roomCode: normalized, version: result.room.version, seatIndex: input.seatIndex, message: `Seat ${input.seatIndex} ${isLegalAction(input.action) ? input.action.type : 'action'} accepted.` });
      await this.publish({ type: 'room_updated', roomCode: normalized, version: result.room.version, message: 'Room state updated.' });
      await this.scheduleAiForRoom(result.room);
    } else {
      await this.publish({ type: 'action_rejected', roomCode: normalized, version: result.room?.version ?? input.expectedVersion, seatIndex: input.seatIndex, message: result.message });
    }
    return result;
  }

  private applyLegalAction(room: RoomRecord, seatIndex: number, action: LegalAction): RoundState {
    if (action.type === 'nextRound') {
      return createNextRoundState(room.roundState);
    }
    if (action.type === 'draw') {
      return drawTile(room.roundState, seatIndex);
    }
    if (action.type === 'discard') {
      return discardTile(room.roundState, action.tileId);
    }
    if (action.type === 'pass') {
      const discardSeat = room.roundState.lastDiscard?.bySeat;
      const passers = new Set([...room.pendingClaimPasses, seatIndex]);
      const allClaimersPassed = room.roundState.phase === 'awaitingClaims'
        && discardSeat !== undefined
        && [0, 1, 2, 3].filter((candidate) => candidate !== discardSeat).every((candidate) => passers.has(candidate));
      return allClaimersPassed ? passClaimWindow(room.roundState) : room.roundState;
    }
    if (action.type === 'win') {
      return action.source === 'discard' ? claimDiscard(room.roundState, seatIndex, action) : declareSelfDrawWin(room.roundState);
    }
    if (action.type === 'kong' && action.kongType !== 'exposed') {
      return declareKong(room.roundState, action.tileKey, action.kongType === 'added' ? action.meldId : undefined);
    }
    return claimDiscard(room.roundState, seatIndex, action);
  }

  private async scheduleAiForRoom(room: RoomRecord): Promise<void> {
    if (room.roundState.phase === 'finished') {
      return;
    }
    for (const seat of room.seats) {
      if (seat.controller !== 'ai') {
        continue;
      }
      const legalActions = getLegalActions(room.roundState, seat.seatIndex);
      if (legalActions.length === 0) {
        continue;
      }
      await this.aiController.scheduleAction({
        roomCode: room.roomCode,
        seatIndex: seat.seatIndex,
        roomVersion: room.version,
        legalActions,
        submitAction: (action) => this.submitAiAction(room.roomCode, seat.seatIndex, room.version, action)
      });
    }
  }

  private async publish(event: RoomEvent): Promise<void> {
    await this.coordination.publish(event);
  }
}

