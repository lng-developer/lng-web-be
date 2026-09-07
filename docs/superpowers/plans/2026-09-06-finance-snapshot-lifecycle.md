# Finance Snapshot Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate and keep Finance snapshots current so per-order profitability is visible.

**Architecture:** Finance owns a deduplicated recalculation queue and a bounded reconciliation runner. Other modules call a Finance public-port enqueue method, while Finance remains the only module that calculates and upserts snapshots. The same runner performs an operator-invoked, idempotent initial backfill.

**Tech Stack:** Node.js, CommonJS, Mongoose, BullMQ/Redis, Jest.

**Spec:** `docs/superpowers/specs/2026-09-06-finance-snapshot-lifecycle.md`

## Global Constraints

- Cross-module callers use `finance/public.js` only.
- Finance overview remains read-only; no GET endpoint creates snapshots.
- Backfill defaults to dry-run and needs explicit operator execution for writes.
- Preserve existing manual per-order and per-item recalculate endpoints.

---

### Task 1: Finance recalculation request boundary

**Files:**
- Modify: `src/modules/finance/public.js`, `src/modules/finance/services/financeSnapshot.service.js`
- Create: `src/modules/finance/services/financeSnapshotQueue.service.js`
- Test: `tests/finance/services/financeSnapshotQueue.service.test.js`

**Interfaces:**
- Produces: `financePublic.requestSnapshotRecalculation({ orderItemId, reason })`.
- Consumes: the existing Finance calculation service and system audit context.

- [ ] Write a failing test proving duplicate requests for the same order item create one queued job and preserve the newest reason.
- [ ] Run the focused Jest test and confirm it fails because the public request method does not exist.
- [ ] Implement the smallest Finance-owned queue adapter with deterministic job ID `finance-snapshot:<orderItemId>`.
- [ ] Run the focused test and confirm it passes.

### Task 2: Reconciliation and safe backfill runner

**Files:**
- Modify: `src/modules/finance/repositories/financeSnapshot.repository.js`, `src/modules/finance/public.js`, `src/server.js`
- Create: `src/modules/finance/services/financeSnapshotReconciliation.service.js`, `src/modules/finance/services/financeSnapshotReconciliationScheduler.service.js`, `src/modules/finance/scripts/backfillFinanceSnapshots.js`
- Test: `tests/finance/services/financeSnapshotReconciliation.service.test.js`, `tests/finance/scripts/backfillFinanceSnapshots.test.js`

**Interfaces:**
- Produces: `financePublic.reconcileSnapshots({ limit, dryRun })` and an operator script defaulting to dry-run.
- Consumes: bounded order-item pages through `order/public.js` and Finance calculation through Task 1.

- [ ] Write a failing test proving a dry run returns eligible missing snapshots without writes.
- [ ] Run the focused Jest test and confirm it fails because reconciliation is absent.
- [ ] Implement bounded missing/stale selection, isolated per-item failure reporting, and a disabled-by-default interval scheduler.
- [ ] Implement the script so `node .../backfillFinanceSnapshots.js` is dry-run unless `--apply` is passed.
- [ ] Run the focused tests and confirm they pass.

### Task 3: Provider lifecycle requests

**Files:**
- Modify: order import, fulfillment-plan, vendor-cost, and finance-import services at their existing successful persistence boundaries.
- Test: focused existing module service tests for each boundary.

**Interfaces:**
- Consumes: `financePublic.requestSnapshotRecalculation({ orderItemId, reason })` from Task 1.

- [ ] Write one failing test per provider proving a successful persisted change requests a Finance recalculation and a failed/no-op path does not.
- [ ] Run each focused test and confirm the expected failure.
- [ ] Add the public-port request at only the confirmed successful boundaries.
- [ ] Run focused module tests plus Finance tests and architecture tests.

### Task 4: End-to-end verification and operator handoff

**Files:**
- Test: `tests/e2e/financeImportSnapshotFlow.e2e.test.js`

- [ ] Add a failing end-to-end scenario: import an order item, process its finance input, run the worker, and assert one visible `MISSING_COST` or `ESTIMATED` snapshot.
- [ ] Run it to confirm the pre-change failure.
- [ ] Verify it passes after Tasks 1-3.
- [ ] Run `npm run test:architecture -- --runInBand` and the focused Finance, Order, Mapping, Vendor, and Integration suites.
