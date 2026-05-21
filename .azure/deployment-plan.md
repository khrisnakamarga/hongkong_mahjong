# Azure Deployment Plan

> **Status:** Executing

Generated: 2026-05-19

---

## 1. Project Overview

**Goal:** Build and prepare an Azure-deployable web application where four players can play Hong Kong Mahjong, with AI seats that humans can take over, rules aligned to the attached Hong Kong Mahjong Rule Sheet, configurable Fan scoring, local/LAN play, automated tests, and Azure deployment scripts.

**Path:** New Project

**Workspace state:** The repository now contains an npm workspace with a React client, Node.js WebSocket server, shared TypeScript game engine, tests, local scripts, Docker production container, and AZD/Bicep preparation artifacts. Azure validation/deployment remains blocked until the requested subscription and quota checks are available.

---

## 2. Requirements

| Attribute | Value |
|-----------|-------|
| Classification | Production-ready |
| Scale | Multiple simultaneous four-player rooms on one Container Apps replica; scale-out requires future durable coordination adapters |
| Budget | Cost-conscious first deployment with Container Apps, Cosmos DB, and monitoring |
| Subscription | Visual Studio Enterprise subscription tied to personal account `khrisnaadi@gmail.com` |
| Location | `westus3` |

### Product Requirements

- Four-seat Hong Kong Mahjong game with AI players by default.
- Human users can join the site and take over an AI-controlled seat.
- Human takeover uses room codes plus private seat claim tokens/links; no account signup is required for the initial production plan.
- AI difficulty selection per AI seat.
- Complete round/match lifecycle: seating, dealer/round wind progression, wall/dead-wall handling, flowers, draws, discards, calls, wins, payments, and game conclusion.
- Configurable Fan table and minimum Fan rule.
- Player notifications for eligible Chow, Pong, Kong, and Mahjong calls.
- UI shows player hand, melded sets, discards, flowers/seasons, round/seat winds, dealer, current turn, wall count, dead-wall/replacement status, available actions, score/payments, and room state.
- Unit and E2E coverage, including four-AI autonomous game completion and parity that humans can perform all AI actions.
- Local test/start scripts, including LAN-accessible hosting.
- Documentation file capturing the assumed Hong Kong Mahjong rules.

### Rule Source of Truth

The attached PDF is the primary rules source. Planned assumptions from the PDF:

- A standard winning hand is four sets plus a pair, with special hands for Seven Pairs, Thirteen Orphans, Nine Gates, Blessings, Seven Flowers, and Eight Flowers.
- Sets are sequences, triplets, or quadruplets. Chow only from the player to the left; Pong/Kong from any discard; concealed/self-formed Kongs draw replacement tiles from the dead wall.
- Fan scoring is additive unless an indented child feature replaces the parent feature.
- Triplets and quadruplets are interchangeable unless stated otherwise.
- Classical payment table: 0 Fan = 1 point, 1 = 2, 2 = 4, 3 = 8, 4-6 = 16, 7-9 = 32, 10-12 = 64, 13+ = 128.
- Payment doublings stack: discarder doubles on discard win, all players double on self-pick, East winning doubles all payments, East losing doubles East's payment.
- Hong Kong minimum Fan varies by table and will be configurable.

---

## 3. Components Detected

| Component | Type | Technology | Path |
|-----------|------|------------|------|
| Client | React app | TypeScript, Vite, React | `apps/client/` |
| Realtime server | Node.js HTTP/WebSocket server | TypeScript, `ws`, static production asset serving | `apps/server/` |
| Game engine | Shared domain package | TypeScript, deterministic rules/scoring/turn state | `packages/game-engine/` |
| Tests | Unit and E2E suites | Vitest + Playwright scaffolding | `packages/*`, `e2e/` |
| Azure infrastructure | Deployment preparation config | AZD + Bicep + Docker | `azure.yaml`, `Dockerfile`, `infra/` |

---

## 4. Recipe Selection

**Selected:** AZD (Bicep), production-ready scale-out profile.

**Rationale:**

- This is a new Azure-first application, and AZD is the default recipe for new projects.
- A containerized realtime web app supports WebSocket gameplay and can scale out behind Azure Container Apps.
- Bicep keeps Azure resource definitions first-party and straightforward for Container Apps/App Service style hosting.
- Shared state services are needed because production scale-out cannot rely on in-memory room state.
- Azure deployment execution will be handled later by the `azure-deploy` workflow after validation; this plan only prepares the app and artifacts.

---

## 5. Architecture

**Recommended stack:** Containerized TypeScript full-stack app with shared state and durable room/game records.

### Application Architecture

| Component | Responsibility |
|-----------|----------------|
| React client | Mahjong table UI, room join/takeover flow, player actions, rules/scoring display |
| Node.js realtime server | WebSocket transport, authoritative command validation, AI turns, call windows, payments, and scale-out coordination |
| Shared game engine | Pure deterministic tile model, wall/dead wall, turn state machine, legal action generation, Fan scoring, payment calculation, AI policy hooks |
| AI strategies | Easy/medium/hard action selection over the same legal-action interface used by humans |
| Shared state layer | Persist room/game snapshots, rules configuration, seat claim token hashes, score ledgers, and game history; coordinate realtime instances |
| Test harness | Simulate games without UI; drive browser E2E scenarios |
| Rule documentation | `docs/hong-kong-mahjong-rules.md` documenting PDF-derived assumptions and any researched variants |

### Azure Service Mapping

