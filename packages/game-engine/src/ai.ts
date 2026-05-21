import { getLegalActions, type LegalAction } from './actions.js';
import { claimDiscard, createInitialRoundState, declareKong, declareSelfDrawWin, discardTile, drawTile, passClaimWindow, type CreateRoundOptions } from './engine.js';
import { getPlayer, nextSeatIndex, type RoundState } from './state.js';
import { getTileDefinition, isHonorTile, isSuitTile, sortTiles, tileKeySortValue, type Tile, type TileId, type TileKey } from './tiles.js';

export type AiDifficulty = 'easy' | 'medium' | 'hard';

export interface AiPlayerPolicy {
  readonly difficulty: AiDifficulty;
  readonly seed?: string;
}

export interface AiActionSelectionInput {
  readonly state: RoundState;
  readonly seatIndex: number;
  readonly legalActions?: readonly LegalAction[];
  readonly policy?: AiPlayerPolicy;
}

export interface AiDecision {
  readonly seatIndex: number;
  readonly difficulty: AiDifficulty;
  readonly legalActions: readonly LegalAction[];
  readonly selectedAction?: LegalAction;
  readonly applied: boolean;
}

export interface AiAdvanceOptions {
  readonly policies?: readonly (AiPlayerPolicy | AiDifficulty | undefined)[];
  readonly seed?: string;
}

export interface AiAdvanceResult {
  readonly state: RoundState;
  readonly decisions: readonly AiDecision[];
}

export interface AiRoundSimulationOptions extends CreateRoundOptions, AiAdvanceOptions {
  readonly maxSteps?: number;
}

export interface AiRoundSimulationResult {
  readonly initialState: RoundState;
  readonly finalState: RoundState;
  readonly steps: number;
  readonly completed: boolean;
  readonly decisions: readonly AiDecision[];
  readonly blocker?: string;
}

