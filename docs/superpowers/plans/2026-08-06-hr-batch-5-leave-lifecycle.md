# HR Batch 5 Leave Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Prevent stale or concurrent leave mutations from corrupting balance and reject leave outside employment dates.

**Architecture:** Keep all behavior in the existing Leave service and repository contracts. Validate employment dates in the shared request preparation path, and make approved cancellation derive its decision and remaining units from a request re-read inside the existing MongoDB transaction.

**Tech Stack:** Node.js, CommonJS, Mongoose, MongoDB Memory Server, Jest.

## Constraints

- Add no model, index, API, lock, dependency, or abstraction.
- Preserve current authorization, notification, audit, and DTO contracts.
- Run only changed tests while implementing.
- At the batch gate run `npx jest src/test/hr --runInBand --silent`; do not run the full repository suite.

### Task 1: Employment-Date Validation

**Files:**
- Modify: `src/modules/hr/services/leave.service.js`
- Modify: `src/test/hr/services/leave.service.test.js`

- [ ] Write failing tests proving a request before `startDate` and after `endDate` returns `VALIDATION_ERROR`, while boundary dates and a null `endDate` remain valid.
- [ ] Run `npx jest src/test/hr/services/leave.service.test.js --runInBand` and verify RED.
- [ ] Add one small date-key helper and validate the requested range in `prepareRequest()` before schedule resolution.
- [ ] Re-run the same test and verify GREEN.

### Task 2: Current-State Approved Cancellation

**Files:**
- Modify: `src/modules/hr/services/leave.service.js`
- Modify: `src/test/hr/services/leave.service.test.js`
- Modify: `src/test/hr/services/leave.lifecycle.test.js`

- [ ] Write a failing unit test proving cancellation re-reads the request in the transaction and uses its current `requestedUnits`, dates, profile, year, and leave type.
- [ ] Write a failing lifecycle test: approve a multi-day annual request, partially refund it, cancel it, then assert `usedUnits: 0`, no leave projection, and one cancellation result.
- [ ] Run both changed suites and verify RED.
- [ ] Move the approved-state validation, date check, active-unit calculation, attendance reversal, refund, and conditional transition behind the transactional re-read.
- [ ] Treat a transaction-time `CANCELLED` state as an authorized idempotent result; reject every other unexpected state.
- [ ] Re-run both suites and verify GREEN.

### Task 3: Refund/Cancel Race Persistence

**Files:**
- Modify: `src/test/hr/services/leave.lifecycle.test.js`
- Modify production only if this test exposes a remaining root-cause defect.

- [ ] Add one persistence test that starts partial refund and approved cancellation concurrently against the same request.
- [ ] Assert the final balance equals the units represented by the final request projection, no date is refunded twice, and a terminal cancellation has no leave projection.
- [ ] Run `npx jest src/test/hr/services/leave.lifecycle.test.js --runInBand` and verify GREEN after the Task 2 fix.

### Task 4: Batch Gate And Commit

- [ ] Run `node -c src/modules/hr/services/leave.service.js` and `git diff --check`.
- [ ] Run focused suites: `npx jest src/test/hr/services/leave.service.test.js src/test/hr/services/leave.lifecycle.test.js --runInBand`.
- [ ] Run the HR gate: `npx jest src/test/hr --runInBand --silent`.
- [ ] Review the diff for scope and commit with `fix(hr): harden leave lifecycle`.
