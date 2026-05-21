import type { Tile, TileId, TileKey, Wind } from './tiles.js';

export type SeatWind = Wind;
export type RoundPhase = 'awaitingDraw' | 'awaitingDiscard' | 'awaitingClaims' | 'finished';
export type SeatController = 'ai' | 'human';
export type MeldKind = 'chow' | 'pong' | 'exposedKong' | 'concealedKong' | 'addedKong';
export type WinSource = 'selfDraw' | 'discard' | 'flower';
export type RoundConclusionReason = 'win' | 'exhaustiveDraw' | 'aborted';

export const SEAT_WINDS = ['east', 'south', 'west', 'north'] as const satisfies readonly SeatWind[];

export interface Meld {
  readonly id: string;
  readonly kind: MeldKind;
  readonly tiles: readonly Tile[];
  readonly claimedTileId?: TileId;
  readonly fromSeat?: number;
  readonly concealed?: boolean;
}

export interface PlayerState {
  readonly seatIndex: number;
  readonly wind: SeatWind;
  readonly controller: SeatController;
  readonly displayName: string;
  readonly score: number;
  readonly concealedTiles: readonly Tile[];
  readonly flowers: readonly Tile[];
  readonly melds: readonly Meld[];
  readonly discards: readonly Tile[];
}

export interface WallState {
  readonly seed: string;
  readonly liveWall: readonly Tile[];
  readonly deadWall: readonly Tile[];
  readonly replacementDraws: readonly Tile[];
}

export interface LastDiscard {
  readonly tile: Tile;
  readonly bySeat: number;
  readonly turnNumber: number;
}

export interface LastDraw {
  readonly tile: Tile;
  readonly seatIndex: number;
  readonly source: 'liveWall' | 'replacement';
  readonly turnNumber: number;
}

export interface WinLegalityContext {
  readonly state: RoundState;
  readonly winnerSeat: number;
  readonly source: WinSource;
  readonly winningTile?: Tile;
}

export interface RoundRules {
  readonly name: string;
  readonly minFan: number;
  readonly playerCount: 4;
  readonly canDeclareWin?: (context: WinLegalityContext) => boolean;
}

export interface RoundConclusion {
  readonly reason: RoundConclusionReason;
  readonly winnerSeat?: number;
  readonly winningTile?: Tile;
  readonly source?: WinSource;
  readonly message: string;
  readonly settlement?: RoundSettlement;
}

export interface RoundFanFeature {
  readonly id: string;
  readonly name: string;
  readonly fan: number;
  readonly source?: string;
  readonly replacedBy?: string;
}

export interface RoundPaymentLine {
  readonly from: SeatWind;
  readonly to: SeatWind;
  readonly basePoints: number;
  readonly doublings: number;
  readonly points: number;
  readonly reasons: readonly string[];
}

export interface RoundSettlement {
  readonly fan: number;
  readonly minFan: number;
  readonly eligible: boolean;
  readonly basePoints: number;
  readonly includedFeatures: readonly RoundFanFeature[];
  readonly excludedFeatures: readonly RoundFanFeature[];
  readonly paymentLines: readonly RoundPaymentLine[];
  readonly deltas: Readonly<Record<SeatWind, number>>;
}

export interface RoundState {
  readonly phase: RoundPhase;
  readonly rules: RoundRules;
  readonly dealerSeat: number;
  readonly windRoundStartDealerSeat?: number;
  readonly prevailingWind: SeatWind;
  readonly currentTurn: number;
  readonly turnNumber: number;
  readonly players: readonly PlayerState[];
  readonly wall: WallState;
  readonly lastDiscard?: LastDiscard;
  readonly lastDraw?: LastDraw;
  readonly conclusion?: RoundConclusion;
}

export interface BootstrapSeat {
  readonly wind: SeatWind;
  readonly controller: SeatController;
  readonly displayName: string;
  readonly score: number;
}

export interface BootstrapRoomState {
  readonly roomCode: string;
  readonly phase: 'bootstrap';
  readonly ruleset: {
    readonly name: string;
    readonly minFan: number;
    readonly playerCount: 4;
  };
  readonly seats: readonly BootstrapSeat[];
}

export interface GameState {
  readonly rounds: readonly RoundState[];
  readonly currentRound: RoundState;
}

export function nextSeatIndex(seatIndex: number): number {
  return (seatIndex + 1) % 4;
}

export function assertSeatIndex(seatIndex: number): void {
  if (!Number.isInteger(seatIndex) || seatIndex < 0 || seatIndex > 3) {
    throw new Error(`Invalid seat index: ${seatIndex}`);
  }
}

export function getPlayer(state: RoundState, seatIndex: number): PlayerState {
  assertSeatIndex(seatIndex);
  const player = state.players[seatIndex];
  if (!player) {
    throw new Error(`Missing player at seat ${seatIndex}`);
  }
  return player;
}

export function replacePlayer(
  state: RoundState,
  seatIndex: number,
  updater: (player: PlayerState) => PlayerState
): readonly PlayerState[] {
  return state.players.map((player, index) => (index === seatIndex ? updater(player) : player));
}

export function findTilesByKey(tiles: readonly Tile[], key: TileKey, count: number): readonly Tile[] {
  const matches = tiles.filter((tile) => tile.key === key).slice(0, count);
  if (matches.length !== count) {
    throw new Error(`Expected ${count} tile(s) for ${key}, found ${matches.length}`);
  }
  return matches;
}

export function removeTileIds(tiles: readonly Tile[], tileIds: readonly TileId[]): readonly Tile[] {
  const remainingIds = [...tileIds];
  const result: Tile[] = [];
  for (const tile of tiles) {
    const index = remainingIds.indexOf(tile.id);
    if (index >= 0) {
      remainingIds.splice(index, 1);
    } else {
      result.push(tile);
    }
  }
  if (remainingIds.length > 0) {
    throw new Error(`Tile(s) not found: ${remainingIds.join(', ')}`);
  }
  return result;
}
