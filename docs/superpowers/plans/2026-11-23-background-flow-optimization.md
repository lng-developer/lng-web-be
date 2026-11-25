# Background Flow Optimization Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking. Implementation was authorized on 2026-11-23. Deployment remains a separate gate.

**Goal:** Reduce background-work latency and API contention without losing updates, duplicating vendor actions, or weakening financial consistency.

**Architecture:** Keep the modular monolith and existing BullMQ/Redis. Schedulers discover due work; bounded workers execute it. Serialize conflicting mutations by business entity while allowing independent entities to run concurrently. Extract dedicated process entrypoints after correctness and recovery are established.

**Tech Stack:** Node.js/CommonJS, MongoDB/Mongoose, Redis, BullMQ, Jest; existing React frontend only where batch progress needs UI.

**Spec:** The read-only audit in this conversation on 2026-11-23 and the accepted request to plan optimization. The decisions and scope below are the design specification for implementation.

## Global Constraints

- Cross-module calls go through public.js; repositories own MongoDB queries.
- Reuse installed dependencies. Do not introduce microservices or another queue platform.
- Do not enable the metrics endpoint or change production data/configuration during implementation.
- Preserve audit records, authorization, vendor idempotency and financial transactions.
- Do not parallelize operations sharing a Mongoose transaction/session.
- Create separate PRs into develop. PR CI is the normal test gate; do not manually rerun suites on develop without new unverified changes or an explicit request.
- Do not merge or deploy without user authorization. Clean task branches/worktrees after authorized release.

## Audit Baseline and Limits

- Production snapshot: one PM2 backend process; Redis enabled; workers start in src/server.js alongside HTTP.
- Tracking: 60-minute interval; batch size 50 per vendor; nested sequential loops in shipment.service.js.
- Finance snapshot concurrency 3; finance import 2; mapping side effects 5; post-import mapping 3; customization 3; Etsy images 2; primary import 1; order recheck 2.
- At inspection, finance/mapping had no waiting jobs. Post-import retained 12 failures, principally business/data errors. This is not peak-load evidence.
- Tracking records both start and finish timestamps at completion today; those fields cannot establish duration.
- Initial concurrency settings below are conservative rollout candidates, not measured capacity or vendor quotas.

## Review Focus

1. A source update arriving during finance calculation must cause another calculation, not disappear behind a duplicate job ID (Task 3).
2. A worker crash or expired lease must not permit stale results to overwrite newer state (Tasks 2–3).
3. One throttled vendor credential must not block other credentials or exceed its own quota across processes (Task 2).
4. HTTP/worker separation must not start duplicate schedulers or silently execute expensive work inline during queue outages (Task 4).
5. Retry must preserve completed effects and distinguish business validation failures from temporary infrastructure errors (Tasks 2, 3, 5).

## Task 1 — Establish a Measurable Baseline

**Files:** Modify src/modules/shipment/services/vendorTrackingRecheckScheduler.service.js and trackingSyncConfig.service.js in the same module (existing timestamp fields and Mixed summary need no schema change); src/config/queue.js. Tests: tests/shipment/services/vendorTrackingRecheckScheduler.service.test.js, tests/config/queue.test.js; add tests/shipment/services/trackingSyncConfig.runTiming.test.js.

**Interfaces:** Extend recordRun(result, authContext, { startedAt, finishedAt }) with an optional timing argument for compatibility. Structured job logs contain queue, jobId, durationMs, attempt and outcome; never payloads, credentials or customer data.

- [x] Write failing tests proving start/finish differ for a delayed run, worker success/failure produces one bounded log, and logging does not alter retry behavior.
- [x] Run `npm test -- tests/shipment/services/vendorTrackingRecheckScheduler.service.test.js tests/shipment/services/trackingSyncConfig.runTiming.test.js tests/config/queue.test.js` and confirm the new assertions fail.
- [x] Implement timing and bounded structured logs using existing logger; collect queue counts and bounded sampled waiting age using direct read-only Redis commands (BullMQ getters may mutate legacy markers) in a scoped operations script.
- [x] Run the tests above. Review log fields for secrets and high-volume payloads; commit the verified change.
- [ ] After separately authorized rollout, observe one full business day including an import burst: tracking duration/age, finance freshness, queue age, retry/429 counts, API p95 and MongoDB latency. Record the baseline without enabling the metrics endpoint.

