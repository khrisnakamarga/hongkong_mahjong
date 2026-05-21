import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_HONG_KONG_RULES,
  advanceAiRound,
  claimDiscard,
  createInitialRoundState,
  createNextRoundState,
  declareKong,
  declareSelfDrawWin,
  discardTile,
  drawTile,
  getLegalActions,
  passClaimWindow,
  sortTiles,
  type AiDifficulty as EngineAiDifficulty,
  type FanFeatureId,
  type FanFeatureRule,
  type LegalAction,
  type Meld,
  type PaymentBand,
  type RoundState,
  type SeatWind,
  type Tile
} from '@hongkong-mahjong/game-engine';

type AppMode = 'demo' | 'server';
type ConnectionState = 'checking' | 'connected' | 'offline';
type SeatController = 'ai' | 'human';
type UiAiDifficulty = 'easy' | 'standard' | 'expert';

interface PublicSeatSnapshot {
  readonly seatIndex: number;
  readonly wind: SeatWind;
  readonly controller: SeatController;
  readonly displayName: string;
  readonly claimed: boolean;
  readonly connected: boolean;
}

interface PublicPlayerSnapshot {
  readonly seatIndex: number;
  readonly wind: SeatWind;
  readonly controller: SeatController;
  readonly displayName: string;
  readonly score: number;
  readonly concealedCount: number;
  readonly concealedTiles?: readonly Tile[];
  readonly flowers: readonly Tile[];
  readonly melds: readonly Meld[];
  readonly discards: readonly Tile[];
}

interface PublicRoundSnapshot {
  readonly phase: RoundState['phase'];
  readonly rules: RoundState['rules'];
  readonly dealerSeat: number;
  readonly prevailingWind: SeatWind;
  readonly currentTurn: number;
  readonly turnNumber: number;
  readonly players: readonly PublicPlayerSnapshot[];
  readonly wall: {
    readonly liveCount: number;
    readonly deadCount: number;
    readonly replacementDrawCount: number;
  };
  readonly lastDiscard?: RoundState['lastDiscard'];
  readonly lastDraw?: RoundState['lastDraw'];
  readonly conclusion?: RoundState['conclusion'];
}

interface RoomSnapshot {
  readonly roomCode: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly seats: readonly PublicSeatSnapshot[];
  readonly round: PublicRoundSnapshot;
  readonly viewerSeatIndex?: number;
  readonly legalActions: readonly LegalAction[];
}

interface ClaimLink {
  readonly seatIndex: number;
  readonly token: string;
  readonly url: string;
}

interface CreateRoomResponse {
  readonly room: RoomSnapshot;
  readonly claimLinks: readonly ClaimLink[];
}

interface ClaimSeatResponse {
  readonly room: RoomSnapshot;
  readonly sessionToken: string;
}

interface SeatSession {
  readonly roomCode: string;
  readonly seatIndex: number;
  readonly sessionToken: string;
}

interface FanConfig {
  readonly id: FanFeatureId;
  readonly name: string;
  readonly fan: number;
  readonly enabled: boolean;
}

const SESSION_STORAGE_KEY = 'hongkong-mahjong-seat-session';
const WINDS: readonly SeatWind[] = ['east', 'south', 'west', 'north'];
const WIND_LABELS: Readonly<Record<SeatWind, string>> = {
  east: 'East',
  south: 'South',
  west: 'West',
  north: 'North'
};

function getDefaultApiBase(): string {
  return import.meta.env.VITE_API_URL ?? `${window.location.protocol}//${window.location.hostname}:8787`;
}

