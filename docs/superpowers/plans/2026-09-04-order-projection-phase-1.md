# Order Projection Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate the Order Workbench projection read path in the test database and make slow summary requests observable without changing its API contract.

**Architecture:** `getOrderSummary` continues to select the legacy repository or `OrderWorkbenchProjection` through `ORDER_WORKBENCH_PROJECTION_READ`. A slow-request warning measures only the service call and logs Mongo telemetry asynchronously, so diagnostics never delay the HTTP response; client-side benchmarks calculate distribution separately.

**Tech Stack:** Node.js, Express, Mongoose, Jest, MongoDB Atlas.

**Spec:** User-approved Phase 1: telemetry, parity checks for principal filters, repeatable benchmark, test DB only.

## Global Constraints

- Do not alter response DTOs, add cache/counters, or deploy production.
- Preserve the feature flag and legacy fallback.
- Use `lng_web_be_test` only for runtime verification.

---

### Task 1: Summary slow-request telemetry

**Files:**
- Modify: `src/modules/order/services/orderQuery.service.js`
- Test: `tests/order/services/orderQuery.service.test.js`

**Interfaces:**
- Produces `slow_order_summary_request` only when `ORDER_SUMMARY_SLOW_MS` is reached; response remains `{ tabCounts }`.

- [x] Write a failing test with `ORDER_SUMMARY_SLOW_MS=0` that calls `getOrderSummary` and expects `logger.warn('slow_order_summary_request', { route: 'GET /api/orders/summary', durationMs, projectionRead, mongoConnection })`.
- [x] Run `npm test -- --runInBand tests/order/services/orderQuery.service.test.js` and confirm the new assertion fails because no summary warning exists.
- [x] Add the smallest non-blocking `warnIfSummarySlow` helper on each authorized repository path.
- [x] Re-run the focused test and confirm it passes.

### Task 2: Projection parity and latency evidence

**Files:**
- No source changes.

**Interfaces:**
- Consumes `/api/orders/summary` with the same authenticated test user under legacy and projection flags.
- Produces recorded 16-tab equality for unfiltered, shop, tab, search, employee-code, and vendor filters plus ten-run latency statistics.

- [x] Start local backend against `lng_web_be_test` with the flag disabled; capture normalized tab counts for each filter.
- [x] Restart with the flag enabled; capture the same responses and compare all 16 tab keys and values.
- [x] Run ten requests after one warm-up call and record min/p50/p95/max plus response bytes.

### Task 3: Verification boundary

**Files:**
- Modify only files from Task 1 if required.

- [x] Run focused order service/repository/route tests.
- [x] Run `npm run test:architecture -- --runInBand`, `node -c` for changed services, and `git diff --check`.
- [x] Leave backend at port 3001 on `lng_web_be_test` with projection flag enabled and report only local-test evidence.
