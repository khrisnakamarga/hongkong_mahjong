import { DEFAULT_HONG_KONG_RULES, type HongKongMahjongRules, type PaymentBand } from './rules.js';
import type { SeatWind } from './state.js';

export type WinType = 'discard' | 'self-pick';

export interface PaymentCalculationInput {
  readonly fan: number;
  readonly winner: SeatWind;
  readonly winType: WinType;
  readonly discarder?: SeatWind;
  readonly eastSeat?: SeatWind;
  readonly players?: readonly SeatWind[];
}

export interface PaymentLine {
  readonly from: SeatWind;
  readonly to: SeatWind;
  readonly basePoints: number;
  readonly doublings: number;
  readonly points: number;
  readonly reasons: readonly string[];
}

export interface PaymentResult {
  readonly fan: number;
  readonly minFan: number;
  readonly eligible: boolean;
  readonly basePoints: number;
  readonly lines: readonly PaymentLine[];
  readonly deltas: Readonly<Record<SeatWind, number>>;
}

export const DEFAULT_SEATS: readonly SeatWind[] = ['east', 'south', 'west', 'north'] as const;

export function lookupBasePayment(
  fan: number,
  paymentTable: readonly PaymentBand[] = DEFAULT_HONG_KONG_RULES.paymentTable
): number {
  const normalizedFan = Math.max(0, Math.floor(fan));
  const band = paymentTable.find((entry) => {
    const maxFan = entry.maxFan ?? Number.POSITIVE_INFINITY;
    return normalizedFan >= entry.minFan && normalizedFan <= maxFan;
  });

  if (!band) {
    throw new Error(`No payment table entry matches ${normalizedFan} Fan.`);
  }

  return band.points;
}

export function meetsMinimumFan(fan: number, rules: HongKongMahjongRules = DEFAULT_HONG_KONG_RULES): boolean {
  return fan >= rules.minFan;
}

export function calculatePayments(
  input: PaymentCalculationInput,
  rules: HongKongMahjongRules = DEFAULT_HONG_KONG_RULES
): PaymentResult {
  const players = input.players ?? DEFAULT_SEATS;
  const eastSeat = input.eastSeat ?? 'east';
  const basePoints = lookupBasePayment(input.fan, rules.paymentTable);
  const deltas = createEmptyDeltas(players);

  if (!meetsMinimumFan(input.fan, rules)) {
    return {
      fan: input.fan,
      minFan: rules.minFan,
      eligible: false,
      basePoints,
      lines: [],
      deltas
    };
  }

  const payers = getPayers(input, players);
  const lines = payers.map((payer) => {
    const reasons: string[] = [];
    let doublings = 0;

    if (input.winType === 'discard') {
      doublings += 1;
      reasons.push('discarder pays double');
    } else {
      doublings += 1;
      reasons.push('self-pick pays double');
    }

    if (input.winner === eastSeat) {
      doublings += 1;
      reasons.push('East winner doubles all payments');
    }

    if (payer === eastSeat) {
      doublings += 1;
      reasons.push('East payer losing doubles payment');
    }

    const points = basePoints * 2 ** doublings;
    deltas[payer] -= points;
    deltas[input.winner] += points;

    return {
      from: payer,
      to: input.winner,
      basePoints,
      doublings,
      points,
      reasons
    };
  });

  return {
    fan: input.fan,
    minFan: rules.minFan,
    eligible: true,
    basePoints,
    lines,
    deltas
  };
}

function getPayers(input: PaymentCalculationInput, players: readonly SeatWind[]): readonly SeatWind[] {
  if (input.winType === 'discard') {
    if (!input.discarder) {
      throw new Error('Discard wins require a discarder.');
    }

    if (input.discarder === input.winner) {
      throw new Error('Winner cannot pay their own discard win.');
    }

    return [input.discarder];
  }

  return players.filter((player) => player !== input.winner);
}

function createEmptyDeltas(players: readonly SeatWind[]): Record<SeatWind, number> {
  const deltas: Record<SeatWind, number> = {
    east: 0,
    south: 0,
    west: 0,
    north: 0
  };

  for (const player of players) {
    deltas[player] = 0;
  }

  return deltas;
}

