# LNG Web Backend

Enterprise backend for a Print-on-Demand E-commerce system using an FBM-first fulfillment model.

## Stack

- Node.js and Express.js
- MongoDB with Mongoose
- Redis with ioredis
- BullMQ for background jobs
- Joi for validation
- Jest for tests

## Architecture

This project is a Strict Modular Monolith. Feature code lives in `src/modules/`, and cross-module communication must go through each module's `public.js` file.

Current modules:

```text
integration
catalog
order
production
finance
media
mapping
shipment
vendor
auth
shop
audit
report
vendorSubmission
```

Shared technical utilities live in `src/shared/`. Shared business logic does not belong there.

## Local Setup

Install dependencies:

```bash
npm install
```

Start MongoDB and Redis:

```bash
docker compose up -d
```

Copy environment variables:

```bash
copy .env.example .env
```

Useful local environment values:

```env
LOG_LEVEL=info
LOG_FORMAT=pretty
JWT_ACCESS_SECRET=change-me-in-production
JWT_ACCESS_EXPIRES_IN=15m
REFRESH_TOKEN_EXPIRES_DAYS=30
AUTH_REGISTER_ENABLED=false
BOOTSTRAP_ADMIN_EMAIL=admin@example.com
BOOTSTRAP_ADMIN_PASSWORD=change-me-strong-password
```

Run in development:

```bash
npm run dev
```

Create the first internal admin user:

```bash
npm run seed:auth
```

Or run the seed steps separately:

```bash
npm run seed:rbac
npm run seed:admin
```

`seed:rbac` creates baseline permissions and roles: `ADMIN`, `MANAGER`, `LEADER`, and `USER`.
`seed:admin` creates or repairs the bootstrap admin account and ensures it has a global `ADMIN` access assignment.

## Commercial Analytics Demo Data

For local dashboard demos, seed a deterministic historical 90-day Amazon US and Etsy US dataset ending on July 20, 2026:

```bash
npm run seed:analytics:demo
```

The command is idempotent and safe to rerun; it always upserts the same 720 orders/items and 360 ads rows for that fixed historical window. To delete only the analytics demo records and recreate them from scratch, run:

```bash
npm run seed:analytics:demo -- --reset
```

`--reset` deletes records marked with the `DASH-DEMO-` order ID prefix or `analytics-demo-seed` ads source reference. Use these commands only with a local demo database.

Health check:

```text
GET /health
```

## Verification

Run architecture boundary tests:

```bash
npm run test:architecture
```

Run all tests:

```bash
npm test
```

## Logging And Errors

- Every request receives an `X-Request-Id` response header.
- Local HTTP request logs use a compact readable format by default.
- Set `LOG_FORMAT=json` when structured JSON logs are needed.
- Application errors should use `AppError` from `src/shared/errors/appError.js`.
- Error responses use a consistent `{ success: false, error: { code, message, requestId } }` shape.
- Async controllers should be wrapped with `asyncHandler` from `src/middlewares/asyncHandler.js`.

## Auth

Auth v1 is internal-first for `admin`, `department manager`, `team leader`, and `operator` users.

Endpoints:

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/refresh
POST /api/auth/logout
GET  /api/auth/me
```

Use `Authorization: Bearer <accessToken>` for protected routes.

Detailed auth docs and Postman import file:

```text
docs/auth/AUTH_RBAC_API.md
docs/auth/postman/LNG_Web_BE_Auth_RBAC.postman_collection.json
```

## Team Workflow

- Read `AGENTS.md` before asking Codex to implement backend features.
- Read `CONTRIBUTING.md` before creating branches, commits, or pull requests.
- Use `.github/PULL_REQUEST_TEMPLATE.md` when opening PRs.
