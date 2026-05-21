import { describe, expect, it } from 'vitest';
import {
  calculatePayments,
  createHongKongMahjongRules,
  dragonTile,
  flower,
  kong,
  lookupBasePayment,
  pair,
  pong,
  scoreHand,
  season,
  suited,
  windTile,
  type ScoringTile
} from './index.js';

describe('Hong Kong Mahjong payment calculation', () => {
  it('uses the default classical Fan payment bands', () => {
    expect([0, 1, 2, 3, 4, 6, 7, 9, 10, 12, 13, 20].map((fan) => lookupBasePayment(fan))).toEqual([
      1, 2, 4, 8, 16, 16, 32, 32, 64, 64, 128, 128
    ]);
  });

  it('requires the default three Fan minimum before payments are awarded', () => {
    const result = calculatePayments({ fan: 2, winner: 'south', winType: 'discard', discarder: 'west' });

    expect(result.eligible).toBe(false);
    expect(result.lines).toHaveLength(0);
    expect(result.deltas.south).toBe(0);
    expect(result.basePoints).toBe(4);
  });

  it('stacks discard, East winner, and East payer losing doublings', () => {
    const eastWinsOnSouthDiscard = calculatePayments({
      fan: 3,
      winner: 'east',
      winType: 'discard',
      discarder: 'south'
    });
    const southWinsOnEastDiscard = calculatePayments({
      fan: 3,
      winner: 'south',
      winType: 'discard',
      discarder: 'east'
    });

    expect(eastWinsOnSouthDiscard.lines[0]?.points).toBe(32);
    expect(eastWinsOnSouthDiscard.lines[0]?.reasons).toEqual([
      'discarder pays double',
      'East winner doubles all payments'
    ]);
    expect(southWinsOnEastDiscard.lines[0]?.points).toBe(32);
    expect(southWinsOnEastDiscard.lines[0]?.reasons).toEqual([
      'discarder pays double',
      'East payer losing doubles payment'
    ]);
  });

  it('doubles every loser on self-pick and adds East payer/winner doublings', () => {
    const result = calculatePayments({ fan: 4, winner: 'south', winType: 'self-pick' });

    expect(result.lines.map((line) => [line.from, line.points])).toEqual([
      ['east', 64],
      ['west', 32],
      ['north', 32]
    ]);
    expect(result.deltas.south).toBe(128);
    expect(result.deltas.east).toBe(-64);
  });

  it('allows payment table and minimum Fan overrides', () => {
    const rules = createHongKongMahjongRules({
      minFan: 1,
      paymentTable: [{ minFan: 0, points: 5 }]
    });

    const result = calculatePayments({ fan: 1, winner: 'west', winType: 'discard', discarder: 'north' }, rules);

    expect(result.eligible).toBe(true);
    expect(result.basePoints).toBe(5);
    expect(result.lines[0]?.points).toBe(10);
  });

  it('handles custom East seats, capped high-Fan bands, and invalid discard winners', () => {
    const highFan = calculatePayments({
      fan: 99,
      winner: 'north',
      winType: 'self-pick',
      eastSeat: 'south'
    });

    expect(highFan.basePoints).toBe(128);
    expect(highFan.lines.map((line) => [line.from, line.points])).toEqual([
      ['east', 256],
      ['south', 512],
      ['west', 256]
    ]);
    expect(highFan.deltas.north).toBe(1024);

    expect(() => calculatePayments({ fan: 3, winner: 'west', winType: 'discard' })).toThrow('Discard wins require a discarder');
    expect(() => calculatePayments({ fan: 3, winner: 'west', winType: 'discard', discarder: 'west' })).toThrow(
      'Winner cannot pay their own discard win'
    );
  });
});

