# Architecture Diagrams

This document captures the Hong Kong Mahjong application architecture in a product-spec and architecture-review friendly format. The diagrams use Mermaid so they render directly in GitHub Markdown.

## 1. Product requirements traceability

| Product requirement | Architecture support |
| --- | --- |
| Four players per table | Room state owns exactly four seats: East, South, West, North. |
| AI seats by default | Room creation initializes all seats as AI; human takeover changes seat controller. |
| Human takeover | Private room/seat claim token flow authorizes a browser session to control one seat. |
| Full gameplay | Shared game engine owns wall, draws, discards, claims, melds, wins, payments, next-round flow. |
| Claim notifications | Server derives legal actions per seat and emits action-required WebSocket prompts. |
| Adjustable Fan table | Engine scoring reads rules/config data; UI exposes minimum Fan and scoring defaults. |
| AI/player action parity | AI and humans select from the same `LegalAction` union. |
| Reveal all hands after win/draw | Finished-round snapshots reveal all concealed hands and settlement details. |
| Local/LAN play | React client, Node server, and shared engine run locally; LAN script binds to `0.0.0.0`. |
| Azure deployability | Docker, AZD, and Bicep target Azure Container Apps with managed backing services. |

## 2. Application code architecture

This is the C4-style container view of the codebase.

```mermaid
flowchart LR
  subgraph Users["Players and observers"]
    Human["Human player browser"]
    Spectator["Spectator / 4-AI watcher"]
  end

  subgraph Client["apps/client - React + Vite"]
    UI["Mahjong table UI\nhands, melds, discards, wall, actions"]
    LocalDemo["Local demo adapter\nsingle-browser engine runner"]
    Reveal["Debug reveal toggle\nlocal snapshot reveal only"]
  end

  subgraph Server["apps/server - Node.js HTTP + WebSocket"]
    HttpApi["HTTP API\ncreate room, claim seat, health"]
    WsGateway["WebSocket gateway\nsnapshots and commands"]
    RoomManager["RoomManager\nauthoritative room state"]
    AiScheduler["AI scheduler hook\nsubmits AI legal actions"]
    RoomRepo["Room repository interface\nin-memory now, durable later"]
    Coordination["Coordination interface\nlocks and pub/sub"]
  end

  subgraph Engine["packages/game-engine - deterministic domain package"]
    StateMachine["Round state machine\ndraw, discard, claim, win, next round"]
    LegalActions["Legal action generator\nDraw/Discard/Pass/Chow/Pong/Kong/Win/NextRound"]
    Scoring["Fan scoring and payments\nsettlement and score deltas"]
    AiPolicy["AI decision policies\neasy/medium/hard"]
    Rules["Hong Kong Mahjong rules data\nFan and payment tables"]
  end

  subgraph Tests["Quality gates"]
    Unit["Vitest unit/integration tests"]
    E2E["Playwright E2E tests"]
  end

  Human --> UI
  Spectator --> UI
  UI -->|HTTP room/claim| HttpApi
  UI -->|WebSocket commands| WsGateway
  UI -->|local-only demo| LocalDemo
  Reveal --> LocalDemo

  HttpApi --> RoomManager
  WsGateway --> RoomManager
  RoomManager --> RoomRepo
  RoomManager --> Coordination
  RoomManager --> LegalActions
  RoomManager --> StateMachine
  RoomManager --> Scoring
  AiScheduler --> AiPolicy
  AiPolicy --> LegalActions
  AiPolicy --> StateMachine
  LocalDemo --> StateMachine
  LocalDemo --> LegalActions
  LocalDemo --> AiPolicy
  StateMachine --> Rules
  Scoring --> Rules

  Unit --> Engine
  Unit --> Server
  E2E --> Client
  E2E --> Server
```

### Runtime command flow

```mermaid
sequenceDiagram
  autonumber
  participant Browser as Browser client
  participant Server as WebSocket server
  participant Room as RoomManager
  participant Engine as Shared game engine
  participant AI as AI scheduler

  Browser->>Server: command(expectedVersion, legal action)
  Server->>Room: submitSeatAction(...)
  Room->>Engine: getLegalActions(round, seat)
  Engine-->>Room: legal actions for that seat
  Room->>Room: reject if stale, malformed, or illegal
  Room->>Engine: apply action to RoundState
  Engine-->>Room: next RoundState
  Room-->>Server: saved room + new version
  Server-->>Browser: snapshot(room, legalActions)
  Room->>AI: schedule AI if AI has legal actions
  AI->>Room: submit selected legal action
```

### Privacy and trust boundaries

```mermaid
flowchart TB
  subgraph BrowserBoundary["Browser trust boundary"]
    BrowserState["Visible snapshot only\nviewer hand + public table info"]
    ClientAction["Selected action\nnever trusted as authoritative"]
  end

  subgraph ServerBoundary["Server trust boundary"]
    Validation["Legal-action validation"]
    SecretTokens["Seat/session token hashes"]
    FullRound["Full concealed room state"]
  end

  subgraph DomainBoundary["Pure domain boundary"]
    EngineState["RoundState transition functions"]
    PaymentMath["Fan and payment math"]
  end

  BrowserState --> ClientAction
  ClientAction --> Validation
  Validation --> FullRound
  FullRound --> EngineState
  EngineState --> PaymentMath
  FullRound -. "concealed tiles withheld until finished" .-> BrowserState
  SecretTokens -. "raw tokens not persisted" .-> Validation
```

