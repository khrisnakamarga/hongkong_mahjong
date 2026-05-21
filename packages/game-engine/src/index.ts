export * from './actions.js';
export * from './ai.js';
export * from './engine.js';
export * from './hand-validation.js';
export {
  calculatePayments,
  lookupBasePayment,
  meetsMinimumFan,
  type PaymentCalculationInput,
  type PaymentLine,
  type PaymentResult,
  type WinType
} from './payments.js';
export {
  DEFAULT_FAN_TABLE,
  DEFAULT_HONG_KONG_RULES,
  DEFAULT_PAYMENT_TABLE,
  createHongKongMahjongRules,
  type FanFeatureId,
  type FanFeatureRule,
  type FanTable,
  type HongKongMahjongRules,
  type HongKongMahjongRulesOverride,
  type PaymentBand
} from './rules.js';
export {
  bonusTileFromEngineTile,
  chow,
  detectFanFeatures,
  dragonTile,
  flower,
  kong,
  pair,
  pong,
  resolveFanFeatureReplacements,
  scoreHand,
  scoringMeldFromEngineMeld,
  scoringTileFromEngineTile,
  scoringTilesFromEngineTiles,
  season,
  suited,
  windTile,
  type BonusTile,
  type DragonColor,
  type DragonTile as ScoringDragonTile,
  type FanFeatureOccurrence,
  type FanScoreResult,
  type ScoringMeld,
  type ScoringInputTile,
  type ScoringMeldType,
  type ScoringTile,
  type SpecialHand,
  type SuitedTile,
  type TileSuit,
  type WindTile,
  type WinningHand
} from './scoring.js';
export * from './state.js';
export * from './tiles.js';
export * from './wall.js';

import { DEFAULT_RULESET } from './engine.js';
import { SEAT_WINDS, type BootstrapRoomState } from './state.js';

export { DEFAULT_RULESET };

export function createBootstrapRoomState(roomCode = 'LOCAL'): BootstrapRoomState {
  return {
    roomCode,
    phase: 'bootstrap',
    ruleset: {
      name: DEFAULT_RULESET.name,
      minFan: DEFAULT_RULESET.minFan,
      playerCount: DEFAULT_RULESET.playerCount
    },
    seats: SEAT_WINDS.map((wind, index) => ({
      wind,
      controller: 'ai',
      displayName: `AI ${index + 1}`,
      score: 0
    }))
  };
}
