# LNG Web Backend API contracts

This directory is the frontend handoff for backend HTTP contracts. Module Markdown documents explain request fields, response DTOs, errors, permissions, and workflow effects. Files under `postman/` provide executable Postman Collection v2.1 requests.

Use `LNG_Web_BE_All.postman_collection.json` for the complete backend catalog. `ENDPOINT_INDEX.md` lists endpoint counts and the focused collection for each module.

## Import

1. Import the module collection you need into Postman.
2. Import either `local.postman_environment.json` or `development.postman_environment.json`.
3. Select the environment and set `accessToken` after login. Never commit a real token.
4. Set resource identifiers from your own test data or run safe create/list requests that capture them.

The default local base URL is `http://localhost:3000`. Collection URLs include the `/api` prefix.

## Request safety

Read, list, detail, health, and preview requests may be used in safe smoke runs. Imports, file uploads, approvals, retries, cancellations, deletes, payroll writes, bulk mutations, webhooks, and live vendor submission belong in folders named `Manual - Mutations` and must be run deliberately.

Multipart requests leave file values empty. Select a local fixture in Postman before running them. Export and download requests return binary content and must not be parsed as JSON.

## Validation

```powershell
npm run api:inventory
npm run api:contracts:check
```

`api:contracts:check` rejects missing routes, unknown requests, duplicate method/path pairs, invalid JSON, and unresolved variables. `contract-exclusions.json` lists modules that are still pending during the staged rollout; it must be empty when the full catalog is complete.
