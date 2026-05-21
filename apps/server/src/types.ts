import type { LegalAction, RoundState, SeatWind } from '@hongkong-mahjong/game-engine';

export type RoomCode = string;
export type SeatSessionToken = string;
export type ClaimToken = string;

export interface RoomSeatRecord {
  readonly seatIndex: number;
  readonly wind: SeatWind;
  readonly controller: 'ai' | 'human';
  readonly displayName: string;
  readonly claimTokenHash: string;
  readonly sessionTokenHash?: string;
  readonly claimedAt?: string;
  readonly connected: boolean;
  readonly lastSeenAt?: string;
}

export interface RoomRecord {
  readonly roomCode: RoomCode;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly seats: readonly RoomSeatRecord[];
  readonly roundState: RoundState;
  readonly pendingClaimPasses: readonly number[];
}

export interface ClaimLink {
  readonly seatIndex: number;
  readonly token: ClaimToken;
  readonly url: string;
}

export interface CreateRoomResult {
  readonly room: RoomRecord;
  readonly claimLinks: readonly ClaimLink[];
}

export interface ClaimSeatResult {
  readonly room: RoomRecord;
  readonly sessionToken: SeatSessionToken;
}

export interface PublicSeatSnapshot {
  readonly seatIndex: number;
  readonly wind: SeatWind;
  readonly controller: 'ai' | 'human';
  readonly displayName: string;
  readonly claimed: boolean;
  readonly connected: boolean;
}

export interface PublicPlayerSnapshot {
  readonly seatIndex: number;
  readonly wind: SeatWind;
  readonly controller: 'ai' | 'human';
  readonly displayName: string;
  readonly score: number;
  readonly concealedCount: number;
  readonly concealedTiles?: RoundState['players'][number]['concealedTiles'];
  readonly flowers: RoundState['players'][number]['flowers'];
  readonly melds: RoundState['players'][number]['melds'];
  readonly discards: RoundState['players'][number]['discards'];
}

export interface PublicWallSnapshot {
  readonly liveCount: number;
  readonly deadCount: number;
  readonly replacementDrawCount: number;
}

export interface PublicRoundSnapshot {
  readonly phase: RoundState['phase'];
  readonly rules: RoundState['rules'];
  readonly dealerSeat: RoundState['dealerSeat'];
  readonly prevailingWind: RoundState['prevailingWind'];
  readonly currentTurn: RoundState['currentTurn'];
  readonly turnNumber: RoundState['turnNumber'];
  readonly players: readonly PublicPlayerSnapshot[];
  readonly wall: PublicWallSnapshot;
  readonly lastDiscard?: RoundState['lastDiscard'];
  readonly lastDraw?: RoundState['lastDraw'];
  readonly conclusion?: RoundState['conclusion'];
}

export interface RoomSnapshot {
  readonly roomCode: RoomCode;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly seats: readonly PublicSeatSnapshot[];
  readonly round: PublicRoundSnapshot;
  readonly viewerSeatIndex?: number;
  readonly legalActions: readonly LegalAction[];
}

export type ClientMessage =
  | { readonly type: 'ping'; readonly id?: string }
  | { readonly type: 'join'; readonly roomCode: string; readonly seatIndex?: number; readonly sessionToken?: string }
  | {
      readonly type: 'command';
      readonly id?: string;
      readonly expectedVersion: number;
      readonly action: LegalAction;
    };

export type ServerMessage =
  | { readonly type: 'snapshot'; readonly payload: RoomSnapshot }
  | { readonly type: 'action_required'; readonly payload: { readonly roomCode: string; readonly seatIndex: number; readonly version: number; readonly legalActions: readonly LegalAction[] } }
  | { readonly type: 'notification'; readonly payload: RoomEvent }
  | { readonly type: 'command_ack'; readonly id?: string; readonly payload: { readonly roomCode: string; readonly version: number } }
  | { readonly type: 'error'; readonly id?: string; readonly payload: { readonly code: string; readonly message: string } }
  | { readonly type: 'pong'; readonly id?: string };

export type RoomEventType = 'room_updated' | 'seat_claimed' | 'action_accepted' | 'action_rejected';

export interface RoomEvent {
  readonly type: RoomEventType;
  readonly roomCode: string;
  readonly version: number;
  readonly seatIndex?: number;
  readonly message: string;
}

export interface SubmitActionSuccess {
  readonly ok: true;
  readonly room: RoomRecord;
}

export interface SubmitActionFailure {
  readonly ok: false;
  readonly code: 'not_found' | 'unauthorized' | 'stale_version' | 'illegal_action' | 'invalid_action';
  readonly message: string;
  readonly room?: RoomRecord;
}

export type SubmitActionResult = SubmitActionSuccess | SubmitActionFailure;
