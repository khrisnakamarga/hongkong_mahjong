# Azure deployment artifacts

This directory contains local-only Azure Developer CLI preparation artifacts for the Hong Kong Mahjong app.

## Files

- `azure.yaml` configures a single containerized `web` service for Azure Container Apps.
- `infra/main.bicep` provisions Container Apps, ACR, Cosmos DB for room/game state, Key Vault, Application Insights, and Log Analytics. The current deployment is single-replica because the server uses in-memory coordination adapters.
- `infra/main.parameters.json` maps AZD environment variables to Bicep parameters.
- `Dockerfile` builds the Node server and React client into one production container.

## Local validation only

```powershell
npm run build
docker build -t hongkong-mahjong:local .
az bicep build --file infra\main.bicep
```

Run the Bicep build only when the Bicep CLI is already installed locally. Do not run `azd up`, `azd deploy`, `terraform apply`, `az deployment`, or any Azure login/subscription command until validation and quota checks are unblocked.
