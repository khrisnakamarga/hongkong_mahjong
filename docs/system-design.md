# Hong Kong Mahjong System Design

This document explains the application as a system-design-interview style walkthrough: requirements, architecture, core data model, APIs, scaling strategy, tradeoffs, and follow-ups. See `docs\architecture-diagrams.md` for Mermaid diagrams of the application code and Azure deployment.

## 1. Problem statement

Design a web-based Hong Kong Mahjong table where four people can play in realtime. Empty seats are filled by AI by default, and a human can join later to take over an AI seat. The game must enforce Hong Kong Mahjong rules, show claim windows for eligible calls, score wins with a configurable Fan/payment table, support four-AI autonomous play, run locally/LAN, and be prepared for Azure deployment.

## 2. Functional requirements

1. Support four seats: East, South, West, North.
2. Default every seat to AI; allow human takeover with a private seat token.
3. Run the full gameplay loop: deal, draw, discard, claim window, melds, Kong replacement, win, exhaustive draw, scoring, and payments.
4. Notify only eligible players for Chow, Pong, Kong, and Mahjong claims.
5. Use one legal-action model for humans and AI so both can perform the same actions.
6. Reveal hidden hands only at the end of a round, then show the winning tile and settlement.
7. Provide a configurable minimum Fan and visible Fan/payment defaults.
8. Provide local, LAN, unit, integration, simulation, and E2E testing.
9. Prepare Azure deployment artifacts without requiring a cloud deployment during local development.

## 3. Non-functional requirements

| Area | Requirement |
| --- | --- |
| Correctness | Server-authoritative state transitions; all commands validated against legal actions. |
| Consistency | One shared game engine used by server, AI, tests, and local demo UI. |
| Privacy | Concealed hands hidden from non-viewers until the round is finished. |
| Latency | Realtime WebSocket updates for table snapshots and claim prompts. |
| Testability | Deterministic seeded walls and pure engine functions for repeatable tests. |
| Deployability | Containerized app with AZD/Bicep artifacts for Azure Container Apps. |
| Operability | Planned managed logs, metrics, secrets, and durable room storage in Azure. |

## 4. High-level architecture

```text
Browser / React Client
  - renders table state
  - sends selected legal actions
  - supports local demo and four-AI spectator mode
        |
        | HTTP + WebSocket
        v
Node.js Realtime Server
  - creates rooms and private seat links
  - validates commands
  - runs AI turns
  - broadcasts snapshots and action prompts
        |
        v
Shared Game Engine Package
  - tiles, wall, state machine
  - legal action generation
  - win detection, Fan scoring, payments
  - AI policy helpers
```

For local demo mode, the React client can run the shared engine directly. For multiplayer rooms, the server is authoritative.

## 5. Component responsibilities

| Component | Path | Responsibility |
| --- | --- | --- |
| React client | `apps\client` | Table UI, room controls, action buttons, local demo adapter, four-AI spectator mode. |
| Realtime server | `apps\server` | Room lifecycle, WebSocket protocol, seat takeover, command validation, AI scheduling. |
| Game engine | `packages\game-engine` | Pure deterministic rules, legal actions, scoring, payments, and AI decisions. |
| E2E tests | `e2e` | Browser validation for table visibility, AI play, drawn tile behavior, and local flows. |
| Azure artifacts | `.azure`, `infra`, `azure.yaml`, `Dockerfile` | Container Apps deployment preparation and infrastructure definition. |

## 6. Core domain model

The main engine state is `RoundState`.

```text
RoundState
  phase: awaitingDraw | awaitingDiscard | awaitingClaims | finished
  dealerSeat
  prevailingWind
  currentTurn
  turnNumber
  players[4]
  wall
  lastDiscard?
  lastDraw?
  conclusion?

PlayerState
  seatIndex
  wind
  controller: ai | human
  displayName
  score
  concealedTiles
  flowers
  melds
  discards
```

The design keeps the domain model independent of React and WebSockets. That makes gameplay testable as pure TypeScript and lets AI, server, and UI share the same rules.