function hashSeed(seed: string): number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createAiRandom(seed = 'ai'): () => number {
  let value = hashSeed(seed) || 0x6d2b79f5;
  return () => {
    value += 0x6d2b79f5;
    let next = value;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}

function normalizePolicy(policy: AiPlayerPolicy | AiDifficulty | undefined, fallbackSeed: string, seatIndex: number): Required<AiPlayerPolicy> {
  if (typeof policy === 'string') {
    return { difficulty: policy, seed: `${fallbackSeed}:seat-${seatIndex}` };
  }
  return {
    difficulty: policy?.difficulty ?? 'medium',
    seed: policy?.seed ?? `${fallbackSeed}:seat-${seatIndex}`
  };
}

function actionStableKey(action: LegalAction): string {
  return JSON.stringify(action);
}

function stateDecisionSeed(state: RoundState, seatIndex: number, policy: Required<AiPlayerPolicy>): string {
  const discard = state.lastDiscard ? `${state.lastDiscard.bySeat}:${state.lastDiscard.tile.id}` : 'none';
  return `${policy.seed}:${policy.difficulty}:${state.phase}:${state.turnNumber}:${state.currentTurn}:${seatIndex}:${discard}:${state.wall.liveWall.length}:${state.wall.deadWall.length}`;
}

function chooseRandom<T>(items: readonly T[], seed: string): T | undefined {
  if (items.length === 0) {
    return undefined;
  }
  const index = Math.floor(createAiRandom(seed)() * items.length);
  return items[index];
}

function tileById(tiles: readonly Tile[], tileId: TileId): Tile | undefined {
  return tiles.find((tile) => tile.id === tileId);
}

function tileCountByKey(tiles: readonly Tile[]): Map<TileKey, number> {
  const counts = new Map<TileKey, number>();
  for (const tile of tiles) {
    counts.set(tile.key, (counts.get(tile.key) ?? 0) + 1);
  }
  return counts;
}

function suitedNeighborCount(tile: Tile, tiles: readonly Tile[]): number {
  if (!isSuitTile(tile)) {
    return 0;
  }
  let score = 0;
  for (const other of tiles) {
    if (!isSuitTile(other) || other.id === tile.id || other.suit !== tile.suit) {
      continue;
    }
    const distance = Math.abs(other.rank - tile.rank);
    if (distance === 1) {
      score += 2;
    } else if (distance === 2) {
      score += 1;
    }
  }
  return score;
}

function tileRetentionScore(tile: Tile, tiles: readonly Tile[], state: RoundState, seatIndex: number): number {
  const counts = tileCountByKey(tiles);
  const matchingCount = counts.get(tile.key) ?? 0;
  let score = matchingCount >= 3 ? 9 : matchingCount === 2 ? 6 : 0;
  score += suitedNeighborCount(tile, tiles);
  if (isHonorTile(tile)) {
    score += matchingCount >= 2 ? 3 : -2;
    if (tile.key === getPlayer(state, seatIndex).wind || tile.key === state.prevailingWind) {
      score += 2;
    }
  }
  if (isSuitTile(tile) && (tile.rank === 1 || tile.rank === 9)) {
    score -= 1;
  }
  return score;
}

function handEfficiencyScore(tiles: readonly Tile[], state: RoundState, seatIndex: number): number {
  const counts = tileCountByKey(tiles);
  let score = 0;
  for (const [key, count] of counts.entries()) {
    score += count >= 3 ? 12 : count === 2 ? 5 : 0;
    const definition = getTileDefinition(key);
    if (isHonorTile(definition) && (key === getPlayer(state, seatIndex).wind || key === state.prevailingWind)) {
      score += count * 2;
    }
  }
  for (const tile of tiles) {
    score += suitedNeighborCount(tile, tiles);
  }
  return score;
}

function discardScore(action: LegalAction, state: RoundState, seatIndex: number, difficulty: AiDifficulty): number {
  if (action.type !== 'discard') {
    return Number.NEGATIVE_INFINITY;
  }
  const player = getPlayer(state, seatIndex);
  const tile = tileById(player.concealedTiles, action.tileId);
  if (!tile) {
    return Number.NEGATIVE_INFINITY;
  }
  const remaining = player.concealedTiles.filter((candidate) => candidate.id !== tile.id);
  const retention = tileRetentionScore(tile, player.concealedTiles, state, seatIndex);
  const efficiency = handEfficiencyScore(remaining, state, seatIndex);
  const sortedBias = difficulty === 'hard' ? -tileKeySortValue(tile.key) / 1000 : 0;
  return efficiency - retention + sortedBias;
}

function claimScore(action: LegalAction, state: RoundState, seatIndex: number, difficulty: AiDifficulty): number {
  if (action.type === 'win') {
    return 10000;
  }
  if (action.type === 'pass') {
    return difficulty === 'hard' ? 25 : 0;
  }
  if (action.type === 'draw') {
    return 9000;
  }
  if (action.type === 'kong') {
    return action.kongType === 'exposed' ? 700 : 800;
  }
  if (action.type === 'pong') {
    const discard = state.lastDiscard?.tile;
    const valueBonus = discard && isHonorTile(discard) ? 80 : 0;
    return difficulty === 'hard' ? 420 + valueBonus : 500;
  }
  if (action.type === 'chow') {
    if (difficulty === 'hard') {
      const discard = state.lastDiscard?.tile;
      if (!discard || !isSuitTile(discard)) {
        return 10;
      }
      return discard.rank >= 3 && discard.rank <= 7 ? 260 : 120;
    }
    return 300;
  }
  return Number.NEGATIVE_INFINITY;
}

function chooseHighestScored(actions: readonly LegalAction[], scoreAction: (action: LegalAction) => number): LegalAction | undefined {
  return [...actions].sort((left, right) => {
    const scoreDelta = scoreAction(right) - scoreAction(left);
    return scoreDelta === 0 ? actionStableKey(left).localeCompare(actionStableKey(right)) : scoreDelta;
  })[0];
}

function chooseStrategicAction(actions: readonly LegalAction[], state: RoundState, seatIndex: number, difficulty: AiDifficulty): LegalAction | undefined {
  const nextRound = actions.find((action) => action.type === 'nextRound');
  if (nextRound) {
    return nextRound;
  }
  const win = actions.find((action) => action.type === 'win');
  if (win) {
    return win;
  }
  const draw = actions.find((action) => action.type === 'draw');
  if (draw) {
    return draw;
  }
  if (state.phase === 'awaitingDiscard') {
    const kong = actions.find((action) => action.type === 'kong');
    if (kong && difficulty !== 'medium') {
      return kong;
    }
    return chooseHighestScored(
      actions.filter((action) => action.type === 'discard'),
      (action) => discardScore(action, state, seatIndex, difficulty)
    );
  }
  return chooseHighestScored(actions, (action) => claimScore(action, state, seatIndex, difficulty));
}

export function selectAiAction(input: AiActionSelectionInput): LegalAction | undefined {
  const legalActions = input.legalActions ?? getLegalActions(input.state, input.seatIndex);
  if (legalActions.length === 0) {
    return undefined;
  }
  const policy = normalizePolicy(input.policy, input.state.wall.seed, input.seatIndex);
  if (policy.difficulty === 'easy') {
    return chooseRandom(legalActions, stateDecisionSeed(input.state, input.seatIndex, policy));
  }
  const strategic = chooseStrategicAction(legalActions, input.state, input.seatIndex, policy.difficulty);
  if (strategic) {
    return strategic;
  }
  return chooseRandom(legalActions, stateDecisionSeed(input.state, input.seatIndex, policy));
}

function policyForSeat(options: AiAdvanceOptions, seatIndex: number): Required<AiPlayerPolicy> {
  return normalizePolicy(options.policies?.[seatIndex], options.seed ?? 'ai-round', seatIndex);
}

function applyLegalAction(state: RoundState, seatIndex: number, action: LegalAction): RoundState {
  if (action.type === 'draw') {
    return drawTile(state, seatIndex);
  }
  if (action.type === 'discard') {
    return discardTile(state, action.tileId);
  }
  if (action.type === 'win') {
    return state.phase === 'awaitingClaims' ? claimDiscard(state, seatIndex, action) : declareSelfDrawWin(state);
  }
  if (action.type === 'kong' && action.kongType !== 'exposed') {
    return declareKong(state, action.tileKey, action.kongType === 'added' ? action.meldId : undefined);
  }
  if (action.type === 'chow' || action.type === 'pong' || (action.type === 'kong' && action.kongType === 'exposed')) {
    return claimDiscard(state, seatIndex, action);
  }
  return state;
}

function claimPriority(action: LegalAction | undefined): number {
  if (!action) {
    return 0;
  }
  if (action.type === 'win') {
    return 4;
  }
  if (action.type === 'kong' && action.kongType === 'exposed') {
    return 3;
  }
  if (action.type === 'pong') {
    return 2;
  }
  if (action.type === 'chow') {
    return 1;
  }
  return 0;
}

function claimSeatDistance(state: RoundState, seatIndex: number): number {
  const bySeat = state.lastDiscard?.bySeat ?? state.currentTurn;
  let distance = 1;
  let cursor = nextSeatIndex(bySeat);
  while (cursor !== seatIndex && distance < 4) {
    cursor = nextSeatIndex(cursor);
    distance += 1;
  }
  return distance;
}

function resolveClaimDecision(state: RoundState, decisions: readonly AiDecision[]): AiDecision | undefined {
  return [...decisions]
    .filter((decision) => claimPriority(decision.selectedAction) > 0)
    .sort((left, right) => {
      const priorityDelta = claimPriority(right.selectedAction) - claimPriority(left.selectedAction);
      return priorityDelta === 0 ? claimSeatDistance(state, left.seatIndex) - claimSeatDistance(state, right.seatIndex) : priorityDelta;
    })[0];
}

export function advanceAiRound(state: RoundState, options: AiAdvanceOptions = {}): AiAdvanceResult {
  if (state.phase === 'finished') {
    return { state, decisions: [] };
  }
  if (state.phase === 'awaitingClaims') {
    const decisions = state.players
      .filter((player) => player.seatIndex !== state.lastDiscard?.bySeat)
      .map((player): AiDecision => {
        const legalActions = getLegalActions(state, player.seatIndex);
        const policy = policyForSeat(options, player.seatIndex);
        const selectedAction = selectAiAction({ state, seatIndex: player.seatIndex, legalActions, policy });
        return {
          seatIndex: player.seatIndex,
          difficulty: policy.difficulty,
          legalActions,
          ...(selectedAction ? { selectedAction } : {}),
          applied: false
        };
      });
    const claim = resolveClaimDecision(state, decisions);
    if (!claim?.selectedAction) {
      return { state: passClaimWindow(state), decisions };
    }
    const next = applyLegalAction(state, claim.seatIndex, claim.selectedAction);
    return {
      state: next,
      decisions: decisions.map((decision) => ({
        ...decision,
        applied: decision.seatIndex === claim.seatIndex
      }))
    };
  }

  const seatIndex = state.currentTurn;
  const legalActions = getLegalActions(state, seatIndex);
  const policy = policyForSeat(options, seatIndex);
  const selectedAction = selectAiAction({ state, seatIndex, legalActions, policy });
  if (!selectedAction) {
    return {
      state,
      decisions: [{ seatIndex, difficulty: policy.difficulty, legalActions, applied: false }]
    };
  }
  return {
    state: applyLegalAction(state, seatIndex, selectedAction),
    decisions: [{ seatIndex, difficulty: policy.difficulty, legalActions, selectedAction, applied: true }]
  };
}

export function runAiRoundSimulation(options: AiRoundSimulationOptions = {}): AiRoundSimulationResult {
  const { maxSteps = 1000, policies, seed, ...roundOptions } = options;
  const initialState = createInitialRoundState({ ...roundOptions, seed: seed ?? 'ai-round' });
  let state = initialState;
  const decisions: AiDecision[] = [];
  for (let step = 0; step < maxSteps; step += 1) {
    if (state.phase === 'finished') {
      return { initialState, finalState: state, steps: step, completed: true, decisions };
    }
    const advanceOptions: AiAdvanceOptions = {
      seed: seed ?? initialState.wall.seed,
      ...(policies ? { policies } : {})
    };
    const result = advanceAiRound(state, advanceOptions);
    decisions.push(...result.decisions);
    if (result.state === state) {
      return {
        initialState,
        finalState: state,
        steps: step,
        completed: false,
        decisions,
        blocker: `No legal AI progress was possible from phase ${state.phase}.`
      };
    }
    state = result.state;
  }
  if (state.phase === 'finished') {
    return { initialState, finalState: state, steps: maxSteps, completed: true, decisions };
  }
  return {
    initialState,
    finalState: state,
    steps: maxSteps,
    completed: false,
    decisions,
    blocker: `Simulation reached maxSteps (${maxSteps}) before round completion.`
  };
}

export function sortedLegalActionsForDisplay(actions: readonly LegalAction[]): readonly LegalAction[] {
  return [...actions].sort((left, right) => actionStableKey(left).localeCompare(actionStableKey(right)));
}

export function sortedTilesForAi(tiles: readonly Tile[]): readonly Tile[] {
  return sortTiles(tiles);
}
