# AI Agent Instructions - Enterprise POD FBM Backend

Use this file as the durable operating guide for Codex and other AI agents working in this repository.

## Project Purpose

This repository is the backend for an enterprise Print-on-Demand FBM system. It is API-first and supports marketplace ingestion, normalized orders, customization handoff, production workflow, vendor submission, shipment tracking, finance, reporting, audit, shop management, and auth/RBAC.

## Stack

- Node.js, Express.js, CommonJS
- MongoDB through Mongoose
- Redis through ioredis
- BullMQ for background work
- Joi validation
- Jest tests

## Current Modules

Modules live under `src/modules/`:

- `audit`: immutable activity and lifecycle evidence
- `auth`: authentication, accounts, RBAC, scoped access, public auth ports
- `catalog`: product, variant, listing, and template metadata
- `finance`: cost, revenue, settlement, reconciliation, and reports
- `integration`: external platform adapters, webhook/import entrypoints, and import orchestration
- `mapping`: SKU/product/listing/vendor mapping rules
- `media`: design files, generated assets, and image references
- `order`: normalized order and order item lifecycle
- `organization`: departments, teams, and team memberships
- `production`: internal POD production workflow
- `report`: operational and financial read models
- `shipment`: tracking, carrier state, and FBM shipment lifecycle
- `shop`: internal business shop/store aggregate root
- `vendor`: vendor master data, capabilities, SLA, and routing metadata
- `vendorSubmission`: vendor-facing submission payloads and submission state

## Hard Architecture Rules

- This is a strict modular monolith.
- Cross-module communication must go through the target module's `public.js`.
- Never import another module's internal `controllers`, `services`, `repositories`, `models`, `routes`, `dtos`, or `validators`.
- Controllers own HTTP parsing, validation, route permissions, and response status only.
- Services own business rules, orchestration, idempotency, and cross-module public-port calls.
- Repositories own Mongoose queries.
- Models define schema only.
- DTOs shape all API responses. Do not leak raw Mongo documents.
- Read-only Mongoose queries must use `.lean()`.
- Business modules may import technical utilities from `src/shared/`, such as `AppError`, constants, pagination, logger, crypto, and generic helpers.
- `src/shared/` is technical-only. It must not import from `src/modules/` and must not contain domain models or business rules.

Allowed cross-module call:

```js
const orderPort = require('../../order/public');
```

Forbidden cross-module call:

```js
const Order = require('../../order/models/order.model');
```

## Order Import Rules

- The system does not use Amazon SP-API.
- Do not add SP-API clients, credentials, cursors, tokens, polling, report APIs, or SP-API terminology.
- Supported order import sources are:
  - `AMAZON_EXTENSION_REPORT`
  - `MANUAL_EXCEL`
- `shop` is already implemented as an internal business shop/store aggregate root.
- `shop` must not be modeled as a marketplace account, Amazon account, external store account, or platform connection.
- `shop` must not own platform credentials, external account IDs, marketplace IDs, tokens, sync cursors, or integration state.
- Do not modify `shop.model.js` unless the task explicitly requires a shop schema change.
- Do not create `ShopMember`. Shop access uses Auth scoped RBAC.
- `externalOrderImport` belongs under `src/modules/integration/externalOrderImport`.
- `externalOrderImport` must not create `Order` or `OrderItem` documents directly.
- Imported order data must normalize into an `ExternalOrderDTO` and call `order.public.importExternalOrder()`.
- Customization data must be handed off through `customization.public.createPendingPayload()`, not deeply parsed inside `integration`.

## Customization Boundary

- The `customization` module owns raw customization payloads, parsed customization data, customization asset references, retry metadata, and manual review status.
- Do not place vendor selection, production task creation, catalog mapping, or shipment logic inside `customization`.
- Import pipelines should create or update customization payloads through `customization.public.createPendingPayload()`.

## Auth And Shop Access

- Auth scoped RBAC is the source of truth for shop access.
- Use `AccessAssignment` plus `ScopedRolePermission` for scoped permissions.
- Do not reintroduce legacy `DepartmentRolePermission`.
- Do not create module-specific membership tables for shop access.

## API And Error Handling

- Wrap async controllers with `asyncHandler`.
- Use `AppError` for expected operational errors.
- Use stable error codes from `src/shared/constants/errorCodes.js` when applicable.
- Let errors flow to global error middleware.
- Use `src/shared/utils/logger.js`; do not add raw `console.log` in production code.
- Public APIs should include route, controller, validator, service, repository, DTO, and tests when behavior is implemented.

## Testing And Verification

Run the narrowest meaningful verification, then broaden when shared behavior changes.

- Syntax check changed JS files:

```bash
node -c path/to/file.js
```

- Architecture-sensitive changes:

```bash
npm run test:architecture -- --runInBand
```

- Auth changes:

```bash
npm run test:auth -- --runInBand
```

- Organization changes:

```bash
npm run test:organization -- --runInBand
```

- Shop changes:

```bash
npm run test:shop -- --runInBand
```

- Broad/shared changes:

```bash
npm test -- --runInBand
```

## Data And Seeds

- Do not run destructive DB commands without explicit user confirmation.
- Before deleting, migrating, or seeding data, identify the database from `.env` and report the target database name.
- Seed scripts must be idempotent and use stable identifiers where practical.
- Never commit `.env`, secrets, credentials, API keys, tokens, or private connection strings.

## Git Rules

- Follow `CONTRIBUTING.md` when present.
- Do not commit directly to `main` or `develop` unless the user explicitly asks for that exact action.
- Inspect `git diff` before committing or summarizing large changes.
- Do not revert user changes or unrelated dirty worktree files.
- Commit messages should follow `<type>(<scope>): <description>` when commits are requested.

## What Not To Do

- Do not add SP-API integration.
- Do not bypass public ports between modules.
- Do not query Mongoose directly from controllers or services.
- Do not put business rules in `src/shared/`.
- Do not leak raw MongoDB documents in responses.
- Do not add approval-heavy or placeholder scaffolds unless explicitly asked.
- Do not broaden a task into unrelated refactors.

## Agent skills

### Domain docs

This is a single-context repository. See `docs/agents/domain.md`.
