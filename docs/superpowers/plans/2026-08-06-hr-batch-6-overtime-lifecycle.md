# HR Batch 6 Overtime Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reject overtime outside employment dates and stop approved overtime cancellation after work begins.

**Architecture:** Add both rules to the existing Overtime service. Reuse `prepareRequest()` for create/update and the current conditional transition for cancellation concurrency.

**Tech Stack:** Node.js, CommonJS, Mongoose, MongoDB Memory Server, Jest.

## Constraints

- Add no model, index, API, transaction, lock, dependency, or adjustment workflow.
- Preserve current authorization, audit, notification, rate allocation, and DTO contracts.
- Run changed tests during implementation and the HR gate once at completion.

### Task 1: Employment-Date Validation

**Files:**
- Modify: `src/modules/hr/services/overtime.service.js`
- Modify: `src/test/hr/services/overtime.service.test.js`

- [ ] Add failing tests for work dates before `startDate`, after `endDate`, on exact boundaries, and with no end date.
- [ ] Run `npx jest src/test/hr/services/overtime.service.test.js --runInBand` and verify RED.
- [ ] Add one date-key helper and validate in `prepareRequest()` before schedule resolution.
- [ ] Re-run the service suite and verify GREEN.

### Task 2: Approved Cancellation Cutoff

**Files:**
- Modify: `src/modules/hr/services/overtime.service.js`
- Modify: `src/test/hr/services/overtime.service.test.js`

- [ ] Add failing fake-time tests for cancellation immediately before and exactly at `plannedStartAt`.
- [ ] Verify pending requester cancellation remains unchanged.
- [ ] Run the service suite and verify RED.
- [ ] Add the persisted `plannedStartAt` cutoff after authorization and approved-reason validation.
- [ ] Re-run the service suite and verify GREEN.

### Task 3: Concurrent Cancellation Persistence

**Files:**
- Modify: `src/test/hr/services/overtime.lifecycle.test.js`
- Modify production only if the persistence test exposes a root-cause defect.

- [ ] Add a test issuing two pending cancellations concurrently.
- [ ] Assert one persisted `CANCELLED` request, one cancellation audit, and one deduplicated notification.
- [ ] Run `npx jest src/test/hr/services/overtime.lifecycle.test.js --runInBand` and verify GREEN.

### Task 4: Batch Gate And Commit

- [ ] Run `node -c src/modules/hr/services/overtime.service.js` and `git diff --check`.
- [ ] Run focused suites: `npx jest src/test/hr/services/overtime.service.test.js src/test/hr/services/overtime.lifecycle.test.js --runInBand`.
- [ ] Run `npx jest src/test/hr --runInBand --silent` once.
- [ ] Review scope and commit with `fix(hr): harden overtime lifecycle`.
