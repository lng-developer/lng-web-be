# External Order Import Edge Cases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent ambiguous post-import queue jobs and prevent retry from stealing an actively leased mapping record.

**Architecture:** Keep validation in the existing queue boundary before any raw-record mutation. Keep retry eligibility in `externalOrderImport.service`, where all manual and recovery retries already converge; use the persisted lease expiry for `PROCESSING` records and the existing ten-minute timestamp threshold for `QUEUED` records.

**Tech Stack:** Node.js, Jest, BullMQ-compatible queue wrapper, MongoDB/Mongoose repositories.

## Global Constraints

- Do not change public routes, DTOs, status vocabulary, or module dependencies.
- Do not add dependencies or a new retry abstraction.
- Tests must demonstrate each defect before production code changes.
- Keep `sqlAttendance` outside this plan.

---

## File Structure

- Create `src/test/integration/externalOrderImport/services/postImportMappingQueue.service.test.js`: queue-boundary behavior for incomplete payloads.
- Modify `src/modules/integration/externalOrderImport/services/postImportMappingQueue.service.js`: reject incomplete queue payloads before record mutation or queue access.
- Modify `src/test/integration/externalOrderImport/services/externalOrderImport.service.test.js`: active-lease retry regression.
- Modify `src/modules/integration/externalOrderImport/services/externalOrderImport.service.js`: status-specific staleness calculation.

### Task 1: Reject Ambiguous Queue Payloads

**Files:**
- Create: `src/test/integration/externalOrderImport/services/postImportMappingQueue.service.test.js`
- Modify: `src/modules/integration/externalOrderImport/services/postImportMappingQueue.service.js`

**Interfaces:**
- Consumes: `enqueuePostImportMappingJob(payload)` and existing `{ queued, errorCode, errorMessage }` failure result.
- Produces: the same return shape; incomplete payloads return `queued: false` without touching raw records or Redis.

- [ ] **Step 1: Write the failing test**

Mock `config.redis.enabled`, `createQueue`, the raw-record repository, and logger before requiring the service. Cover both missing identity dimensions with literal fixtures:

```js
test.each([
  [{ importJobId: 'job-1', rawRecordId: 'raw-1' }, 'orderItemId'],
  [{ importJobId: 'job-1', orderItemId: 'item-1' }, 'rawRecordId'],
])('rejects an incomplete payload before mutation: missing %s', async (payload) => {
  const result = await service.enqueuePostImportMappingJob(payload);

  expect(result).toMatchObject({
    queued: false,
    errorCode: 'POST_IMPORT_QUEUE_UNAVAILABLE',
  });
  expect(rawRecordRepository.updatePostImportResult).not.toHaveBeenCalled();
  expect(queue.add).not.toHaveBeenCalled();
});
```

Use descriptive case names rather than relying on the `%s` rendering if Jest prints the payload first.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```powershell
$env:MONGODB_URI='mongodb://127.0.0.1:27017/lng_web_test'
npx jest --runInBand src/test/integration/externalOrderImport/services/postImportMappingQueue.service.test.js
```

Expected: FAIL because the current implementation mutates `raw-1` or calls `queue.add` with a job ID containing `undefined`.

- [ ] **Step 3: Add the minimum boundary guard**

Inside the existing `try` block, before checking Redis or building the job ID, require all identity inputs used by mutation and job identity:

```js
const rawRecordIds = getPayloadRawRecordIds(payload);
if (!payload.importJobId || !payload.orderItemId || rawRecordIds.length === 0) {
  throw new Error('Post-import queue payload requires importJobId, orderItemId, and rawRecordId');
}
```

Reuse `rawRecordIds` in the existing queued-state update. In the `catch` block, call `markQueueFailure` only when `getPayloadRawRecordIds(payload).length > 0`; this preserves failure persistence for valid raw records while ensuring a payload with no raw record cannot mutate anything.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2. Expected: both cases PASS and no queue call occurs.

- [ ] **Step 5: Run the external-order suite**

```powershell
$env:MONGODB_URI='mongodb://127.0.0.1:27017/lng_web_test'
npx jest --runInBand src/test/integration/externalOrderImport
```

Expected: all baseline 78 tests plus the new payload cases pass.

- [ ] **Step 6: Commit**

```powershell
git add src/modules/integration/externalOrderImport/services/postImportMappingQueue.service.js src/test/integration/externalOrderImport/services/postImportMappingQueue.service.test.js
git commit -m "fix(integration): reject incomplete post-import jobs"
```

### Task 2: Respect Active Processing Leases

**Files:**
- Modify: `src/test/integration/externalOrderImport/services/externalOrderImport.service.test.js`
- Modify: `src/modules/integration/externalOrderImport/services/externalOrderImport.service.js`