**Gate:** A measured baseline exists; select initial concurrency against actual vendor quotas and DB capacity before increasing throughput.

## Task 2 — Tracking Jobs Isolated by Vendor Client

**Files:** Modify src/modules/shipment/services/vendorTrackingRecheckScheduler.service.js and shipment.service.js; create shipment/services/vendorTrackingQueue.service.js, shipment/workers/vendorTracking.worker.js, shipment/models/vendorTrackingPoll.model.js and shipment/repositories/vendorTrackingPoll.repository.js. Extend the vendorSubmission public/repository tracking-selection contract only if needed to resolve credential scope without internal imports. Tests: add tests/shipment/services/vendorTrackingQueue.service.test.js, tests/shipment/workers/vendorTracking.worker.test.js and a polling lease persistence test.

**Interfaces:** enqueueTrackingCheck({ vendorSubmissionId }) returns { queued, jobId }. Worker reloads current submission/credential references through public ports. Poll state keyed uniquely by vendorSubmissionId stores nextCheckAt, attempt, leaseToken, leaseExpiresAt and lastOutcome. Repository claimDue({ limit, now, leaseToken, leaseExpiresAt }) atomically claims eligible work.

- [ ] Test: a slow client does not block another; duplicate scheduling produces one effective poll; terminal/already-tracked shipment makes no vendor call; expired lease permits recovery while a stale lease cannot commit.
- [ ] Test: 429 honors Retry-After; timeout uses exponential backoff with jitter; invalid references become actionable failures instead of tight retry loops. Explicitly prove manual recheck cannot bypass the same per-client execution guard.
- [ ] Implement short scheduler discovery/enqueue work and worker execution. Preserve the existing manual batch response contract; route its actual vendor call through the shared guarded execution path.
- [ ] Use shared Redis rate/concurrency control by provider plus credential/client ID. Start at one in-flight call per client and two globally; do not rely on per-process counters. Resolve actual vendor limits before activation.
- [ ] Update nextCheckAt after each outcome. Keep the existing 60-minute no-change cadence initially; assess a shorter cadence separately after measuring vendor call volume. Remove completed tracking candidates using current business rules.
- [ ] Run `npm test -- tests/shipment tests/architecture`; include multi-worker/restart persistence tests. Commit and create a standalone PR.

**Gate:** The same workload has no duplicate effective polls, no starvation and no increase in 429/error rate; tracking age improves relative to the baseline.

**Rollback:** Stop new discovery, drain or safely release active poll jobs, then restore the legacy scheduler. Never run both schedulers for the same candidate set.

## Task 3 — Finance Recalculation That Cannot Lose an Update

**Files:** Modify finance/services/financeSnapshotQueue.service.js, financeSnapshot.service.js, financeSnapshotReconciliation.service.js, financeImport.service.js and finance/workers/financeSnapshot.worker.js. Add finance/models/financeRecalculationRequest.model.js and finance/repositories/financeRecalculationRequest.repository.js. Extend finance public ports and order mutation callers for durable notification where necessary. Tests: finance queue/worker/service suites plus tests/finance/financeRecalculation.persistence.test.js.

**Interfaces:** requestRecalculation({ orderItemId, reason, importBatchId }, { session } = {}) persists requestedVersion before queue notification. Claim records the version being processed; completion updates completedVersion only for its own lease/version. A newer requestedVersion remains pending and is re-enqueued. A recovery scanner finds durable pending requests whose queue notification was lost.

- [ ] Write failing tests for two batches targeting one item, updates arriving mid-run, process death after snapshot commit, Redis unavailable after request persistence, and completion/progress counted once per batch-item.
- [ ] Choose and enforce one conflict boundary: serialize work by orderId while recalculating individual items. This also protects manual whole-order transactions from overlapping item workers; migrate all recalculation entrypoints through the same guard.
- [ ] Keep concurrency 3 initially. Read latest source data at execution time. Use version/CAS checks and recovery to converge to the latest requested state; do not claim exactly-once delivery.
- [ ] Keep transaction-bound snapshot writes and audit intact. Persist the request in the originating transaction where supported; explicitly test the recovery path for callers without a shared session.
- [ ] Replace reconciliation's full ID fetch plus slice with DB cursor pagination and a resumable checkpoint; enqueue bounded chunks. Test that later pages are reached after the first page already has snapshots.
- [ ] Run `npm test -- tests/finance tests/architecture` plus affected order mutation tests; commit and create a standalone PR.