function getDefaultWebSocketBase(): string {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return import.meta.env.VITE_WS_URL ?? `${protocol}//${window.location.hostname}:8787/ws`;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createRound(seed: string, minFan: number): RoundState {
  return createInitialRoundState({
    seed,
    rules: {
      name: 'Hong Kong Mahjong local table rules',
      minFan,
      playerCount: 4
    },
    controllers: ['human', 'ai', 'ai', 'ai'],
    displayNames: ['You', 'AI South', 'AI West', 'AI North']
  });
}

function createAiOnlyRound(seed: string, minFan: number): RoundState {
  return createInitialRoundState({
    seed,
    rules: {
      name: 'Hong Kong Mahjong four-AI spectator rules',
      minFan,
      playerCount: 4
    },
    controllers: ['ai', 'ai', 'ai', 'ai'],
    displayNames: ['AI East', 'AI South', 'AI West', 'AI North']
  });
}

function mapUiDifficulty(difficulty: UiAiDifficulty): EngineAiDifficulty {
  if (difficulty === 'standard') {
    return 'medium';
  }
  if (difficulty === 'expert') {
    return 'hard';
  }
  return 'easy';
}

function createRoomSnapshot(
  round: RoundState,
  roomCode: string,
  version: number,
  viewerSeatIndex: number | undefined,
  revealAllTiles = false
): RoomSnapshot {
  const createdAt = nowIso();
  const revealAllHands = revealAllTiles || round.phase === 'finished';
  return {
    roomCode,
    version,
    createdAt,
    updatedAt: createdAt,
    seats: round.players.map((player) => ({
      seatIndex: player.seatIndex,
      wind: player.wind,
      controller: player.controller,
      displayName: player.displayName,
      claimed: player.controller === 'human',
      connected: player.controller === 'human'
    })),
    round: {
      phase: round.phase,
      rules: round.rules,
      dealerSeat: round.dealerSeat,
      prevailingWind: round.prevailingWind,
      currentTurn: round.currentTurn,
      turnNumber: round.turnNumber,
      players: round.players.map((player) => ({
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
      })),
      wall: {
        liveCount: round.wall.liveWall.length,
        deadCount: round.wall.deadWall.length,
        replacementDrawCount: round.wall.replacementDraws.length
      },
      ...(round.lastDiscard ? { lastDiscard: round.lastDiscard } : {}),
      ...(round.lastDraw ? { lastDraw: round.lastDraw } : {}),
      ...(round.conclusion ? { conclusion: round.conclusion } : {})
    },
    ...(viewerSeatIndex !== undefined ? { viewerSeatIndex } : {}),
    legalActions: viewerSeatIndex === undefined ? [] : getLegalActions(round, viewerSeatIndex)
  };
}

function createInitialFanConfig(): readonly FanConfig[] {
  return Object.entries(DEFAULT_HONG_KONG_RULES.fanTable).map(([id, rule]) => ({
    id,
    name: rule.name,
    fan: rule.fan,
    enabled: rule.enabled ?? true
  }));
}

function tileFace(tile: Tile): string {
  if (tile.category === 'suit') {
    const suit = tile.suit === 'dots' ? '●' : tile.suit === 'bamboo' ? '♣' : '萬';
    return `${tile.rank}${suit}`;
  }
  if (tile.category === 'wind') {
    return WIND_LABELS[tile.wind!].slice(0, 1);
  }
  if (tile.category === 'dragon') {
    return tile.dragon === 'red' ? '中' : tile.dragon === 'green' ? '發' : '白';
  }
  if (tile.category === 'flower') {
    return '花';
  }
  return '季';
}

function tileTitle(tile: Tile): string {
  return `${tile.name} (${tile.id})`;
}

function formatAction(action: LegalAction, snapshot: RoomSnapshot): string {
  if (action.type === 'nextRound') {
    return 'Start next round';
  }
  if (action.type === 'draw') {
    return 'Draw tile';
  }
  if (action.type === 'discard') {
    return `Discard ${findTileName(snapshot, action.tileId)}`;
  }
  if (action.type === 'pass') {
    return 'Pass';
  }
  if (action.type === 'win') {
    return action.source === 'discard' ? 'Claim win on discard' : 'Declare self-draw win';
  }
  if (action.type === 'chow') {
    return `Chow with ${action.tiles.map((tileId) => findTileName(snapshot, tileId)).join(' + ')}`;
  }
  if (action.type === 'pong') {
    return `Pong ${findTileName(snapshot, action.claimedTileId)}`;
  }
  if (action.type === 'kong') {
    const kind = action.kongType === 'concealed' ? 'Concealed Kong' : action.kongType === 'added' ? 'Added Kong' : 'Kong';
    return `${kind} ${'tileKey' in action ? action.tileKey : findTileName(snapshot, action.claimedTileId)}`;
  }
  return 'Action';
}

function findTileName(snapshot: RoomSnapshot, tileId: string): string {
  for (const player of snapshot.round.players) {
    const found = [
      ...(player.concealedTiles ?? []),
      ...player.flowers,
      ...player.discards,
      ...player.melds.flatMap((meld) => meld.tiles)
    ].find((tile) => tile.id === tileId);
    if (found) {
      return found.name;
    }
  }
  if (snapshot.round.lastDiscard?.tile.id === tileId) {
    return snapshot.round.lastDiscard.tile.name;
  }
  return tileId;
}

function actionMatches(left: LegalAction, right: LegalAction): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function applyLocalAction(round: RoundState, seatIndex: number, action: LegalAction): RoundState {
  if (action.type === 'nextRound') {
    return createNextRoundState(round);
  }
  if (action.type === 'draw') {
    return drawTile(round, seatIndex);
  }
  if (action.type === 'discard') {
    return discardTile(round, action.tileId);
  }
  if (action.type === 'pass') {
    return round.phase === 'awaitingClaims' && round.lastDiscard ? passClaimWindow(round) : round;
  }
  if (action.type === 'win') {
    return action.source === 'discard' ? claimDiscard(round, seatIndex, action) : declareSelfDrawWin(round);
  }
  if (action.type === 'kong' && action.kongType !== 'exposed') {
    return declareKong(round, action.tileKey, action.kongType === 'added' ? action.meldId : undefined);
  }
  return claimDiscard(round, seatIndex, action);
}

function chooseDiscard(actions: readonly LegalAction[], round: RoundState, seatIndex: number, difficulty: UiAiDifficulty): LegalAction {
  const discards = actions.filter((action): action is Extract<LegalAction, { type: 'discard' }> => action.type === 'discard');
  if (discards.length === 0) {
    return actions[0]!;
  }
  const player = round.players[seatIndex];
  const sortedTiles = sortTiles(player?.concealedTiles ?? []);
  const preferredTile = difficulty === 'easy'
    ? sortedTiles[sortedTiles.length - 1]
    : sortedTiles.find((tile) => tile.category === 'wind' || tile.category === 'dragon') ?? sortedTiles[0];
  return discards.find((action) => action.tileId === preferredTile?.id) ?? discards[0]!;
}

function chooseAiAction(actions: readonly LegalAction[], round: RoundState, seatIndex: number, difficulty: UiAiDifficulty): LegalAction {
  const nonRoundActions = actions.filter((action) => action.type !== 'nextRound');
  if (nonRoundActions.length > 0) {
    actions = nonRoundActions;
  }
  const winningAction = actions.find((action) => action.type === 'win');
  if (winningAction) {
    return winningAction;
  }
  const drawAction = actions.find((action) => action.type === 'draw');
  if (drawAction) {
    return drawAction;
  }
  if (difficulty === 'expert') {
    const claimAction = actions.find((action) => action.type === 'pong' || action.type === 'kong');
    if (claimAction) {
      return claimAction;
    }
  }
  const passAction = actions.find((action) => action.type === 'pass');
  if (passAction) {
    return passAction;
  }
  return chooseDiscard(actions, round, seatIndex, difficulty);
}

function advanceAiUntilHuman(round: RoundState, humanSeat: number, difficulty: UiAiDifficulty): { round: RoundState; entries: readonly string[] } {
  let next = round;
  const entries: string[] = [];
  for (let step = 0; step < 80; step += 1) {
    if (next.phase === 'finished' || getLegalActions(next, humanSeat).length > 0) {
      break;
    }

    const seatIndex = next.phase === 'awaitingClaims'
      ? WINDS.findIndex((_wind, index) => index !== next.lastDiscard?.bySeat && getLegalActions(next, index).length > 0)
      : next.currentTurn;

    if (seatIndex < 0 || next.players[seatIndex]?.controller === 'human') {
      break;
    }

    const legalActions = getLegalActions(next, seatIndex);
    if (legalActions.length === 0) {
      if (next.phase === 'awaitingClaims' && next.lastDiscard) {
        next = passClaimWindow(next);
        entries.push('No AI claimed the discard; the claim window closed.');
        continue;
      }
      break;
    }

    const action = chooseAiAction(legalActions, next, seatIndex, difficulty);
    entries.push(`${next.players[seatIndex]?.displayName ?? `Seat ${seatIndex}`} chose ${action.type}.`);
    next = applyLocalAction(next, seatIndex, action);
  }
  return { round: next, entries };
}

function advanceFourAiRound(round: RoundState, difficulty: UiAiDifficulty): { round: RoundState; entries: readonly string[] } {
  const result = advanceAiRound(round, {
    seed: round.wall.seed,
    policies: round.players.map(() => mapUiDifficulty(difficulty))
  });
  const entries = result.decisions.map((decision) => {
    const actor = round.players[decision.seatIndex]?.displayName ?? `AI ${decision.seatIndex + 1}`;
    if (!decision.selectedAction) {
      return `${actor} had no legal action.`;
    }
    const suffix = decision.applied ? '' : ' (not applied; lower priority claim)';
    return `${actor} chose ${decision.selectedAction.type}${suffix}.`;
  });
  return { round: result.state, entries };
}

function withClaimedDemoSeat(round: RoundState, seatIndex: number, displayName: string): RoundState {
  return {
    ...round,
    players: round.players.map((player, index) => ({
      ...player,
      controller: index === seatIndex ? 'human' : 'ai',
      displayName: index === seatIndex ? displayName.trim() || 'You' : player.displayName.replace(/^You$/, `AI ${index + 1}`)
    }))
  };
}

function readStoredSession(): SeatSession | undefined {
  const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as Partial<SeatSession>;
    if (typeof parsed.roomCode === 'string' && typeof parsed.seatIndex === 'number' && typeof parsed.sessionToken === 'string') {
      return { roomCode: parsed.roomCode, seatIndex: parsed.seatIndex, sessionToken: parsed.sessionToken };
    }
  } catch {
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
  }
  return undefined;
}

