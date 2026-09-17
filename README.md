# LNG Web Backend

Backend API for the LNG enterprise Print-on-Demand FBM system.

## Stack

- Node.js, Express, CommonJS
- MongoDB with Mongoose
- Redis with ioredis
- BullMQ workers
- Joi validation
- Jest tests
- k6 load checks

## Local Setup

Install dependencies:

```bash
npm install
```

Create local env:

```bash
copy .env.example .env
```

Start local services:

```bash
docker compose up -d
```

Run the API:

```bash
npm run dev
```

Health checks:

```text
GET /health
GET /api/integration/health
GET /api/mapping/health
```

## First Admin

Seed baseline RBAC and the bootstrap admin:

```bash
npm run seed:auth
```

Equivalent separate steps:

```bash
npm run seed:rbac
npm run seed:admin
```

`seed:rbac` creates baseline permissions and roles. `seed:admin` creates or repairs the bootstrap admin account from `.env`.

## Repository Layout

```text
src/
  app.js
  server.js
  modules/              runtime business modules
  shared/               technical utilities only
  middlewares/          Express middleware

tests/                  all Jest and k6 tests
tools/                  cross-module scripts and operational tooling
docs/                   architecture, API, runbook, and policy docs
observability/          local metrics stack config
storage/                local runtime storage, ignored where needed
```

Important policy:

- Runtime module code lives in `src/modules/<module>/`.
- Module-owned scripts stay in `src/modules/<module>/scripts/`.
- Cross-module tooling goes in `tools/`.
- Tests go in `tests/`.
- Do not add new root scratch files, `src/test`, or `src/scripts`.

See `docs/repo-folder-policy.md`.

## Modules

Current module set:

```text
audit
auth
catalog
customization
design
finance
hr
integration
mapping
media
notification
order
organization
production
report
shipment
shop
vendor
vendorSubmission
workScore
```

This is a strict modular monolith. Cross-module runtime access must go through the target module's `public.js`.

Allowed:

```js
const orderPublic = require('../../order/public');
```

Avoid:

```js
const Order = require('../../order/models/order.model');
```

## Useful Commands

Run all tests:

```bash
npm run test:full
```

Run tests related to changed source files, then the required boundary and API checks:

```bash
npm run test:changed -- src/modules/finance/services/financeImport.service.js
npm run test:architecture -- --runInBand
npm run api:contracts:check
```

Investigate a suite that leaves handles open; do not use `--forceExit` as a permanent workaround:

```bash
npm run test:open-handles -- tests/finance/financeSnapshot.audit.persistence.test.js
```

Run architecture boundary tests:

```bash
npm run test:architecture -- --runInBand
```

Run focused suites:

```bash
npm run test:auth -- --runInBand
npm run test:organization -- --runInBand
npm run test:shop -- --runInBand
npm run test:shared -- --runInBand
npx jest tests/integration --runInBand
npx jest tests/mapping --runInBand
```

Run API contract checks:

```bash
npm run api:contracts:check
```

Run k6 load checks when k6 is installed:

```bash
npm run load:smoke
npm run load:expected
```

## Demo Seeds

Full local demo seed:

```bash
npm run seed:demo:full
```

Analytics demo data requires explicit opt-in:

```bash
ALLOW_ANALYTICS_DEMO_SEED=true npm run seed:analytics:demo
```

Reset and recreate only analytics demo records:

```bash
ALLOW_ANALYTICS_DEMO_SEED=true npm run seed:analytics:demo -- --reset
```

Do not run seed, migration, cleanup, or index apply commands against production without checking `.env` first.

## Workers

Run workers separately when needed:

```bash
npm run worker:sql-attendance
npm run worker:hr-announcements
npm run worker:payroll-email
```

## Operational Tools

Cross-module scripts are under `tools/` and exposed through npm scripts where useful:

```bash
npm run audit:mongo-indexes
npm run audit:mongo-fields
npm run indexes:reduce
npm run indexes:reconcile:batch2
npm run benchmark:uploads
```

Module-specific maintenance stays with the module, for example:

```bash
npm run backfill:mapping-plans
npm run backfill:listing-variants
npm run indexes:shipments
```

## API Docs

Start with:

```text
docs/
docs/auth/AUTH_RBAC_API.md
docs/mapping/MAPPING_MODULE_GUIDE.md
docs/integration/INTEGRATION_MODULE_GUIDE.md
docs/vendorSubmission/VENDOR_SUBMISSION_MODULE_GUIDE.md
```

Postman/API inventory tooling lives in `tools/api-contract/`.

## Team Workflow

- Read `AGENTS.md` before architecture-sensitive backend changes.
- Read `CONTRIBUTING.md` before branching, committing, or opening PRs.
- Never commit `.env`, credentials, tokens, local storage, generated caches, or tool state.
- Run the narrowest meaningful test first, then broaden when shared behavior changes.
