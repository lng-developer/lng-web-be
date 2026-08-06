# HR Batch 4 Attendance Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make attendance imports race-safe and assign overnight punches to the shift start work date.

**Architecture:** Replace the import batch `find -> start` race with an atomic repository claim backed by the existing unique `sourceBatchId`. Reuse `resolveContextForInstant()` for imported punches, cache its canonical schedule lookups per request, and group only after each punch has a resolved work date.

**Tech Stack:** Node.js, CommonJS, Mongoose, MongoDB Memory Server, Jest.

## Global Constraints

- A `PROCESSING` batch returns `409 CONFLICT_ERROR`.
- A `COMPLETED` batch is an idempotent replay; only a missing or `FAILED` batch can be claimed.
- Preserve manual edits, leave segments, manual adjustments, and stored schedule snapshots.
- Add no dependencies, queues, Redis locks, or new domain models.
- During implementation run changed test files only. At the Batch 4 gate run `npx jest src/test/hr --runInBand --silent`.
- Do not run the full repository suite until PR or merge preparation.

---

### Task 1: Atomic Import Batch Claim

**Files:**
- Modify: `src/modules/hr/repositories/attendanceImportBatch.repository.js`
- Modify: `src/modules/hr/services/attendance.service.js`
- Create: `src/test/hr/repositories/attendanceImportBatch.repository.test.js`
- Modify: `src/test/hr/services/attendanceImport.service.test.js`

**Interfaces:**
- Produces: `batchRepository.claim(sourceBatchId, punchCount) -> { acquired: boolean, batch: object|null }`.
- Consumes: existing batch states `PROCESSING`, `COMPLETED`, and `FAILED`.

- [ ] **Step 1: Write failing repository claim tests**

Cover a missing batch create, a `FAILED -> PROCESSING` retry, and an existing non-failed batch that is not acquired:

```js
await expect(repository.claim('batch-1', 2)).resolves.toMatchObject({
  acquired: true,
  batch: { sourceBatchId: 'batch-1', status: 'PROCESSING', punchCount: 2 },
});
```

Mock the model boundary precisely: conditional update for `FAILED`, then create for missing, and duplicate-key recovery through `findOne().lean()`.

- [ ] **Step 2: Run repository test and verify RED**

Run: `npx jest src/test/hr/repositories/attendanceImportBatch.repository.test.js --runInBand`

Expected: FAIL because `claim()` does not exist.

- [ ] **Step 3: Implement the minimal claim**

In the repository:

1. Atomically update `{ sourceBatchId, status: 'FAILED' }` to `PROCESSING` and reset `punchCount`/`result`.
2. If no failed row matched, attempt `AttendanceImportBatch.create()` for a missing row.
3. On duplicate key, read the existing row and return `{ acquired: false, batch }`.

Do not retain `start()` after its only caller is migrated.

- [ ] **Step 4: Write failing service state tests**

Add tests with a fake batch repository:

```js
claim: jest.fn().mockResolvedValue({ acquired: false, batch: { status: 'PROCESSING' } })
```

Expect `CONFLICT_ERROR`. For `COMPLETED`, expect the existing unchanged replay result and no attendance write or audit.

- [ ] **Step 5: Run service test and verify RED**

Run: `npx jest src/test/hr/services/attendanceImport.service.test.js --runInBand`

- [ ] **Step 6: Replace `find -> start` with claim handling**

Call `claim()` once. If not acquired:

- `COMPLETED` -> return replay result.
- `PROCESSING` -> throw the existing attendance `conflict()` error.
- Any other observed state -> return conflict rather than process without ownership.

- [ ] **Step 7: Re-run repository and import tests**

Run: `npx jest src/test/hr/repositories/attendanceImportBatch.repository.test.js src/test/hr/services/attendanceImport.service.test.js --runInBand`

Expected: both suites PASS.

### Task 2: Canonical Overnight Punch Grouping

**Files:**
- Modify: `src/modules/hr/services/attendance.service.js`
- Modify: `src/test/hr/services/attendanceImport.service.test.js`
- Verify: `src/test/hr/services/attendance.service.test.js`

**Interfaces:**
- Extends internal `resolveContextForInstant(profileId, occurredAt, options)` with optional `{ resolver, contextCache }` dependencies while preserving existing self-service callers.
- Import dependencies accept `scheduleResolver` for isolated tests.

- [ ] **Step 1: Write the failing overnight import test**