function TileView({
  tile,
  disabled = false,
  highlighted = false,
  winning = false,
  onClick
}: {
  readonly tile: Tile;
  readonly disabled?: boolean;
  readonly highlighted?: boolean;
  readonly winning?: boolean;
  readonly onClick?: () => void;
}) {
  const className = `tile tile-${tile.category}${highlighted ? ' tile-drawn' : ''}${winning ? ' tile-winning' : ''}${disabled ? ' tile-disabled' : ''}`;
  const title = winning ? `Winning tile: ${tileTitle(tile)}` : highlighted ? `Drawn tile: ${tileTitle(tile)}` : tileTitle(tile);
  const ariaLabel = winning ? `winning tile ${tile.name}` : highlighted ? `drawn tile ${tile.name}` : undefined;
  if (!onClick) {
    return (
      <span aria-label={ariaLabel} className={className} title={title}>
        <strong>{tileFace(tile)}</strong>
        <small>{tile.name}</small>
      </span>
    );
  }
  return (
    <button aria-label={ariaLabel} className={className} title={title} disabled={disabled} onClick={onClick} type="button">
      <strong>{tileFace(tile)}</strong>
      <small>{tile.name}</small>
    </button>
  );
}

function MeldView({ meld }: { readonly meld: Meld }) {
  return (
    <div className="meld">
      <span>{meld.kind}</span>
      <div className="tile-row compact">
        {meld.tiles.map((tile) => (
          <TileView key={tile.id} tile={tile} />
        ))}
      </div>
    </div>
  );
}

