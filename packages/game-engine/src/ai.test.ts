import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RULESET,
  createInitialRoundState,
  createTileSet,
  getLegalActions,
  runAiRoundSimulation,
  selectAiAction,
  type AiDifficulty,
  type LegalAction,
  type PlayerState,
  type RoundState,
  type Tile,
  type TileKey,
  type WallState
} from './index.js';

function actionKey(action: LegalAction | undefined): string | undefined {
  return action ? JSON.stringify(action) : undefined;
}

function expectLegal(action: LegalAction | undefined, legalActions: readonly LegalAction[]): void {
  expect(action).toBeDefined();
  expect(legalActions.map((candidate) => JSON.stringify(candidate))).toContain(actionKey(action));
}

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
  const winds = ['east', 'south', 'west', 'north'] as const;
  const wind = winds[seatIndex];
  if (!wind) {
    throw new Error(`Invalid seat ${seatIndex}`);
  }
  return {
    seatIndex,
    wind,
    controller: 'ai',
    displayName: `AI ${seatIndex + 1}`,
    score: 0,
    concealedTiles,
    flowers: [],
    melds: [],
    discards
  };
}

function wall(): WallState {
  return { seed: 'ai-test', liveWall: [], deadWall: [], replacementDraws: [] };
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

function countTiles(state: RoundState): number {
  const playerTiles = state.players.flatMap((player) => [
    ...player.concealedTiles,
    ...player.flowers,
    ...player.discards,
    ...player.melds.flatMap((meld) => meld.tiles)
  ]);
  return playerTiles.length + state.wall.liveWall.length + state.wall.deadWall.length;
}

describe('AI player policies', () => {
  it('selects only legal actions for every difficulty on turn and claim windows', () => {
    const initial = createInitialRoundState({ seed: 'ai-legal-actions' });
    const turnLegal = getLegalActions(initial, initial.currentTurn);
    const [discard, pairA, pairB] = tiles(['dots-3', 'dots-3', 'dots-3']);
    if (!discard || !pairA || !pairB) {
      throw new Error('Missing claim test tiles');
    }
    const claimState = roundState({
      phase: 'awaitingClaims',
      players: [emptyPlayer(0, [], [discard]), emptyPlayer(1, [pairA, pairB]), emptyPlayer(2), emptyPlayer(3)],
      lastDiscard: { tile: discard, bySeat: 0, turnNumber: 1 }
    });
    const claimLegal = getLegalActions(claimState, 1);

    for (const difficulty of ['easy', 'medium', 'hard'] as const satisfies readonly AiDifficulty[]) {
      expectLegal(selectAiAction({ state: initial, seatIndex: initial.currentTurn, legalActions: turnLegal, policy: { difficulty, seed: 'turn' } }), turnLegal);
      expectLegal(selectAiAction({ state: claimState, seatIndex: 1, legalActions: claimLegal, policy: { difficulty, seed: 'claim' } }), claimLegal);
    }
  });

  it('medium and hard policies prefer available wins before other legal actions', () => {
    const winningTiles = tiles([
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
    const state = roundState({ players: [emptyPlayer(0, winningTiles), emptyPlayer(1), emptyPlayer(2), emptyPlayer(3)] });
    const legalActions = getLegalActions(state, 0);

    expect(selectAiAction({ state, seatIndex: 0, legalActions, policy: { difficulty: 'medium' } })?.type).toBe('win');
    expect(selectAiAction({ state, seatIndex: 0, legalActions, policy: { difficulty: 'hard' } })?.type).toBe('win');
  });

  it('runs four AI players through a reproducible complete round without illegal commands', () => {
    const options = {
      seed: 'ai-round-simulation',
      policies: [{ difficulty: 'easy' }, { difficulty: 'medium' }, { difficulty: 'hard' }, { difficulty: 'hard' }],
      maxSteps: 500
    } as const;

    const first = runAiRoundSimulation(options);
    const second = runAiRoundSimulation(options);

    expect(first.completed, first.blocker).toBe(true);
    expect(first.finalState.phase).toBe('finished');
    expect(first.steps).toBeGreaterThan(0);
    expect(first.decisions.length).toBeGreaterThan(0);
    for (const decision of first.decisions) {
      if (decision.selectedAction) {
        expect(decision.legalActions.map((action) => JSON.stringify(action))).toContain(JSON.stringify(decision.selectedAction));
      }
    }
    expect(first.finalState.conclusion?.reason).toMatch(/win|exhaustiveDraw/);
    expect(first.decisions.map((decision) => actionKey(decision.selectedAction))).toEqual(second.decisions.map((decision) => actionKey(decision.selectedAction)));
    expect(first.finalState.conclusion).toEqual(second.finalState.conclusion);
  });

  it('keeps tile conservation and deterministic legal play across several four-AI simulations', () => {
    const seeds = ['ai-sim-a', 'ai-sim-b', 'ai-sim-c'];

    for (const seed of seeds) {
      const result = runAiRoundSimulation({
        seed,
        policies: ['easy', 'medium', 'hard', 'medium'],
        maxSteps: 700
      });

      expect(result.completed, `${seed}: ${result.blocker ?? 'incomplete'}`).toBe(true);
      expect(result.finalState.phase).toBe('finished');
      expect(countTiles(result.finalState)).toBe(144);
      expect(result.decisions.every((decision) => decision.legalActions.length > 0)).toBe(true);
      for (const decision of result.decisions) {
        if (decision.selectedAction) {
          expect(decision.legalActions.map((action) => JSON.stringify(action))).toContain(JSON.stringify(decision.selectedAction));
        }
      }
    }
  });
});
