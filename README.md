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
npm run seed:rbac
npm run seed:admin
```

The admin seed expects the `ADMIN` role to exist in MongoDB; `seed:rbac` creates the baseline roles and permissions.

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

Auth v1 is internal-first for `admin`, `manager`, and `operator` users.

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
docs/AUTH_RBAC_API.md
docs/postman/LNG_Web_BE_Auth_RBAC.postman_collection.json
```

## Team Workflow

- Read `AGENTS.md` before asking Codex to implement backend features.
- Read `CONTRIBUTING.md` before creating branches, commits, or pull requests.
- Use `.github/PULL_REQUEST_TEMPLATE.md` when opening PRs.