**Gate:** Existing financial fixtures remain equal; the latest source version eventually appears in snapshots after crashes/retries; each batch's success/failure counters remain accurate.

**Follow-on PR, only if measured bulk recalculation blocks users:** Add an authorized asynchronous finance batch API returning 202 + jobId, a scoped progress GET endpoint and FE progress/results UI. Preserve existing synchronous endpoints until callers are migrated. Split by order; keep item writes sequential inside each order transaction. Test mixed success/failure, access control and duplicate requests.

**Rollback:** Pause workers and retain durable requests/checkpoints. Drain conflicting work before switching execution paths; never discard pending versions to restore the old queue.

## Task 4 — Separate API, Workers and Schedulers

**Files:** Modify src/server.js and current worker startup/shutdown wiring; add src/workers/run.js, src/schedulers/run.js and a focused technical lifecycle helper only if needed. Update the actual PM2/deploy configuration after inspecting it; do not assume its path. Tests: tests/runtime/backgroundRoles.test.js and existing startup smoke.

**Interfaces:** Explicit process roles `api`, `worker`, `scheduler`; preserve existing combined mode during migration. Role entrypoints own startup, graceful shutdown, health readiness and connections, not domain rules.

- [ ] Write tests proving API-only starts no background processors, worker-only opens no HTTP listener, scheduler-only starts no business worker, and shutdown closes resources after stopping intake.
- [ ] Keep exactly one scheduler role initially; retain distributed protection for deployments/failover. Worker concurrency is a global capacity budget: document process count multiplied by per-process concurrency.
- [ ] Make queue outages visible and durable. Do not silently fall back to heavy synchronous processing in HTTP when using split mode; retain/reconcile pending work instead.
- [ ] Run startup/role tests and architecture checks. Rehearse restart and queue outage locally; create a deployment PR with a process-by-process cutover and rollback sequence.

**Gate:** No double processing after restart; no lost accepted work; API p95 during import/tracking bursts is no worse than baseline, and database latency stays within the agreed budget.

**Rollback:** Stop split workers/schedulers before returning to combined mode; keep queue state and the same global concurrency budget.

## Task 5 — Import and Side-effect Efficiency

**Files:** Target existing integration/externalOrderImport services/workers, mapping/services/fulfillmentPlan.service.js, fulfillmentSideEffectQueue.service.js and vendorSubmission recovery only after Tasks 1–4 identify expensive paths.

**Interfaces:** Retain existing public ports. Group independent work by order/item and serialize effects that mutate the same aggregate. No generic workflow engine.

- [ ] Add a multi-item same-order test proving final order status is correct despite interleaving/retries, and a recovery test proving invalid vendor/customization data is surfaced without repeated automatic vendor submission.
- [ ] Batch repeated reads using existing bulk public ports, chunk enqueue operations, and recompute order-level projections once per affected order when dependencies are complete.
- [ ] Increase import throughput only across independent orders. Preserve sequential state transitions, customization handoff, financial allocation semantics and external submission idempotency.
- [ ] Run affected import/mapping/vendorSubmission suites and architecture checks. Benchmark the same fixture before/after and commit only measured improvements.

## Release Order and Acceptance

1. PR 1: baseline timing/logs.
2. PR 2: tracking queue/leases/client limits.
3. PR 3: durable finance requests/versioning/recovery; optional separate batch UI PR.
4. PR 4: process separation and deployment cutover.
5. Subsequent small PRs: measured import/side-effect optimizations.

Each PR must include tests for its failure boundaries, observed before/after results where available, rollout configuration and rollback steps. Authorize rollout separately, enable one change at a time, compare equivalent workloads, and stop increasing concurrency if DB latency, vendor throttling or API latency regresses. Do not promise a speedup percentage before collecting the baseline. No production assignments, backfill or failed-job retries are included in this plan.
