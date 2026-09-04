# Production Queue Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Production Workbench startup fan-out while preserving queue-count semantics, then seed and measure a representative test queue.

**Architecture:** Add one read-only queue-summary endpoint that calculates canonical Scale, QC, and Blocked counts from `ProductionTask` snapshots under the caller's existing read scope. The FE replaces its three count-only list calls with this endpoint. An idempotent, database-guarded script creates only snapshot-complete test tasks in `lng_web_be_test` and prints explain/runtime evidence.

**Tech Stack:** Node.js, Express, Mongoose aggregation, Jest, React Query.

**Spec:** User-approved Production audit priority order in this conversation.

## Global Constraints

- Preserve strict module public-port boundaries and use `.lean()` for normal reads.
- Never write to `lng_web_be`; fixture execution requires exact database `lng_web_be_test`.
- No cache, counter collection, or speculative indexes.
- Keep queue-count meanings equal to the current Scale, QC, and Blocked badge queries.

---

### Task 1: Canonical queue-count read API

**Files:**
- Modify: `src/modules/production/repositories/productionTask.repository.js`
- Modify: `src/modules/production/services/productionTask.service.js`
- Modify: `src/modules/production/controllers/productionTask.controller.js`
- Modify: `src/modules/production/routes/index.js`
- Test: `tests/production/services/productionTask.service.test.js`
- Test: `tests/production/routes/index.test.js`

- [x] Write failing service and route tests for three canonical queue counts.
- [x] Implement one aggregation over snapshot tasks under the normal read scope.
- [x] Verify the focused tests pass.

### Task 2: Replace count-only FE requests

**Files:**
- Modify: `C:/lng_system/lng-web/lng-web-fe/src/features/portal/production/api/productionApi.ts`
- Modify: `C:/lng_system/lng-web/lng-web-fe/src/features/portal/production/api/productionKeys.ts`
- Modify: `C:/lng_system/lng-web/lng-web-fe/src/features/portal/production/pages/ProductionWorkbenchPage.tsx`
- Test: `C:/lng_system/lng-web/lng-web-fe/src/test/portal/production/api/productionApi.test.ts`
- Test: `C:/lng_system/lng-web/lng-web-fe/src/test/portal/production/pages/ProductionWorkbenchPage.test.tsx`

- [x] Write failing API/page tests for one queue-summary query.
- [x] Replace three `limit=1` list queries without changing queue labels or filters.
- [x] Verify focused FE tests pass.

### Task 3: Seed and measure test production queue

**Files:**
- Create: `scripts/seedProductionQueueFixture.js`
- Test: `tests/production/scripts/seedProductionQueueFixture.test.js`

- [x] Write a failing guard/idempotency test.
- [x] Create 200 snapshot-complete, deterministically identified tasks across Scale, QC, Blocked, Ready, and channels only in `lng_web_be_test`.
- [x] Run the fixture, inspect query `executionStats`, then record API responses and timing from the local test backend.