function PlayerPanel({
  player,
  isCurrent,
  isViewer,
  discardActions,
  drawnTileId,
  revealHand,
  winningTile,
  onAction
}: {
  readonly player: PublicPlayerSnapshot;
  readonly isCurrent: boolean;
  readonly isViewer: boolean;
  readonly discardActions: readonly Extract<LegalAction, { type: 'discard' }>[];
  readonly drawnTileId: string | undefined;
  readonly revealHand: boolean;
  readonly winningTile: Tile | undefined;
  readonly onAction: (action: LegalAction) => void;
}) {
  const rawConcealedTiles = player.concealedTiles ?? [];
  const winningTileInHand = winningTile ? rawConcealedTiles.find((tile) => tile.id === winningTile.id) : undefined;
  const drawnTile = isViewer && drawnTileId && !winningTileInHand ? rawConcealedTiles.find((tile) => tile.id === drawnTileId) : undefined;
  const concealedTiles = sortTiles(rawConcealedTiles.filter((tile) => tile.id !== drawnTile?.id && tile.id !== winningTileInHand?.id));
  const visibleTiles = drawnTile ? [...concealedTiles, drawnTile] : concealedTiles;
  const canShowConcealedTiles = (isViewer || revealHand) && (visibleTiles.length > 0 || winningTile !== undefined);
  const handHeading = isViewer ? 'Your hand' : revealHand ? 'Revealed hand' : 'Concealed hand';
  return (
    <article className={`player-panel ${isCurrent ? 'current-player' : ''} ${isViewer ? 'viewer-player' : ''}`}>
      <header>
        <div>
          <p className="eyebrow">{WIND_LABELS[player.wind]} seat</p>
          <h3>{player.displayName}</h3>
        </div>
        <span className={`seat-pill ${player.controller}`}>{player.controller}</span>
      </header>
      <dl className="mini-stats">
        <div>
          <dt>Score</dt>
          <dd>{player.score}</dd>
        </div>
        <div>
          <dt>Hand</dt>
          <dd>{player.concealedCount}</dd>
        </div>
      </dl>
      <section>
        <h4>{handHeading}</h4>
        <div className="tile-row hand-row">
          {canShowConcealedTiles
            ? (
                <>
                  {visibleTiles.map((tile) => {
                    const discardAction = discardActions.find((action) => action.tileId === tile.id);
                    const isDrawnTile = tile.id === drawnTile?.id;
                    if (discardAction) {
                      return <TileView key={tile.id} tile={tile} highlighted={isDrawnTile} onClick={() => onAction(discardAction)} />;
                    }
                    return <TileView key={tile.id} tile={tile} disabled={isViewer && !revealHand && discardActions.length > 0} highlighted={isDrawnTile} />;
                  })}
                  {winningTile ? (
                    <>
                      <span aria-hidden="true" className="winning-tile-divider" />
                      <TileView tile={winningTile} winning />
                    </>
                  ) : null}
                </>
              )
            : Array.from({ length: player.concealedCount }, (_value, index) => <span aria-label="concealed tile" className="tile tile-back" key={index} />)}
        </div>
      </section>
      <section>
        <h4>Melded sets</h4>
        <div className="meld-list">
          {player.melds.length === 0 ? <p className="muted">No melds yet.</p> : player.melds.map((meld) => <MeldView key={meld.id} meld={meld} />)}
        </div>
      </section>
      <section>
        <h4>Flowers / seasons</h4>
        <div className="tile-row compact">
          {player.flowers.length === 0 ? <span className="muted">None</span> : player.flowers.map((tile) => <TileView key={tile.id} tile={tile} />)}
        </div>
      </section>
      <section>
        <h4>Discards</h4>
        <div className="tile-row discard-row">
          {player.discards.length === 0 ? <span className="muted">No discards.</span> : player.discards.map((tile) => <TileView key={tile.id} tile={tile} />)}
        </div>
      </section>
    </article>
  );
}

function RulesPanel({
  minFan,
  fanConfig,
  paymentTable,
  onMinFanChange,
  onFanToggle
}: {
  readonly minFan: number;
  readonly fanConfig: readonly FanConfig[];
  readonly paymentTable: readonly PaymentBand[];
  readonly onMinFanChange: (value: number) => void;
  readonly onFanToggle: (id: FanFeatureId) => void;
}) {
  return (
    <section className="card rules-panel" aria-labelledby="rules-heading">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Rules configuration</p>
          <h2 id="rules-heading">Hong Kong Fan defaults</h2>
        </div>
        <label className="field inline-field">
          Minimum Fan
          <input min={0} max={13} type="number" value={minFan} onChange={(event) => onMinFanChange(Number(event.target.value))} />
        </label>
      </div>
      <p className="muted">
        This panel mirrors the implemented scoring defaults. New local demo rounds use the selected minimum Fan; server rooms use the
        server rules snapshot.
      </p>
      <div className="rules-grid">
        {fanConfig.map((rule) => (
          <label className="fan-rule" key={rule.id}>
            <input checked={rule.enabled} type="checkbox" onChange={() => onFanToggle(rule.id)} />
            <span>
              <strong>{rule.name}</strong>
              <small>{rule.fan} Fan</small>
            </span>
          </label>
        ))}
      </div>
      <h3>Payment bands</h3>
      <div className="payment-grid">
        {paymentTable.map((band) => (
          <div className="payment-band" key={`${band.minFan}-${band.maxFan ?? 'plus'}`}>
            <span>{band.maxFan === undefined ? `${band.minFan}+ Fan` : `${band.minFan}-${band.maxFan} Fan`}</span>
            <strong>{band.points} pts</strong>
          </div>
        ))}
      </div>
    </section>
  );
}

function getRuleDescription(config: readonly FanConfig[], id: FanFeatureId): string {
  const rule = DEFAULT_HONG_KONG_RULES.fanTable[id] as FanFeatureRule | undefined;
  const current = config.find((entry) => entry.id === id);
  return rule?.description ?? `${current?.name ?? id} is part of the default Hong Kong Fan table.`;
}

function playerLabel(snapshot: RoomSnapshot, wind: SeatWind): string {
  const player = snapshot.round.players.find((candidate) => candidate.wind === wind);
  return player ? `${player.displayName} (${WIND_LABELS[wind]})` : WIND_LABELS[wind];
}

function formatScoreDelta(delta: number): string {
  return delta > 0 ? `+${delta}` : `${delta}`;
}