**Interfaces:**
- Consumes: `retryImportJob(jobId, authContext)` and persisted `postImportLeaseExpiresAt`.
- Produces: unchanged retry result; active `PROCESSING` records are omitted from enqueue calls and successful requeue counts.

- [ ] **Step 1: Write the failing test**

Freeze the clock and provide a `PROCESSING` record whose start time is old but lease is still active:

```js
test('does not requeue a processing record while its lease is active', async () => {
  jest.useFakeTimers().setSystemTime(new Date('2026-07-31T06:00:00.000Z'));
  rawRecordRepository.listAllByJob.mockResolvedValue([{
    _id: '660000000000000000000505',
    importStatus: 'IMPORTED',
    postImportStatus: 'PROCESSING',
    postImportStartedAt: new Date('2026-07-31T05:40:00.000Z'),
    postImportLeaseExpiresAt: new Date('2026-07-31T06:05:00.000Z'),
    orderItemId: '660000000000000000000405',
  }]);

  const result = await service.retryImportJob(
    '660000000000000000000601',
    { system: true, source: 'TEST' },
  );

  expect(postImportMappingQueue.enqueuePostImportMappingJob).not.toHaveBeenCalled();
  expect(result.requeuedPostImportJobs).toBe(0);
  jest.useRealTimers();
});
```

Restore real timers in `afterEach` so a failed assertion cannot leak fake time into later tests.

- [ ] **Step 2: Run the focused test and verify RED**

```powershell
$env:MONGODB_URI='mongodb://127.0.0.1:27017/lng_web_test'
npx jest --runInBand src/test/integration/externalOrderImport/services/externalOrderImport.service.test.js -t "does not requeue a processing record while its lease is active"
```

Expected: FAIL because the current code uses the old `postImportStartedAt` and enqueues the record despite the future lease expiry.

- [ ] **Step 3: Make staleness status-specific**

Replace the shared timestamp calculation inside `retryImportJob` with:

```js
const staleThreshold = Date.now() - POST_IMPORT_STALE_MS;
const queuedStale = rawRecord.postImportStatus === externalOrderPostImportStatuses.QUEUED
  && rawRecord.postImportQueuedAt
  && new Date(rawRecord.postImportQueuedAt).getTime() <= staleThreshold;
const processingStale = rawRecord.postImportStatus === externalOrderPostImportStatuses.PROCESSING
  && rawRecord.postImportLeaseExpiresAt
  && new Date(rawRecord.postImportLeaseExpiresAt).getTime() <= Date.now();
const canRetryPostImport = [
  externalOrderPostImportStatuses.PENDING,
  externalOrderPostImportStatuses.FAILED,
].includes(rawRecord.postImportStatus) || queuedStale || processingStale;
```

Do not add another helper or configuration option.

- [ ] **Step 4: Run focused GREEN and existing stale retry coverage**

```powershell
$env:MONGODB_URI='mongodb://127.0.0.1:27017/lng_web_test'
npx jest --runInBand src/test/integration/externalOrderImport/services/externalOrderImport.service.test.js
```

Expected: the active-lease test and the existing stale-queued retry test both PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/integration/externalOrderImport/services/externalOrderImport.service.js src/test/integration/externalOrderImport/services/externalOrderImport.service.test.js
git commit -m "fix(integration): respect active post-import leases"
```

### Task 3: Regression Verification

**Files:**
- Verify only; no expected source changes.

**Interfaces:**
- Consumes: commits from Tasks 1 and 2.
- Produces: fresh evidence for external order import, all Integration tests, architecture boundaries, and the backend suite.

- [ ] **Step 1: Check diff hygiene**

```powershell
git diff origin/develop...HEAD --check
git status --short
```

Expected: no whitespace errors and no untracked implementation artifacts.

- [ ] **Step 2: Run all external-order and Integration tests**

```powershell
$env:MONGODB_URI='mongodb://127.0.0.1:27017/lng_web_test'
npx jest --runInBand src/test/integration/externalOrderImport
npx jest --runInBand src/test/integration
```

Expected: zero failed suites and zero failed tests.

- [ ] **Step 3: Run architecture and full backend regression**

```powershell
$env:MONGODB_URI='mongodb://127.0.0.1:27017/lng_web_test'
npm run test:architecture -- --runInBand
npm test -- --runInBand
```

Expected: zero failed suites and zero failed tests; intentional skips remain reported as skips.

- [ ] **Step 4: Review final branch scope**

```powershell
git log --oneline origin/develop..HEAD
git diff --stat origin/develop...HEAD
git status --short --branch
```

Expected: one design commit plus the two focused fix commits, with a clean worktree.
