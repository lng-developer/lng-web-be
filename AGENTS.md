# AI Agent Instructions - Enterprise POD FBM Backend

You are an expert backend engineer working inside this repository. Your mission is to maintain and scale this Strict Modular Monolith for an Enterprise E-commerce POD system without degrading architecture.

## Product Context

- Domain: Print-on-Demand fulfillment backend.
- Fulfillment model: FBM first.
- Marketplace/platform integrations include Amazon, Etsy, Shopify, and future sales channels.
- The backend is API-first and must support ingestion, order normalization, production workflows, vendor submission, shipment tracking, finance reconciliation, audit, reporting, and platform-specific integration jobs.

## Core Stack

- Runtime and framework: Node.js, Express.js.
- Database: MongoDB through Mongoose.
- Cache and distributed coordination: Redis through ioredis.
- Background processing: BullMQ queues and workers.
- Validation: Joi.
- Architecture: Strict Modular Monolith with Public Ports.

## Critical Architectural Laws

### 1. Absolute Module Boundaries

- The system is divided into 12 standalone modules inside `src/modules/`.
- Cross-module communication is permitted only through the target module's `public.js` file.
- Never import another module's internal `controllers`, `services`, `repositories`, `models`, `routes`, or `dtos`.

Allowed:

```js
const mappingPort = require('../../mapping/public');
```

Forbidden:

```js
const MappingModel = require('../../mapping/models/mapping.model');
```

### 2. Strict 3-Tier Layering

- Controller layer: HTTP request/response, parameter parsing, validation, route permissions. No business logic and no database queries.
- Service layer: domain rules, orchestration, computations, idempotency decisions. Services must be protocol-agnostic and must not depend on Express `req` or `res`.
- Repository/model layer: all Mongoose database access. Services must call repositories and must not run raw Mongoose queries directly.

### 3. Shared Directory Restrictions

- `src/shared/` may be imported by all modules.
- `src/shared/` must contain only technical utilities such as date helpers, crypto helpers, `AppError`, and HTTP constants.
- `src/shared/` must not contain business models, business schemas, business rules, or imports from `src/modules/`.

### 4. Data, Performance, and Safety Rules

- Every read-only Mongoose query must use `.lean()`.
- API responses must not leak raw MongoDB documents. Map outputs through DTOs before sending responses.
- Ingestion, webhook, import, transaction, and platform-sync write paths must be idempotent.
- Platform ingestion must preserve external identifiers such as Amazon order IDs, Etsy receipt/order IDs, Shopify order IDs, import keys, and webhook event IDs.
- Never store secrets in code, logs, fixtures, docs, or committed env files.

## Module Ownership

- `integration`: external platform adapters, webhook entrypoints, import orchestration, marketplace API clients.
- `catalog`: products, variants, templates, listing metadata.
- `order`: normalized order lifecycle and order item state.
- `production`: POD production tasks and internal workflow state.
- `finance`: fees, costs, settlement, revenue, reconciliation.
- `media`: design files, generated assets, image references.
- `mapping`: SKU/product/listing/vendor mapping rules.
- `shipment`: tracking, carrier state, FBM shipment lifecycle.
- `auth`: authentication and authorization.
- `audit`: immutable audit trail and operator activity.
- `report`: operational and financial reporting read models.
- `vendorSubmission`: vendor-facing submission payloads and submission state.

## Git Rules For Codex

- Follow `CONTRIBUTING.md` for branch naming, commit messages, PR target, and merge rules.
- Never commit directly to `main` or `develop`.
- Never stage `.env`, secrets, credentials, API keys, or private tokens.
- Feature and fixbug branches target `develop`.
- Hotfix branches must start from `main` and target `main`.
- Commit messages must follow `<type>(<scope>): <description>`.
- Before any commit or PR, inspect the diff and run the relevant local verification commands.

## Required Verification

- For architecture-sensitive changes, run `npm run test:architecture`.
- For JavaScript files changed, run `node -c <file>` or the relevant test command.
- For broad backend changes, run `npm test`.
- When adding public APIs, include route/controller/service/repository/DTO structure and error handling.

## Logging And Error Handling

- Use `src/shared/utils/logger.js` for application logs. Do not scatter raw `console.log` in feature code.
- Use `AppError` for expected operational errors.
- Use `errorCodes` from `src/shared/constants/errorCodes.js` for stable API error codes.
- Wrap async controllers with `asyncHandler`.
- Let errors flow to the global error middleware. Do not hand-roll error responses in controllers.
- All error responses must include `requestId` through the standard middleware chain.

## Behavioral Expectations

- Generate complete production-ready code with proper layer division.
- Avoid TODO placeholders unless the user explicitly asks for a scaffold only.
- Prefer clear source-level fixes over workarounds.
- Ask a concise clarifying question only when implementation would be risky without missing business context.