export function App() {
  const initialRound = useMemo(() => createRound('local-demo', DEFAULT_HONG_KONG_RULES.minFan), []);
  const [mode, setMode] = useState<AppMode>('demo');
  const [connectionState, setConnectionState] = useState<ConnectionState>('checking');
  const [status, setStatus] = useState('Local demo is ready while the app checks for the realtime server.');
  const [apiBase, setApiBase] = useState(getDefaultApiBase);
  const [wsBase, setWsBase] = useState(getDefaultWebSocketBase);
  const [roomCodeInput, setRoomCodeInput] = useState('');
  const [displayName, setDisplayName] = useState('Player');
  const [aiDifficulty, setAiDifficulty] = useState<UiAiDifficulty>('standard');
  const [minFan, setMinFan] = useState(DEFAULT_HONG_KONG_RULES.minFan);
  const [fanConfig, setFanConfig] = useState(createInitialFanConfig);
  const [claimLinks, setClaimLinks] = useState<readonly ClaimLink[]>([]);
  const [seatSession, setSeatSession] = useState<SeatSession | undefined>(readStoredSession);
  const [demoRound, setDemoRound] = useState(initialRound);
  const [demoVersion, setDemoVersion] = useState(1);
  const [snapshot, setSnapshot] = useState<RoomSnapshot>(() => createRoomSnapshot(initialRound, 'DEMO01', 1, 0));
  const [gameLog, setGameLog] = useState<readonly string[]>(['Local demo table created. Claim a seat or discard as East to begin.']);
  const [fourAiRunning, setFourAiRunning] = useState(false);
  const [revealAllTiles, setRevealAllTiles] = useState(false);
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const didInitialConnect = useRef(false);

  const closeSocket = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = undefined;
  }, []);

  const pushLog = useCallback((entry: string) => {
    setGameLog((current) => [`${new Date().toLocaleTimeString()} ${entry}`, ...current].slice(0, 18));
  }, []);

  const refreshDemoSnapshot = useCallback((round: RoundState, version: number, viewerSeatIndex: number | undefined) => {
    setSnapshot(createRoomSnapshot(round, 'DEMO01', version, viewerSeatIndex, revealAllTiles));
  }, [revealAllTiles]);

  const toggleRevealAllTiles = useCallback(() => {
    setRevealAllTiles((current) => {
      const next = !current;
      if (mode === 'demo') {
        setSnapshot(createRoomSnapshot(demoRound, 'DEMO01', demoVersion, snapshot.viewerSeatIndex, next));
      } else {
        setStatus(next
          ? 'Reveal-all is active for local demo snapshots; server rooms still hide tiles they did not send.'
          : 'Reveal-all disabled.');
      }
      return next;
    });
  }, [demoRound, demoVersion, mode, snapshot.viewerSeatIndex]);

  const startDemo = useCallback((message = 'Started a fresh local demo room.') => {
    closeSocket();
    setFourAiRunning(false);
    const nextRound = createRound(`local-demo-${Date.now()}`, minFan);
    setMode('demo');
    setConnectionState('offline');
    setStatus('Using local demo adapter; no server or cloud connection is required.');
    setClaimLinks([]);
    setSeatSession(undefined);
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    setDemoRound(nextRound);
    setDemoVersion(1);
    refreshDemoSnapshot(nextRound, 1, 0);
    pushLog(message);
  }, [closeSocket, minFan, pushLog, refreshDemoSnapshot]);

  const startFourAiSpectator = useCallback(() => {
    closeSocket();
    const nextRound = createAiOnlyRound(`four-ai-${Date.now()}`, minFan);
    setMode('demo');
    setConnectionState('offline');
    setStatus('Watching four AI players locally; no server or cloud connection is required.');
    setClaimLinks([]);
    setSeatSession(undefined);
    window.localStorage.removeItem(SESSION_STORAGE_KEY);
    setDemoRound(nextRound);
    setDemoVersion(1);
    refreshDemoSnapshot(nextRound, 1, undefined);
    setFourAiRunning(true);
    pushLog('Started four-AI spectator game.');
  }, [closeSocket, minFan, pushLog, refreshDemoSnapshot]);

  const connectWebSocket = useCallback((roomCode: string, session?: SeatSession) => {
    closeSocket();
    const url = new URL(wsBase);
    url.searchParams.set('room', roomCode);
    if (session) {
      url.searchParams.set('seat', String(session.seatIndex));
      url.searchParams.set('session', session.sessionToken);
    }
    const socket = new WebSocket(url);
    socketRef.current = socket;
    socket.addEventListener('open', () => {
      setConnectionState('connected');
      setStatus(`Connected to local realtime server room ${roomCode}.`);
    });
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as {
        readonly type: string;
        readonly payload?: unknown;
        readonly id?: string;
      };
      if (message.type === 'snapshot') {
        setSnapshot(message.payload as RoomSnapshot);
      } else if (message.type === 'notification') {
        const payload = message.payload as { readonly message?: string };
        pushLog(payload.message ?? 'Room notification received.');
      } else if (message.type === 'command_ack') {
        pushLog('Action accepted by server.');
      } else if (message.type === 'error') {
        const payload = message.payload as { readonly message?: string };
        setStatus(payload.message ?? 'Server returned an error.');
        pushLog(`Server error: ${payload.message ?? 'unknown error'}`);
      }
    });
    socket.addEventListener('error', () => {
      setConnectionState('offline');
      setStatus('Realtime WebSocket is unavailable; use the local demo adapter to continue playing.');
    });
    socket.addEventListener('close', () => {
      setConnectionState((current) => (current === 'connected' ? 'offline' : current));
    });
  }, [closeSocket, pushLog, wsBase]);

  const createServerRoom = useCallback(async (fallbackToDemo: boolean) => {
    setConnectionState('checking');
    try {
      const response = await fetch(`${apiBase}/api/rooms`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seed: `ui-${Date.now()}` })
      });
      if (!response.ok) {
        throw new Error(`Server returned ${response.status}.`);
      }
      const payload = await response.json() as CreateRoomResponse;
      setFourAiRunning(false);
      setMode('server');
      setSnapshot(payload.room);
      setClaimLinks(payload.claimLinks);
      setRoomCodeInput(payload.room.roomCode);
      setConnectionState('connected');
      setStatus(`Created local server room ${payload.room.roomCode}. Claim a seat to play human actions.`);
      pushLog(`Created server room ${payload.room.roomCode}.`);
      connectWebSocket(payload.room.roomCode);
    } catch (error) {
      setConnectionState('offline');
      setStatus(`Local server unavailable (${error instanceof Error ? error.message : 'unknown error'}). Demo adapter is active.`);
      if (fallbackToDemo) {
        startDemo('Realtime server was not reachable; continued in local demo mode.');
      }
    }
  }, [apiBase, connectWebSocket, pushLog, startDemo]);

  useEffect(() => {
    if (didInitialConnect.current) {
      return;
    }
    didInitialConnect.current = true;
    void createServerRoom(true);
    return closeSocket;
  }, [closeSocket, createServerRoom]);

  const joinRoom = useCallback(async () => {
    const targetRoom = roomCodeInput.trim().toUpperCase();
    if (!targetRoom) {
      setStatus('Enter a room code to join an existing local server room.');
      return;
    }
    try {
      const response = await fetch(`${apiBase}/api/rooms/${encodeURIComponent(targetRoom)}`);
      if (!response.ok) {
        throw new Error(`Room lookup returned ${response.status}.`);
      }
      const payload = await response.json() as { readonly room: RoomSnapshot };
      setFourAiRunning(false);
      setMode('server');
      setSnapshot(payload.room);
      setClaimLinks([]);
      setConnectionState('connected');
      setStatus(`Joined ${targetRoom} as a spectator. Use a private claim link/token to take over a seat.`);
      connectWebSocket(targetRoom);
      pushLog(`Joined server room ${targetRoom}.`);
    } catch (error) {
      setStatus(`Could not join ${targetRoom}: ${error instanceof Error ? error.message : 'unknown error'}.`);
    }
  }, [apiBase, connectWebSocket, pushLog, roomCodeInput]);

  const claimSeat = useCallback(async (seatIndex: number) => {
    if (mode === 'demo') {
      setFourAiRunning(false);
      const claimedRound = withClaimedDemoSeat(demoRound, seatIndex, displayName);
      const advanced = advanceAiUntilHuman(claimedRound, seatIndex, aiDifficulty);
      const nextVersion = demoVersion + 1;
      setDemoRound(advanced.round);
      setDemoVersion(nextVersion);
      refreshDemoSnapshot(advanced.round, nextVersion, seatIndex);
      pushLog(`Seat ${seatIndex} claimed in local demo as ${displayName || 'Player'}.`);
      advanced.entries.forEach(pushLog);
      return;
    }

    const token = claimLinks.find((link) => link.seatIndex === seatIndex)?.token;
    if (!token) {
      setStatus('This room was joined without private claim links. Create a new local room or open a private claim URL.');
      return;
    }
    try {
      const response = await fetch(`${apiBase}/api/rooms/${encodeURIComponent(snapshot.roomCode)}/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seatIndex, token, displayName })
      });
      if (!response.ok) {
        throw new Error(`Claim returned ${response.status}.`);
      }
      const payload = await response.json() as ClaimSeatResponse;
      setFourAiRunning(false);
      const nextSession = { roomCode: payload.room.roomCode, seatIndex, sessionToken: payload.sessionToken };
      setSeatSession(nextSession);
      window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(nextSession));
      setSnapshot(payload.room);
      connectWebSocket(payload.room.roomCode, nextSession);
      pushLog(`Seat ${seatIndex} claimed as ${displayName || 'Player'}.`);
    } catch (error) {
      setStatus(`Seat claim failed: ${error instanceof Error ? error.message : 'unknown error'}.`);
    }
  }, [
    aiDifficulty,
    apiBase,
    claimLinks,
    connectWebSocket,
    demoRound,
    demoVersion,
    displayName,
    mode,
    pushLog,
    refreshDemoSnapshot,
    snapshot.roomCode
  ]);

  const submitAction = useCallback((action: LegalAction) => {
    if (!snapshot.legalActions.some((candidate) => actionMatches(candidate, action))) {
      setStatus('That action is no longer legal for the current room version.');
      return;
    }

    if (mode === 'server') {
      if (!seatSession || snapshot.viewerSeatIndex === undefined) {
        setStatus('Claim a seat before issuing human actions to the server.');
        return;
      }
      const socket = socketRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) {
        setStatus('Realtime socket is not connected. Reconnect or use the demo adapter.');
        return;
      }
      socket.send(JSON.stringify({
        type: 'command',
        id: crypto.randomUUID(),
        expectedVersion: snapshot.version,
        action
      }));
      pushLog(`Sent ${action.type} to server.`);
      return;
    }

    const viewerSeat = snapshot.viewerSeatIndex ?? 0;
    try {
      const afterHuman = applyLocalAction(demoRound, viewerSeat, action);
      const advanced = advanceAiUntilHuman(afterHuman, viewerSeat, aiDifficulty);
      const nextVersion = demoVersion + 1;
      setDemoRound(advanced.round);
      setDemoVersion(nextVersion);
      refreshDemoSnapshot(advanced.round, nextVersion, viewerSeat);
      pushLog(`You chose ${formatAction(action, snapshot)}.`);
      advanced.entries.forEach(pushLog);
      if (advanced.round.conclusion) {
        pushLog(advanced.round.conclusion.message);
      }
    } catch (error) {
      setStatus(`Action failed locally: ${error instanceof Error ? error.message : 'unknown error'}.`);
    }
  }, [aiDifficulty, demoRound, demoVersion, mode, pushLog, refreshDemoSnapshot, seatSession, snapshot]);

  const autoPlayDemo = useCallback(() => {
    if (mode !== 'demo') {
      setStatus('Auto-play is only available in the local demo adapter.');
      return;
    }
    const viewerSeat = snapshot.viewerSeatIndex ?? 0;
    const advanced = advanceAiUntilHuman(demoRound, viewerSeat, aiDifficulty);
    const nextVersion = demoVersion + 1;
    setDemoRound(advanced.round);
    setDemoVersion(nextVersion);
    refreshDemoSnapshot(advanced.round, nextVersion, viewerSeat);
    if (advanced.entries.length === 0) {
      pushLog('No AI action was needed; a human prompt is already available.');
    } else {
      advanced.entries.forEach(pushLog);
    }
  }, [aiDifficulty, demoRound, demoVersion, mode, pushLog, refreshDemoSnapshot, snapshot.viewerSeatIndex]);

  const stepFourAiSpectator = useCallback(() => {
    if (mode !== 'demo') {
      setFourAiRunning(false);
      setStatus('Four-AI spectator mode runs only in the local demo adapter.');
      return;
    }
    if (snapshot.viewerSeatIndex !== undefined || demoRound.players.some((player) => player.controller === 'human')) {
      setFourAiRunning(false);
      setStatus('Start a four-AI spectator game before running all-AI autoplay.');
      return;
    }
    if (demoRound.phase === 'finished') {
      setFourAiRunning(false);
      setStatus('Four-AI game finished.');
      return;
    }
    const advanced = advanceFourAiRound(demoRound, aiDifficulty);
    if (advanced.round === demoRound) {
      setFourAiRunning(false);
      setStatus('Four-AI game paused because no legal AI progress was possible.');
      pushLog('Four-AI spectator paused: no legal AI progress was possible.');
      return;
    }
    const nextVersion = demoVersion + 1;
    setDemoRound(advanced.round);
    setDemoVersion(nextVersion);
    refreshDemoSnapshot(advanced.round, nextVersion, undefined);
    advanced.entries.forEach(pushLog);
    if (advanced.round.conclusion) {
      setFourAiRunning(false);
      setStatus('Four-AI game finished.');
      pushLog(advanced.round.conclusion.message);
    }
  }, [aiDifficulty, demoRound, demoVersion, mode, pushLog, refreshDemoSnapshot, snapshot.viewerSeatIndex]);

  useEffect(() => {
    if (!fourAiRunning) {
      return undefined;
    }
    const timer = window.setInterval(stepFourAiSpectator, 650);
    return () => window.clearInterval(timer);
  }, [fourAiRunning, stepFourAiSpectator]);

  const discardActions = snapshot.legalActions.filter((action): action is Extract<LegalAction, { type: 'discard' }> => action.type === 'discard');
  const nonDiscardActions = snapshot.legalActions.filter((action) => action.type !== 'discard');
  const viewer = snapshot.viewerSeatIndex === undefined ? undefined : snapshot.round.players[snapshot.viewerSeatIndex];
  const currentPlayer = snapshot.round.players[snapshot.round.currentTurn];
  const lastDiscard = snapshot.round.lastDiscard;

  return (
    <main className="app-shell">
      <section className="hero card">
        <div>
          <p className="eyebrow">Playable local-first table</p>
          <h1>Hong Kong Mahjong</h1>
          <p>
            A responsive React Mahjong table with realtime server integration when available and a robust local demo adapter when it is
            not.
          </p>
        </div>
        <div className="hero-actions">
          <span className={`status-dot ${connectionState}`} />
          <strong>{mode === 'server' ? 'Local server room' : 'Demo adapter'}</strong>
          <span>{status}</span>
        </div>
      </section>

      <section className="control-grid">
        <article className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Room</p>
              <h2>{snapshot.roomCode}</h2>
            </div>
            <span className="seat-pill">{snapshot.round.phase}</span>
          </div>
          <div className="field-grid">
            <label className="field">
              API base
              <input value={apiBase} onChange={(event) => setApiBase(event.target.value)} />
            </label>
            <label className="field">
              WebSocket URL
              <input value={wsBase} onChange={(event) => setWsBase(event.target.value)} />
            </label>
            <label className="field">
              Room code
              <input value={roomCodeInput} onChange={(event) => setRoomCodeInput(event.target.value.toUpperCase())} placeholder="ABC123" />
            </label>
            <label className="field">
              Display name
              <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
            </label>
            <label className="field">
              AI difficulty
              <select value={aiDifficulty} onChange={(event) => setAiDifficulty(event.target.value as UiAiDifficulty)}>
                <option value="easy">Easy - loose discards</option>
                <option value="standard">Standard - simple safe discards</option>
                <option value="expert">Expert - claims pongs/kongs</option>
              </select>
            </label>
          </div>
          <div className="button-row">
            <button type="button" onClick={() => void createServerRoom(false)}>Create local server room</button>
            <button type="button" onClick={() => void joinRoom()}>Join room</button>
            <button type="button" onClick={() => startDemo()}>Use local demo</button>
            <button type="button" onClick={autoPlayDemo}>Auto-play to prompt</button>
            <button type="button" onClick={startFourAiSpectator}>Watch 4 AIs</button>
            <button type="button" onClick={() => setFourAiRunning((current) => !current)}>
              {fourAiRunning ? 'Pause 4 AIs' : 'Resume 4 AIs'}
            </button>
            <button type="button" onClick={stepFourAiSpectator}>Step 4 AIs</button>
            <button
              aria-label={revealAllTiles ? 'Hide all tiles' : 'Reveal all tiles'}
              className={`secret-reveal-button ${revealAllTiles ? 'active' : ''}`}
              title={revealAllTiles ? 'Hide all tiles' : 'Reveal all tiles'}
              type="button"
              onClick={toggleRevealAllTiles}
            >
              {revealAllTiles ? 'Hide' : '·'}
            </button>
          </div>
          {snapshot.viewerSeatIndex === undefined && mode === 'demo' ? (
            <p className="muted">Four-AI spectator mode is active: all seats stay AI-controlled and advance on the local page.</p>
          ) : null}
        </article>

        <article className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Seat takeover</p>
              <h2>{viewer ? `Viewing ${viewer.displayName}` : 'Spectator'}</h2>
            </div>
          </div>
          <div className="seat-grid">
            {snapshot.seats.map((seat) => (
              <button className="seat-card" key={seat.seatIndex} type="button" onClick={() => void claimSeat(seat.seatIndex)}>
                <strong>{WIND_LABELS[seat.wind]}</strong>
                <span>{seat.displayName}</span>
                <small>{seat.claimed ? 'Claimed' : mode === 'server' ? 'Claim with private token' : 'Take over locally'}</small>
              </button>
            ))}
          </div>
          {seatSession ? <p className="muted">Stored session for seat {seatSession.seatIndex} in room {seatSession.roomCode}.</p> : null}
        </article>
      </section>

      <section className="table-overview card">
        <div className="round-metrics">
          <div>
            <span>Wall</span>
            <strong>{snapshot.round.wall.liveCount}</strong>
            <small>{snapshot.round.wall.deadCount} dead / {snapshot.round.wall.replacementDrawCount} replacements</small>
          </div>
          <div>
            <span>Round wind</span>
            <strong>{WIND_LABELS[snapshot.round.prevailingWind]}</strong>
            <small>Dealer: seat {snapshot.round.dealerSeat}</small>
          </div>
          <div>
            <span>Current turn</span>
            <strong>{currentPlayer?.displayName ?? 'None'}</strong>
            <small>Turn {snapshot.round.turnNumber}</small>
          </div>
          <div>
            <span>Last discard</span>
            <strong>{lastDiscard ? lastDiscard.tile.name : 'None'}</strong>
            <small>{lastDiscard ? `from seat ${lastDiscard.bySeat}` : 'No claim window'}</small>
          </div>
        </div>
      </section>

      <section className="action-panel card" aria-live="polite">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Eligible actions</p>
            <h2>{snapshot.legalActions.length > 0 ? 'Your prompt' : 'Waiting for table'}</h2>
          </div>
        </div>
        {snapshot.legalActions.length === 0 ? (
          <p className="muted">No legal human action is currently available. Claim the active seat, reconnect, or auto-play in demo mode.</p>
        ) : (
          <>
            {discardActions.length > 0 ? <p>Select a tile in your hand to discard, or choose another legal action below.</p> : null}
            <div className="button-row">
              {nonDiscardActions.map((action) => (
                <button key={JSON.stringify(action)} type="button" onClick={() => submitAction(action)}>
                  {formatAction(action, snapshot)}
                </button>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="mahjong-table">
        {snapshot.round.players.map((player) => (
          <PlayerPanel
            key={player.seatIndex}
            player={player}
            isCurrent={player.seatIndex === snapshot.round.currentTurn}
            isViewer={player.seatIndex === snapshot.viewerSeatIndex}
            discardActions={player.seatIndex === snapshot.viewerSeatIndex ? discardActions : []}
            drawnTileId={
              player.seatIndex === snapshot.viewerSeatIndex && snapshot.round.lastDraw?.seatIndex === player.seatIndex
                ? snapshot.round.lastDraw.tile.id
                : undefined
            }
            revealHand={snapshot.round.phase === 'finished' || revealAllTiles}
            winningTile={snapshot.round.conclusion?.winnerSeat === player.seatIndex ? snapshot.round.conclusion.winningTile : undefined}
            onAction={submitAction}
          />
        ))}
      </section>

      <section className="side-panels">
        <article className="card">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Scores & payments</p>
              <h2>Table ledger</h2>
            </div>
          </div>
          <div className="score-list">
            {snapshot.round.players.map((player) => (
              <div key={player.seatIndex}>
                <span>{WIND_LABELS[player.wind]} · {player.displayName}</span>
                <strong>{player.score}</strong>
              </div>
            ))}
          </div>
          <p className="muted">
            Payments are calculated from the engine Fan/payment tables when a winning hand is scored. Current round:{' '}
            {snapshot.round.conclusion?.message ?? 'in progress'}.
          </p>
          {snapshot.round.conclusion?.settlement ? (
            <div className="settlement-panel" aria-label="winning hand settlement">
              <div className="settlement-summary">
                <span>
                  <strong>{snapshot.round.conclusion.settlement.fan} Fan</strong>
                  <small>
                    {snapshot.round.conclusion.settlement.eligible
                      ? `${snapshot.round.conclusion.settlement.basePoints} base points before doublings`
                      : `below ${snapshot.round.conclusion.settlement.minFan} minimum Fan; no payment`}
                  </small>
                </span>
                {snapshot.round.conclusion.winningTile ? <TileView tile={snapshot.round.conclusion.winningTile} winning /> : null}
              </div>
              <div className="feature-list">
                {snapshot.round.conclusion.settlement.includedFeatures.length === 0 ? (
                  <span className="muted">No Fan features scored.</span>
                ) : snapshot.round.conclusion.settlement.includedFeatures.map((feature) => (
                  <span className="feature-pill" key={`${feature.id}-${feature.source ?? 'hand'}`}>
                    {feature.name} · {feature.fan} Fan
                  </span>
                ))}
              </div>
              <div className="payment-lines">
                {snapshot.round.conclusion.settlement.paymentLines.length === 0 ? (
                  <span className="muted">No players pay because the hand did not meet the minimum Fan.</span>
                ) : snapshot.round.conclusion.settlement.paymentLines.map((line) => (
                  <div key={`${line.from}-${line.to}`}>
                    <span>{playerLabel(snapshot, line.from)} pays {playerLabel(snapshot, line.to)}</span>
                    <strong>{line.points}</strong>
                    <small>{line.reasons.join(', ')}</small>
                  </div>
                ))}
              </div>
              <div className="delta-grid">
                {snapshot.round.players.map((player) => (
                  <span key={player.seatIndex}>
                    {player.displayName}: {formatScoreDelta(snapshot.round.conclusion?.settlement?.deltas[player.wind] ?? 0)}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </article>

        <article className="card log-panel">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Game log</p>
              <h2>Recent events</h2>
            </div>
          </div>
          <ol>
            {gameLog.map((entry, index) => (
              <li key={`${entry}-${index}`}>{entry}</li>
            ))}
          </ol>
        </article>
      </section>

      <RulesPanel
        minFan={minFan}
        fanConfig={fanConfig}
        paymentTable={DEFAULT_HONG_KONG_RULES.paymentTable}
        onMinFanChange={(value) => setMinFan(Number.isFinite(value) ? value : DEFAULT_HONG_KONG_RULES.minFan)}
        onFanToggle={(id) => {
          setFanConfig((current) => current.map((rule) => rule.id === id ? { ...rule, enabled: !rule.enabled } : rule));
          pushLog(getRuleDescription(fanConfig, id));
        }}
      />
    </main>
  );
}
