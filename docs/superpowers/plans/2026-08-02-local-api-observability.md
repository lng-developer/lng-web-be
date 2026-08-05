# Local API Observability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Measure local Express request rate, latency, errors, and Node.js health, then exercise safe read endpoints with repeatable k6 smoke and expected-load tests.

**Architecture:** Reuse `requestLogger`'s completed-response timing and record bounded Prometheus labels through one shared technical utility. Expose the private registry at an opt-in `/internal/metrics` endpoint; run Prometheus and Grafana separately through a local-only Compose file. Keep k6 outside the application and default it to `/health`.

**Tech Stack:** Node.js, Express 5, Jest, prom-client, Docker Compose, Prometheus, Grafana, k6

## Global Constraints

- Do not change PM2, VPS, MongoDB, Redis, or domain-module behavior.
- `METRICS_ENABLED` defaults to false.
- Never label metrics with raw URLs, query strings, IDs, credentials, or personal data.
- Metrics failures must not change HTTP responses.
- Load tests default to localhost and safe read endpoints.

---

### Task 1: HTTP metrics and opt-in endpoint

**Files:**
- Create: `src/shared/observability/metrics.js`
- Create: `src/test/shared/httpMetrics.test.js`
- Modify: `src/config/index.js`
- Modify: `src/middlewares/requestLogger.js`
- Modify: `src/app.js`
- Modify: `.env.example`
- Modify: `package.json`
- Modify: `package-lock.json`

**Interfaces:**
- Produces: `recordHttpRequest({ method, route, statusCode, durationSeconds })`, `metricsContentType`, and `getMetrics()`.
- Route normalization consumes Express `req.baseUrl` and `req.route.path`; missing matches become `unmatched`.

- [ ] **Step 1: Write failing integration tests**

  Create real HTTP-server tests proving: metrics are 404 when disabled; enabled output has Prometheus content type; a request to a dynamic test route records `/api/widgets/:widgetId` and excludes the concrete ID and query string.

- [ ] **Step 2: Run the focused test and confirm RED**

  Run: `node -r dotenv/config ./node_modules/jest/bin/jest.js src/test/shared/httpMetrics.test.js --runInBand`

  Expected: FAIL because the metrics utility and endpoint do not exist.

- [ ] **Step 3: Add the minimal implementation**

  Add `prom-client`, validate `METRICS_ENABLED` in config, create a private registry with `lng_` default metrics plus the counter/histogram, record once from `requestLogger`'s existing `finish` callback, and conditionally register `GET /internal/metrics` before the 404 handler. Catch and warn on recording failures.

- [ ] **Step 4: Run focused and shared verification**

  Run the focused test, then `npm run test:shared -- --runInBand`.

### Task 2: Local Prometheus and Grafana stack

**Files:**
- Create: `observability/docker-compose.yml`
- Create: `observability/prometheus/prometheus.yml`
- Create: `observability/grafana/provisioning/datasources/prometheus.yml`
- Create: `observability/grafana/provisioning/dashboards/dashboards.yml`
- Create: `observability/grafana/dashboards/api-overview.json`

**Interfaces:**
- Prometheus scrapes `host.docker.internal:3000/internal/metrics`.
- Grafana datasource UID is `prometheus`; dashboard queries only checked-in `lng_` metrics.

- [ ] **Step 1: Add the minimal checked-in configuration**

  Define only Prometheus, Grafana, their provisioning mounts, and named volumes. The dashboard includes request rate, 4xx/5xx rate, p50/p95/p99 latency, slow routes, heap, CPU, and event-loop lag.

- [ ] **Step 2: Validate configuration behavior**

  Run: `docker compose -f observability/docker-compose.yml config`

  Expected: exit 0 with both services and no application/database service.

### Task 3: Repeatable k6 smoke and expected load

**Files:**
- Create: `test/load/smoke.js`
- Create: `test/load/expected-load.js`
- Create: `test/load/lib/config.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `K6_BASE_URL` (default `http://localhost:3000`), `K6_PATH` (default `/health`), optional `K6_ACCESS_TOKEN`.
- Produces: k6 checks plus thresholds `http_req_failed < 0.01`, `http_req_duration p(95) < 1000`, and `checks rate > 0.99`.

- [ ] **Step 1: Add shared safe-target configuration and scenarios**

  Reject non-loopback base URLs unless `K6_ALLOW_REMOTE=true`; build optional bearer headers without logging the token. Smoke runs one VU briefly. Expected load uses configurable ramp/steady stages.

- [ ] **Step 2: Validate scripts and run smoke when k6 is available**

  Run: `k6 inspect test/load/smoke.js` and `k6 inspect test/load/expected-load.js`.

  With the backend running and metrics enabled, run: `k6 run test/load/smoke.js`.

### Final verification

- [ ] Run `npm run test:architecture -- --runInBand`.
- [ ] Run `npm test -- --runInBand` with the worktree using the repository `.env`.
- [ ] Run `git diff --check` and inspect the complete scoped diff.

