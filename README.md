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
auth
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
```

Run in development:

```bash
npm run dev
```

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

## Team Workflow

- Read `AGENTS.md` before asking Codex to implement backend features.
- Read `CONTRIBUTING.md` before creating branches, commits, or pull requests.
- Use `.github/PULL_REQUEST_TEMPLATE.md` when opening PRs.