describe('Hong Kong Mahjong Fan scoring', () => {
  it('scores matching flowers, seasons, Dragon sets, seat wind, and round wind additively', () => {
    const result = scoreHand({
      melds: [
        pong(dragonTile('red')),
        pong(windTile('south')),
        pong(windTile('east')),
        pong(suited('dots', 5))
      ],
      pair: pair(suited('bamboo', 2)),
      bonusTiles: [flower('south'), season('south')],
      seatWind: 'south',
      roundWind: 'east'
    });

    expect(featureIds(result.includedFeatures)).toEqual([
      'seat-flower',
      'seat-season',
      'dragon-pong',
      'seat-wind-pong',
      'round-wind-pong',
      'all-pongs'
    ]);
    expect(result.fan).toBe(8);
    expect(result.eligible).toBe(true);
  });

  it('detects no-bonus and all-chows while preserving minimum Fan eligibility', () => {
    const result = scoreHand({
      melds: [
        { type: 'chow', tiles: [suited('characters', 1), suited('characters', 2), suited('characters', 3)] },
        { type: 'chow', tiles: [suited('characters', 3), suited('characters', 4), suited('characters', 5)] },
        { type: 'chow', tiles: [suited('dots', 2), suited('dots', 3), suited('dots', 4)] },
        { type: 'chow', tiles: [suited('bamboo', 6), suited('bamboo', 7), suited('bamboo', 8)] }
      ],
      pair: pair(suited('dots', 5)),
      bonusTiles: []
    });

    expect(featureIds(result.includedFeatures)).toEqual(['no-bonus-tiles', 'all-chows']);
    expect(result.fan).toBe(2);
    expect(result.eligible).toBe(false);
  });

  it('allows configurable replacement group priorities', () => {
    const rules = createHongKongMahjongRules({
      fanTable: {
        'all-terminals': 20
      }
    });
    const result = scoreHand(
      {
        tiles: [suited('dots', 1), suited('dots', 1), suited('dots', 9), suited('dots', 9)]
      },
      rules
    );

    expect(featureIds(result.includedFeatures)).toContain('all-terminals');
    expect(result.excludedFeatures.some((feature) => feature.id === 'all-terminals-and-honours')).toBe(true);
  });

  it('detects mixed and pure suit patterns from stable tile arrays', () => {
    const mixed = scoreHand({
      tiles: [suited('characters', 1), suited('characters', 2), windTile('east'), dragonTile('green')]
    });
    const pure = scoreHand({
      tiles: [suited('bamboo', 1), suited('bamboo', 2), suited('bamboo', 9)]
    });

    expect(featureIds(mixed.includedFeatures)).toContain('mixed-one-suit');
    expect(featureIds(pure.includedFeatures)).toContain('pure-one-suit');
  });

  it('detects Big Three Dragons and replaces individual Dragon Pong features', () => {
    const result = scoreHand({
      melds: [pong(dragonTile('red')), kong(dragonTile('green')), pong(dragonTile('white')), pong(suited('dots', 5))],
      pair: pair(suited('characters', 2))
    });

    expect(featureIds(result.includedFeatures)).toContain('big-three-dragons');
    expect(result.excludedFeatures.filter((feature) => feature.id === 'dragon-pong')).toHaveLength(3);
    expect(result.fan).toBe(11);
  });

  it('detects Little Four Winds and Big Four Winds', () => {
    const little = scoreHand({
      melds: [pong(windTile('east')), pong(windTile('south')), pong(windTile('west')), pong(suited('dots', 5))],
      pair: pair(windTile('north'))
    });
    const big = scoreHand({
      melds: [pong(windTile('east')), pong(windTile('south')), pong(windTile('west')), pong(windTile('north'))],
      pair: pair(suited('dots', 5))
    });

    expect(featureIds(little.includedFeatures)).toContain('little-four-winds');
    expect(featureIds(big.includedFeatures)).toContain('big-four-winds');
  });

  it('detects terminal/honour and special hands where the shape is represented as tiles', () => {
    const thirteenOrphansTiles: ScoringTile[] = [
      suited('characters', 1),
      suited('characters', 9),
      suited('bamboo', 1),
      suited('bamboo', 9),
      suited('dots', 1),
      suited('dots', 9),
      windTile('east'),
      windTile('south'),
      windTile('west'),
      windTile('north'),
      dragonTile('red'),
      dragonTile('green'),
      dragonTile('white'),
      dragonTile('red')
    ];
    const sevenPairsTiles: ScoringTile[] = [
      suited('dots', 1),
      suited('dots', 1),
      suited('dots', 2),
      suited('dots', 2),
      suited('dots', 3),
      suited('dots', 3),
      suited('dots', 4),
      suited('dots', 4),
      suited('dots', 5),
      suited('dots', 5),
      suited('dots', 6),
      suited('dots', 6),
      suited('dots', 7),
      suited('dots', 7)
    ];

    expect(featureIds(scoreHand({ tiles: thirteenOrphansTiles }).includedFeatures)).toEqual([
      'all-terminals-and-honours',
      'thirteen-orphans'
    ]);
    expect(featureIds(scoreHand({ tiles: sevenPairsTiles }).includedFeatures)).toEqual(['pure-one-suit', 'seven-pairs']);
  });
});

function featureIds(features: readonly { readonly id: string }[]): string[] {
  return features.map((feature) => feature.id);
}