Provide a resolver fake for shift `22:00-06:00` and two punches:

```js
2026-08-10T15:05:00.000Z // 22:05 Asia/Ho_Chi_Minh
2026-08-10T22:55:00.000Z // 05:55 next local day
```

Expect one Attendance Daily row with `workDateKey: '2026-08-10'`, the first instant as check-in, and the second as check-out.

- [ ] **Step 2: Write the failing unresolved/invalid punch tests**

- A valid employee with `SCHEDULE_UNRESOLVED` increments `failed` and creates no attendance row.
- An invalid `occurredAt` increments `failed` and leaves the batch `FAILED` instead of throwing and leaving it `PROCESSING`.

- [ ] **Step 3: Run import tests and verify RED**

Run: `npx jest src/test/hr/services/attendanceImport.service.test.js --runInBand`

Expected: overnight punches currently split by calendar date and malformed dates currently escape the per-punch failure path.

- [ ] **Step 4: Add request-local lookup caches**

In `importAttendancePunches()` create:

```js
const profilesByCode = new Map();
const contextsByWorkDate = new Map();
```

Cache employee results, including `null`. In `resolveContextForInstant()`, cache each canonical resolver call under `${profileId}:${workDateKey}`; do not cache the final instant decision by local date.

- [ ] **Step 5: Resolve before grouping**

For each punch, catch validation/profile/schedule failures inside the loop. Resolve its context, reject `SCHEDULE_UNRESOLVED`, then group by `${profileId}:${context.workDateKey}` and retain that context on the group.

At group processing time, build the snapshot from the retained canonical context. Derive Attendance Resolution inputs directly:

```js
const holiday = context.holiday ? {
  ...context.holiday,
  isApplicable: true,
  isPaid: context.holiday.holidayType === 'PUBLIC_HOLIDAY' && !context.holiday.isWorkDay,
} : null;
```

Use `context.isRotationOff` and the date's Sunday status. Do not call Calendar Policy a second time.

- [ ] **Step 6: Run import and self-service tests**

Run: `npx jest src/test/hr/services/attendanceImport.service.test.js src/test/hr/services/attendance.service.test.js --runInBand`

Expected: both suites PASS, proving self-service behavior remains unchanged.

### Task 3: Claim Race Persistence

**Files:**
- Create: `src/test/hr/repositories/attendanceImportBatch.persistence.test.js`
- Modify only if exposed by the test: `src/modules/hr/repositories/attendanceImportBatch.repository.js`

**Interfaces:**
- Consumes: `claim(sourceBatchId, punchCount)` from Task 1.
- Produces: exactly one acquired owner for concurrent claims.

- [ ] **Step 1: Write the persistence test**

Use `MongoMemoryServer`, initialize the unique index, and run:

```js
const results = await Promise.all([
  repository.claim('sql:race', 2),
  repository.claim('sql:race', 2),
]);
expect(results.filter(({ acquired }) => acquired)).toHaveLength(1);
expect(results.filter(({ acquired }) => !acquired)).toHaveLength(1);
```

Verify one document exists and its state is `PROCESSING`.

- [ ] **Step 2: Run persistence test and verify GREEN**

Run: `npx jest src/test/hr/repositories/attendanceImportBatch.persistence.test.js --runInBand`

- [ ] **Step 3: Run Batch 4 focused suites**

Run: `npx jest src/test/hr/repositories/attendanceImportBatch.repository.test.js src/test/hr/repositories/attendanceImportBatch.persistence.test.js src/test/hr/services/attendanceImport.service.test.js src/test/hr/services/attendance.service.test.js --runInBand`

Expected: all suites PASS.

### Task 4: Batch Gate And Commit

**Files:**
- Verify all Batch 4 production and test files.

**Interfaces:**
- Produces: a clean, committed Batch 4 implementation.

- [ ] **Step 1: Run syntax and diff checks**

Run `node -c` for changed production JavaScript files, followed by `git diff --check`.

- [ ] **Step 2: Run the HR gate**

Run: `npx jest src/test/hr --runInBand --silent`

Expected: all HR suites PASS. Do not run `npm test`.

- [ ] **Step 3: Review the final diff**

Confirm no manual adjustment, leave reconciliation, self-service API contract, frontend, Redis, or queue changes entered the batch.

- [ ] **Step 4: Commit implementation**

```bash
git commit -m "fix(hr): harden attendance imports"
```