| Component | Azure Service | SKU |
|-----------|---------------|-----|
| Realtime web app container | Azure Container Apps | Balanced production profile; start cost-conscious and scale by concurrency/CPU |
| Container image | Azure Container Registry | Basic |
| Shared/persistent game state | Azure Cosmos DB for NoSQL | Serverless NoSQL database with `rooms` and `gameEvents` containers |
| Monitoring | Application Insights + Log Analytics | Consumption/basic defaults |
| Secrets/config | Azure Key Vault + managed identity | Standard |
| Static assets | Served by the app container initially | N/A |

### Provisioning Limit Checklist

This cannot be finalized until subscription, region, and deployment profile are confirmed. Planned resource inventory:

| Resource Type | Number to Deploy | Notes |
|---------------|------------------|-------|
| Microsoft.App/managedEnvironments | 1 | Container Apps environment |
| Microsoft.App/containerApps | 1 | Web/game server |
| Microsoft.ContainerRegistry/registries | 1 | Container image registry |
| Microsoft.DocumentDB/databaseAccounts | 1 | Cosmos DB account for persistent room/game state |
| Microsoft.KeyVault/vaults | 1 | Secret/config protection |
| Microsoft.OperationalInsights/workspaces | 1 | Centralized logs |
| Microsoft.Insights/components | 1 | Application Insights |

Before execution reaches validation, Azure context must be confirmed and quotas checked using the Azure quota workflow.

Current Azure CLI context check: the local CLI lists subscriptions for `kkamarga@microsoft.com`, not the requested personal Visual Studio Enterprise subscription. Per user direction, proceed with the implementation plan and leave quota validation blocked until the requested subscription is available to the CLI.

---

## 6. Implementation Plan

### Phase 1: Requirements and Research

- Confirm any preferred technology constraints.
- Research Hong Kong Mahjong gameplay variants only where the PDF is incomplete or ambiguous.
- Create `docs/hong-kong-mahjong-rules.md` with exact assumptions, Fan table defaults, optional rules, and unsupported/deferred variants.

### Phase 2: Project Foundation

- Create TypeScript workspace structure with shared engine, web app, server, tests, lint/typecheck/build scripts, and local/LAN scripts.
- Add development scripts for local play and LAN play.
- Add initial visual design system for tile rendering, table layout, player zones, action prompts, and scoring panels.

### Phase 3: Game Engine

- Implement tile taxonomy, wall generation/shuffle, flower/season replacement, seating, dealer and round-wind progression.
- Implement authoritative turn state machine: draw, discard, call-claim windows, meld resolution, Kong replacement, win declaration, exhaustive draw, and round transition.
- Implement legal-action generation for human and AI players.
- Implement Fan scoring and payment calculation from configurable scoring tables.
- Implement game conclusion rules and score ledger.

### Phase 4: Multiplayer and AI

- Implement room/session model with four seats defaulting to AI.
- Implement WebSocket protocol for state snapshots, player commands, claim notifications, action deadlines, reconnection, and human takeover.
- Implement AI difficulty policies using the same legal-action interface as humans.
- Ensure four AIs can complete at least one full game autonomously.

### Phase 5: UI/UX

- Build table UI showing hands, melds, discard piles, flowers/seasons, wall count, dealer, winds, current turn, claim prompts, Fan/payment breakdown, and game log.
- Build room creation/join/takeover flows.
- Build configurable rules/Fan table screen with sensible defaults matching the PDF.
- Add responsive layout suitable for desktop/tablet play.

### Phase 6: Testing

- Unit test tile logic, legal actions, scoring patterns, payment doublings, round transitions, AI action parity, and edge cases like Robbing the Kong/Kong replacement.
- Integration test full room/game state transitions over the server protocol.
- E2E test four AI players completing a game and human users performing all action types available to AI.
- Add deterministic seeded test games for reproducibility.

### Phase 7: Azure Deployment Preparation

- Add Dockerfile and production build pipeline.
- Add `azure.yaml` and Bicep infrastructure for Container Apps, ACR, Cosmos DB, Key Vault, Log Analytics, and Application Insights.
- Add environment configuration and deployment documentation.
- Keep this plan in `Executing` until app implementation, subscription context, quota validation, and local-only artifact validation are complete; do not mark `Ready for Validation` yet.

---

## 7. Files to Generate

| File | Purpose | Status |
|------|---------|--------|
| `.azure/deployment-plan.md` | Azure deployment source of truth | Updated; status remains Executing |
| `docs/hong-kong-mahjong-rules.md` | Rule assumptions and PDF mapping | Existing/planned outside this artifact task |
| `package.json` / workspace config | Project scripts and dependencies | Existing |
| `packages/game-engine/` | Deterministic rules/scoring engine | Existing; local build/test fixes applied where needed |
| `apps/client/` | React UI | Existing |
| `apps/server/` | HTTP/WebSocket server | Existing; production static asset serving added |
| `e2e/` | Browser E2E tests | Existing scaffold |
| `azure.yaml` | AZD configuration | Generated |
| `.dockerignore` | Docker build context hygiene | Generated |
| `Dockerfile` | Production container build | Generated and Docker-smoke-tested locally |
| `infra/main.bicep` | Azure infrastructure | Generated; pending Bicep CLI validation because local Bicep is not installed |
| `infra/main.parameters.json` | AZD/Bicep parameter mapping | Generated |
| `infra/README.md` | Local-only artifact validation notes | Generated |
| `scripts/` | Local, LAN, test, and deployment helper scripts | Existing local scripts |

---

## 8. Current Blockers / Questions

- Make the requested Visual Studio Enterprise subscription available in Azure CLI before Azure validation/deployment.
- Complete quota validation for `westus3` before Azure validation/deployment.
- Install or make the Bicep CLI available locally before Bicep build validation; `az bicep version` reported Bicep CLI not found and no install was attempted.
- Full application implementation and quota validation are not complete, so this plan is not ready for `azure-validate`.