## 7. Legal-action interface

The engine exposes legal actions such as:

- `draw`
- `discard`
- `pass`
- `chow`
- `pong`
- `kong`
- `win`

The server never trusts a client action directly. It checks the submitted action against `getLegalActions(round, seatIndex)`. AI also chooses from the same action list, which is why tests can assert human/AI action parity.

## 8. Turn and claim flow

```text
awaitingDraw
  current player draws from live wall
  flowers/seasons are replaced from the dead wall
  -> awaitingDiscard

awaitingDiscard
  current player discards, declares Kong, or declares win
  discard opens a claim window
  -> awaitingClaims

awaitingClaims
  eligible players can claim Mahjong/Pong/Kong/Chow or pass
  highest-priority accepted claim wins
  if no claim, next player draws
  -> awaitingDraw or awaitingDiscard

finished
  all hands are revealed
  winning tile is separated/highlighted
  Fan/payment settlement is shown and scores are updated
  next-round action carries scores forward and starts a fresh deal
```

## 9. Win reveal and settlement design

When a round finishes by win:

1. Engine stores the winner, source, winning tile, and settlement in `RoundConclusion`.
2. Settlement includes total Fan, minimum Fan, included Fan features, payment lines, and per-wind score deltas.
3. Server/client snapshots reveal every concealed hand only when `phase === 'finished'`.
4. UI separates the winning tile from the winning hand and uses a distinct visual treatment.
5. The ledger shows who pays whom and why, including self-pick/discard/East doublings.

This avoids leaking hidden information during play while still giving players full post-round explainability.

After a win or exhaustive draw, the shared engine creates the next round from the finished state. Dealer retention follows Hong Kong Mahjong convention: dealer win or draw keeps the dealer; non-dealer win advances dealership. The engine tracks the seat that started the current prevailing-wind cycle and advances the round wind when dealership returns to that seat.

## 10. Scoring and payments

The scoring system separates two concerns:

1. **Fan scoring** detects scoring features from the winning hand.
2. **Payment calculation** maps Fan to base points and applies payment doublings.

Default payment bands:

| Fan | Base points |
| --- | ---: |
| 0 | 1 |
| 1 | 2 |
| 2 | 4 |
| 3 | 8 |
| 4-6 | 16 |
| 7-9 | 32 |
| 10-12 | 64 |
| 13+ | 128 |

Doublings stack:

- Discard win: discarder pays double.
- Self-pick: all losing players pay double.
- East winner: all payments double.
- East payer losing: East's payment doubles.

## 11. Realtime room design

Rooms are created with four private claim tokens. A claim token lets a user take over one AI seat. The server keeps the raw token out of persistent room state by storing a hash.

Typical room flow:

```text
POST /api/rooms
  -> room code + four private claim links

POST /api/rooms/{roomCode}/claim
  -> session token for a seat

WebSocket connect
  -> snapshot stream
  -> action-required notifications
  -> command submission
```

## 12. Client rendering model

The client renders a room snapshot rather than mutating game state directly in multiplayer mode.

Important UI rules:

- Viewer's concealed hand is visible during play.
- Non-viewer hands use tile backs during play.
- All hands are revealed after round finish.
- A newly drawn tile remains separated on the right and highlighted until discarded or the round ends.
- The winning tile is separated and highlighted in the final hand reveal.
- The action panel only displays actions present in the legal-action snapshot.
- When the round is finished, the action panel exposes **Start next round** to continue play.

## 13. Local and LAN modes

Local development uses:

- `npm run dev` for client/server on localhost.
- `npm run dev:lan` to bind client/server to `0.0.0.0` for local network testing.
- Four-AI spectator mode in the browser for observing AI-only gameplay.

This lets the app be tested without Azure or external services.

## 14. Azure target architecture

The deployment plan targets:

| Need | Azure service |
| --- | --- |
| Container hosting | Azure Container Apps |
| Container registry | Azure Container Registry |
| Durable room/game state | Cosmos DB for NoSQL |
| Secrets/config | Key Vault |
| Logs/metrics | Log Analytics + Application Insights |

The current implementation uses in-memory adapters for live room state and coordination, so the Azure deployment is intentionally capped at one replica. A future scale-out design can add durable repository and distributed coordination adapters behind the same interfaces.

## 15. Scaling considerations

For the current one-server-instance deployment, room state can live in memory. For multiple instances:

1. Persist room snapshots and event history to Cosmos DB.
2. Use distributed locks, action-window coordination, and pub/sub fanout.
3. Make WebSocket instances stateless except for connected sockets.
4. Route every command through an atomic room update to prevent double-discard or duplicate claims.
5. Use deterministic engine transitions so replay/debugging is possible from room events.

## 16. Consistency and concurrency

The highest-risk race is the claim window: multiple players may try to Chow/Pong/Kong/Mahjong the same discard.

The design handles this by:

- Generating legal actions per seat.
- Tracking room version numbers.
- Rejecting stale commands.
- Using a room-level lock/coordination adapter for authoritative updates.
- Resolving claim priority in the server/engine rather than in clients.

## 17. Security considerations

- Treat seat tokens and session tokens as bearer secrets.
- Store token hashes server-side.
- Do not expose concealed hands in snapshots before round end.
- Validate every submitted action server-side.
- Use Key Vault for production secrets.
- Prefer managed identities for Azure service access.

## 18. Observability considerations

Production should emit:

- Room creation and join counts.
- WebSocket connection counts.
- Command accept/reject counts.
- Stale command frequency.
- AI decision errors.
- Round completion and settlement summaries.
- Latency for command-to-broadcast.

The Azure plan includes Application Insights and Log Analytics for these signals.

## 19. Testing strategy

| Layer | Coverage |
| --- | --- |
| Engine unit tests | Tile set, wall generation, legal actions, claims, scoring, settlement, payments. |
| AI/simulation tests | Four AI players can complete deterministic games. |
| Server tests | Seat takeover, stale command rejection, WebSocket snapshots, claim notifications. |
| Client E2E tests | UI visibility/privacy, four-AI spectator mode, drawn tile placement. |
| Build checks | TypeScript, lint, production build, Docker/Bicep smoke checks when tools are available. |

## 20. Key tradeoffs

| Decision | Benefit | Tradeoff |
| --- | --- | --- |
| Shared pure engine | Consistent rules for AI/server/UI/tests | More upfront domain modeling. |
| Server-authoritative commands | Prevents cheating and client divergence | Requires realtime command round trips. |
| Room code + private token | Simple no-account onboarding | Tokens must be protected like secrets. |
| In-memory local adapters | Fast local iteration | Multi-replica production needs durable repository and coordination adapters. |
| Snapshot-based UI | Simple client rendering and privacy controls | Large snapshots may need optimization later. |

## 21. Current limitations and follow-ups

1. Azure resources are prepared but not deployed.
2. Local room state is in-memory; production durability requires Cosmos DB adapter implementation.
3. Distributed fanout/locking is planned but not required for local testing.
4. Rule coverage is focused on the documented Hong Kong Mahjong assumptions; rare house rules can be added behind configuration.
5. Account-based identity is intentionally deferred in favor of private claim links.

## 22. Where to read the implementation

Start in this order:

1. `docs\hong-kong-mahjong-rules.md` for rules and scoring assumptions.
2. `.azure\deployment-plan.md` for Azure/service architecture.
3. `packages\game-engine\src\state.ts` for the domain model.
4. `packages\game-engine\src\engine.ts` for state transitions and settlement.
5. `packages\game-engine\src\actions.ts` for legal actions.
6. `packages\game-engine\src\scoring.ts` and `payments.ts` for Fan and payment math.
7. `apps\server\src\room-manager.ts` for authoritative multiplayer flow.
8. `apps\client\src\App.tsx` for UI rendering and local demo behavior.
