# Hong Kong Mahjong

Bootstrap workspace for a TypeScript Hong Kong Mahjong web app with a shared game engine, Node.js realtime server, React client, unit tests, and Playwright E2E scaffolding.

## Local development

```powershell
npm install
npm run dev
```

- Client: http://127.0.0.1:5173
- Server health: http://127.0.0.1:8787/health
- Realtime API: `POST http://127.0.0.1:8787/api/rooms`
- WebSocket room feed: `ws://127.0.0.1:8787/ws?room=<roomCode>`

Room creation returns four private seat claim links. Claim a seat with
`POST /api/rooms/<roomCode>/claim`, then connect the WebSocket with the returned
seat session token. The server is authoritative and validates player commands
against the shared game-engine legal-action APIs; local in-memory room and
coordination adapters are used until Cosmos DB/Redis adapters are added.

For LAN testing:

```powershell
npm run dev:lan
```

This binds the client and server to `0.0.0.0`; use your machine's LAN IP from other devices.

### Watching four AIs play

The web page includes a local spectator mode for AI-only play:

1. Start the app with `npm run dev`.
2. Open `http://127.0.0.1:5173`.
3. Select an **AI difficulty**.
4. Click **Watch 4 AIs**.
5. Use **Pause 4 AIs**, **Resume 4 AIs**, or **Step 4 AIs** to control the local autoplay.

This mode keeps all four seats AI-controlled and updates the visible table, wall count, discards, melds, scores, and game log without requiring a server or Azure connection.

## Design and specs

- `docs\system-design.md` explains the app in a system-design-interview format: requirements, architecture, APIs, data model, scaling, consistency, security, testing, and tradeoffs.
- `docs\hong-kong-mahjong-rules.md` captures the implemented Hong Kong Mahjong rule and scoring assumptions.
- `.azure\deployment-plan.md` is the Azure deployment architecture and infrastructure plan.

## Validation

```powershell
npm run typecheck
npm run build
npm run lint
npm run test
npm run test:e2e
```

`npm run test:e2e` requires Playwright browser binaries. Install them locally with `npx playwright install` when you are ready to run browser tests.

The local test suite covers deterministic four-AI round simulations, human/server legal-action parity for Draw/Discard/Pass/Chow/Pong/Kong/Mahjong, scoring/payment edge cases, private seat-token takeover, WebSocket claim prompts, UI visibility/privacy, LAN script contracts, and Dockerfile smoke-readiness checks. These checks are intentionally local-only and do not provision Azure resources.

## Azure

Azure preparation artifacts are included for later validation/deployment:

- `azure.yaml`
- `Dockerfile`
- `.dockerignore`
- `infra/main.bicep`
- `infra/main.parameters.json`

These target Azure Container Apps in `westus3` with ACR, Cosmos DB, Azure Cache for Redis, Key Vault, Application Insights, and Log Analytics. The app uses environment variables and managed identity-oriented configuration; secrets are expected to come through Key Vault references.

Local-only checks:

```powershell
npm run build
docker build -t hongkong-mahjong:local .
az bicep build --file infra\main.bicep
```

Run Docker/Bicep checks only when those local tools are installed. Do not run `azd up`, `azd deploy`, `terraform apply`, `az deployment`, Azure login, or subscription-changing commands as part of local validation.
