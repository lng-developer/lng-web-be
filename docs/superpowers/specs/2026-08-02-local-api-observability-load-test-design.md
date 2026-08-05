# Local API Observability And Load Test Design

Date: 2026-08-02

## Objective

Measure this Express backend locally before introducing production monitoring. The local setup must show request volume, latency distribution, error rate, and Node.js process health, then exercise selected APIs with repeatable smoke and load tests.

## Scope

This design covers:

- Prometheus-format metrics emitted by the existing backend process.
- A local Prometheus and Grafana stack started with Docker Compose.
- One smoke test and one expected-load test executed with k6.
- Automated checks for metric recording, label safety, and load-test thresholds.

It does not change PM2 or VPS deployment, add production alerting, trace requests across services, monitor MongoDB or Redis internals, run stress or soak tests, or create an observability business module.

## Current State

`requestLogger` already measures elapsed request time with `process.hrtime.bigint()` and writes one structured log after the response finishes. The application exposes `/health`, mounts business routes under `/api`, and has no Prometheus client or aggregate metrics endpoint.

The implementation will reuse the existing request lifecycle instead of adding a second timing middleware.

## Local Architecture

```text
k6 -> Express on localhost:3000 -> requestLogger -> Prometheus metrics
                                      ^                  |
                                      |                  v
                                structured logs     Prometheus
                                                         |
                                                         v
                                                      Grafana
```

The backend continues to run with `npm run dev`. Docker Compose runs only Prometheus and Grafana. Prometheus reaches the Windows host through `host.docker.internal:3000`.

## Application Metrics

Add `prom-client` and one technical metrics utility under `src/shared/`. It owns a private registry, enables default Node.js process metrics with an `lng_` prefix, and exports only the operations needed by middleware and the metrics endpoint.

The HTTP metrics are:

- `lng_http_requests_total`: counter labeled by `method`, normalized `route`, and `status_code`.
- `lng_http_request_duration_seconds`: histogram with the same labels and buckets suitable for sub-second and multi-second API responses.

No metric label may contain an account ID, shop ID, order ID, query string, email, token, request ID, or raw URL. The route label uses the matched Express route pattern plus its mounted base path, for example `/api/orders/:orderId`. Unmatched requests use a fixed value such as `unmatched`; they do not use `originalUrl`.

The current structured request log remains unchanged except for sharing the already-calculated duration with the metrics recorder. Metrics collection must never make a request fail. If no route pattern is available, recording uses the bounded fallback label.

## Metrics Endpoint

Expose `GET /internal/metrics` only when `METRICS_ENABLED=true`. The endpoint returns the registry in Prometheus text format with its declared content type.

For local development, Prometheus is the only intended consumer. The endpoint returns metrics only and does not expose environment values, request payloads, headers, logs, stack traces, or database records. Production exposure and network protection are deferred to the production design.

The metrics endpoint does not require a controller, service, repository, DTO, or business module because it is technical infrastructure, not a domain API.

## Prometheus And Grafana

Add a separate local observability Compose file so the existing Redis and MongoDB Compose setup remains untouched. It starts:

- Prometheus with a checked-in scrape configuration targeting `host.docker.internal:3000/internal/metrics`.
- Grafana with a provisioned Prometheus datasource and one small API dashboard.

The dashboard contains:

- Requests per second.
- 4xx and 5xx rate.
- p50, p95, and p99 request duration by normalized route.
- Slowest routes by p95.
- Node.js heap, process CPU, and event-loop lag from default metrics.

Prometheus data and Grafana state use named Docker volumes. Local credentials, generated data, and secrets are not committed.

## Load Tests

Use k6 scripts under a dedicated test directory. k6 runs outside the backend process so a test failure cannot alter application state or instrumentation.

The first two scenarios are:

1. Smoke: one virtual user for a short duration to validate connectivity, authentication setup, response checks, and metrics ingestion.
2. Expected load: a short ramp to a configurable local request rate, a steady interval, and a ramp down.

Initial thresholds are deliberately modest and configurable:

- HTTP failure rate below 1%.
- Overall p95 below 1 second.
- Required functional checks pass.

Tests target safe read endpoints by default. Any authenticated or write scenario requires explicit test data and cleanup rules before it is added. Stress, spike, and soak scenarios are deferred until the baseline identifies a reason to add them.

Local results measure regression and relative performance on the developer machine; they are not production capacity claims because the load generator, backend, Docker, and database may share hardware.

## Configuration

Add only the settings needed for this phase:

- `METRICS_ENABLED`, defaulting to false outside an explicit local setup.
- k6 base URL and optional access token supplied through environment variables.
- Grafana local admin credentials supplied through an ignored environment file or safe local defaults that are never presented as production credentials.

No application secret is copied into Prometheus or Grafana configuration.

## Error Handling And Safety

- Metrics recording errors are logged at a bounded level and do not change HTTP responses.
- Prometheus scrape failures appear as target health failures; the backend remains available.
- k6 exits non-zero when thresholds or functional checks fail.
- Metric labels are bounded to prevent high-cardinality memory growth.
- The load test defaults to localhost and must require an explicit base URL to target anything else.

## Verification

The smallest meaningful automated coverage is:

- A middleware test proving one completed request increments the counter and records duration.
- A route-label test proving dynamic IDs and query strings do not appear in metric output.
- A metrics-endpoint test proving disabled and enabled behavior plus Prometheus content type.
- `docker compose config` for the observability stack.
- A k6 smoke run against the local backend.
- Existing architecture and shared tests to confirm the technical utility does not introduce module-boundary violations.

## Acceptance Criteria

- `npm run dev` continues to run the backend without Docker.
- The observability Compose stack starts independently.
- Prometheus reports the backend target as healthy when metrics are enabled.
- Grafana shows request rate, error rate, latency percentiles, and Node.js process metrics.
- No raw URL, query string, identifier, credential, or personal data appears in metric labels.
- The k6 smoke and expected-load scenarios have reproducible commands and enforce thresholds.
- No PM2, VPS, MongoDB, Redis, or domain-module behavior changes in this phase.

## Deferred Work

- PM2 cluster aggregation and production-safe metrics exposure.
- Production retention, authentication, TLS, dashboards, and alerts.
- MongoDB, Redis, BullMQ, and host exporters.
- Distributed tracing with OpenTelemetry.
- Stress, spike, soak, and write-heavy workload suites.
