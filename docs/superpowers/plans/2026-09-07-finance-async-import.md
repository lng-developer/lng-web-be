# Finance Async Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Amazon finance imports out of the HTTP request, add idempotency, and let the extension poll the durable batch until completion.

**Architecture:** The existing finance import service remains the parser and business-rule boundary. A small finance import queue service enqueues batch ids, a BullMQ worker runs the existing importer, and the upload controller returns the persisted batch immediately. The extension computes a stable request key, submits once, then polls the existing batch endpoint.

**Tech Stack:** Node.js/Express, MongoDB/Mongoose, BullMQ/Redis, React-independent Chrome extension JavaScript, Jest, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-07-finance-async-import-design.md`

## Global Constraints

- Preserve existing finance parser, normalized schemas, source identity indexes, and manual import behavior.
- Do not expose secrets or commit `.env` files.
- Use `QUEUED`, `PROCESSING`, `COMPLETED`, `PARTIAL_FAILED`, and `FAILED` only for finance import batches.
- Use the existing public finance routes and auth context; do not introduce a second import API.
- Keep one active import per shop and source type through BullMQ job identity/worker gating.

---

### Task 1: Persist idempotency and queue state

**Files:**
- Modify: `src/modules/finance/models/financeImportBatch.model.js`
- Create: `src/modules/finance/constants/financeImport.constants.js`
- Modify: `src/modules/finance/repositories/financeImport.repository.js`
- Test: `tests/finance/models/financeSourceModels.test.js`
- Test: `tests/finance/repositories/financeImport.repository.test.js`

**Interfaces:**
- Produce `findImportBatchByIdempotency({ shopId, sourceType, idempotencyKey })` and `createImportBatch` support for `idempotencyKey`.
- Preserve `sourceAssetId`, `sourceRef`, and all existing DTO fields.

- [ ] Write failing model/repository tests asserting the idempotency key is persisted and duplicate lookup uses shop/source/key.
- [ ] Run the focused Jest tests and confirm they fail because the field/query do not exist.
- [ ] Add `idempotencyKey` to the schema, add `QUEUED` to the enum, and add the unique compound index `{ shopId: 1, sourceType: 1, idempotencyKey: 1 }` with a partial string filter.
- [ ] Implement the repository lookup and map duplicate-key errors to a caller-detectable conflict.
- [ ] Run the focused tests and confirm they pass.

### Task 2: Add the finance import queue and worker

**Files:**
- Create: `src/modules/finance/services/financeImportQueue.service.js`
- Create: `src/modules/finance/workers/financeImport.worker.js`
- Modify: `src/server.js`
- Modify: `src/modules/finance/services/financeImport.service.js`
- Test: `tests/finance/services/financeImportQueue.service.test.js`
- Test: `tests/finance/workers/financeImport.worker.test.js`

**Interfaces:**
- `enqueueFinanceImport({ batchId })` returns `{ queued: true, jobId }` and uses `jobId: finance-import-${batchId}`.
- `processFinanceImportJob(job)` reads the batch, runs the existing file importer, and completes the same batch.
- `startFinanceImportWorker()` returns a BullMQ worker with bounded concurrency.

- [ ] Write failing queue/worker tests for deterministic job id, status transition to `PROCESSING`, completion, and failure persistence.
- [ ] Run the focused tests and confirm they fail because the queue/worker modules do not exist.
- [ ] Implement the queue with three attempts and exponential backoff; refuse queueing when Redis is disabled.
- [ ] Move the existing `runImportBatch` call behind the worker while preserving audit metadata and source asset cleanup.
- [ ] Start/stop the worker with the existing server bootstrap/shutdown lifecycle.
- [ ] Run the focused tests and the existing finance test directory.

### Task 3: Make finance upload endpoints return immediately and deduplicate

**Files:**
- Modify: `src/modules/finance/controllers/financeImport.controller.js`
- Modify: `src/modules/finance/services/financeImport.service.js`
- Modify: `src/modules/finance/routes/index.js` only if response status handling requires it
- Modify: `src/modules/finance/validators/financeSnapshot.validator.js`
- Test: `tests/finance/routes/index.test.js`
- Test: `tests/finance/services/financeImport.service.test.js`

**Interfaces:**
- Accept `Idempotency-Key` for transactions and settlements (max 255 characters).
- Return the existing batch for a duplicate key; otherwise create `QUEUED` and enqueue it.
- Keep manual callers without a key compatible by deriving a stable fallback from source context/file metadata where safe.

- [ ] Write failing route/service tests for `202`, queued status, idempotency replay, and Redis-unavailable failure.
- [ ] Run the focused tests and confirm they fail against the synchronous `200` behavior.
- [ ] Implement upload asset storage, duplicate lookup, queued batch creation, and queue enqueueing without reading/parsing the file in the request.
- [ ] Return `202` only after the batch and queue job are durable; clean up an unattached asset if batch creation/queueing fails.
- [ ] Run focused route/service tests and all finance tests.

### Task 4: Add extension hash/key and async polling

**Files:**
- Modify: `backendApi.js`
- Modify: `background.js`
- Modify: `extensionLogger.js` only if terminal async messages need classification
- Modify: `tests/extension-contract.test.mjs`
- Modify: `tests/amazon-transaction.test.mjs` or create `tests/finance-import-async.test.mjs`

**Interfaces:**
- `postFileTo` accepts an optional `Idempotency-Key` header and returns HTTP status/body metadata for `202`.
- `runImportTransactions` submits the CSV once, extracts `data.importBatchId`, polls `/api/finance/import-batches/:batchId`, and resolves with the terminal batch.

- [ ] Write failing tests for the idempotency header, `202` response, polling through `PROCESSING`, and terminal `COMPLETED/FAILED` behavior.
- [ ] Run the focused Node tests and confirm they fail because upload waits for a synchronous JSON response.
- [ ] Implement a small deterministic hash using Web Crypto over the generated CSV plus source/date context.
- [ ] Add bounded polling with exponential delay and a clear timeout error; never resubmit the same file automatically.
- [ ] Log queued, processing, completed, and failed states without logging token or CSV contents.
- [ ] Run all extension tests and syntax checks.

### Task 5: Verify deployment-facing behavior and documentation

**Files:**
- Modify: `docs/finance/FINANCE_API.md`
- Modify: `README.md` if extension setup documentation needs the async polling contract

- [ ] Document `202`, `Idempotency-Key`, batch polling, and terminal statuses.
- [ ] Run backend finance tests, extension tests, FE tests/typecheck if touched, and `git diff --check` in each repository.
- [ ] Verify a 994-row dev import creates one batch, returns before Cloudflare timeout, reaches a terminal status, and produces the expected normalized row counts.
- [ ] Report that deployment/push remains separate from local verification.