## 3. Azure deployment architecture

This diagram reflects the prepared `azure.yaml`, `Dockerfile`, and `infra\main.bicep` deployment target.

```mermaid
flowchart TB
  subgraph Internet["Internet"]
    Player1["Player browsers"]
    Player2["LAN/remote browsers"]
  end

  subgraph Azure["Azure subscription / resource group"]
    subgraph ACA["Azure Container Apps"]
      Ingress["HTTPS ingress\nWeb + WebSocket"]
      WebApp["Container App: web\nNode server + static React assets"]
      Env["Managed Environment"]
    end

    ACR["Azure Container Registry\ncontainer image"]
    MI["Managed Identity\napp identity"]
    KV["Azure Key Vault\nsecret references"]
    Cosmos["Azure Cosmos DB for NoSQL\nrooms + gameEvents"]
    AppInsights["Application Insights\napp telemetry"]
    LogAnalytics["Log Analytics Workspace\ncentral logs"]
  end

  subgraph Deployment["Deployment pipeline"]
    Source["Repo source\nTypeScript monorepo"]
    Docker["Docker build\nproduction container"]
    AZD["Azure Developer CLI\nazd provision/deploy"]
    Bicep["Bicep infrastructure\ninfra/main.bicep"]
  end

  Player1 -->|HTTPS + WebSocket| Ingress
  Player2 -->|HTTPS + WebSocket| Ingress
  Ingress --> WebApp
  WebApp -->|pull image| ACR
  WebApp -->|managed identity| MI
  MI -->|read secrets| KV
  WebApp -->|room snapshots/history| Cosmos
  WebApp -->|telemetry| AppInsights
  AppInsights --> LogAnalytics
  Env --> LogAnalytics

  Source --> Docker
  Docker --> ACR
  Source --> AZD
  Bicep --> AZD
  AZD --> Azure
```

### Azure resource responsibility matrix

| Azure resource | Responsibility | Architecture standard addressed |
| --- | --- | --- |
| Azure Container Apps | Hosts the unified Node server and built React assets; current deployment is capped at one replica while room coordination is in memory. | Reliability and operational simplicity. |
| Azure Container Registry | Stores the production container image deployed by AZD. | Supply-chain control and repeatable deployment. |
| Managed Identity | Gives the app identity-based access to Azure resources. | Least privilege and secret minimization. |
| Key Vault | Provides a standard location for future secret/config references. | Centralized secret management. |
| Cosmos DB for NoSQL | Planned durable room/game state, score ledgers, and game event history. | Data durability and horizontal scalability. |
| Application Insights | Application traces, request telemetry, and runtime diagnostics. | Observability. |
| Log Analytics | Central log and metrics workspace for Container Apps and App Insights. | Operations and incident response. |

## 4. Deployment flow

```mermaid
sequenceDiagram
  autonumber
  participant Dev as Developer
  participant AZD as azd
  participant Bicep as Bicep compiler
  participant ACR as Azure Container Registry
  participant ACA as Azure Container Apps
  participant App as Mahjong web app

  Dev->>AZD: azd up
  AZD->>Bicep: build infra/main.bicep
  Bicep-->>AZD: ARM template
  AZD->>ACA: provision Container Apps environment and app
  AZD->>ACR: provision registry
  AZD->>ACR: build/push container image
  ACA->>ACR: pull image
  ACA-->>App: start revision
  App-->>Dev: HTTPS endpoint
```

## 5. Architecture standards checklist

| Standard area | Current implementation |
| --- | --- |
| C4-style documentation | System context, container, runtime flow, and deployment diagrams are documented in Mermaid. |
| Single source of domain truth | `packages\game-engine` owns rule and scoring logic used by client/server/AI/tests. |
| Server authority | Server validates action shape, version, seat session, and legal action before mutation. |
| Encapsulation | UI consumes snapshots; domain logic does not depend on React or WebSocket code. |
| Security boundaries | Raw seat tokens are bearer secrets; server stores token hashes; concealed hands are withheld until round finish. |
| Scalability boundary | Repository and coordination interfaces keep the current single-replica in-memory deployment separate from future durable production backing services. |
| Observability | Azure plan includes Application Insights and Log Analytics. |
| Resilience | Deterministic room transitions and version checks prevent stale command races. |
| Testability | Unit, integration, simulation, and Playwright suites validate engine/server/UI behavior locally. |
| Deployability | Docker + AZD + Bicep define repeatable Azure Container Apps deployment. |

## 6. Follow-up architecture work

1. Implement durable repository and distributed coordination adapters behind the existing interfaces.
2. Add durable game history and replay views from event records.
3. Add production-grade auth if private claim links are no longer sufficient.
4. Add live dashboards for command latency, room count, AI decisions, and failed actions.
5. Add multi-region disaster recovery if the product requires regional failover.
