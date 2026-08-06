# HR Batch 2 Schedule Edge Cases Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce Shift Assignment consistency, employment bounds, concurrent overlap safety, and idempotent schedule updates.

**Architecture:** Existing HR validators keep request-shape checks while `schedule.service` owns cross-record rules. Assignment writes use MongoDB transactions and a per-profile version increment to serialize overlap decisions; cross-module access remains through public ports.

**Tech Stack:** Node.js, CommonJS, Joi, Mongoose, MongoDB transactions, Jest, mongodb-memory-server.

## Global Constraints

- Do not implement historical Shift or Work Location versioning in this batch.
- Do not change Calendar Override behavior.
- Preserve existing HTTP error codes and modular-monolith boundaries.
- Use TDD and targeted tests until the final verification gate.

---

### Task 1: Shift duration and location consistency

**Files:**
- Modify: `src/modules/hr/services/schedule.service.js`
- Test: `src/test/hr/services/schedule.service.test.js`
- Test: `src/test/hr/validators/schedule.validator.test.js`

**Interfaces:**
- Produces: `400 VALIDATION_ERROR` for `breakMinutes >= duration` and fixed Shift/Assignment location mismatch.

- [ ] Add failing tests for create/update Shift with excessive break and create/update Assignment whose location differs from the Shift location.
- [ ] Run the two targeted files and confirm failures come from missing cross-record rules.
- [ ] Extend the existing `assertShiftDuration()` and add one ID comparison helper used by both assignment mutations.
- [ ] Re-run the targeted tests and confirm green.

### Task 2: Employment date boundaries

**Files:**
- Modify: `src/modules/hr/services/schedule.service.js`
- Test: `src/test/hr/services/schedule.service.test.js`

**Interfaces:**
- Produces: one internal assertion comparing assignment date keys with profile `startDate/endDate` UTC keys.

- [ ] Add failing create/update tests for before-start, after-end, and open-ended assignment on an ended employee.
- [ ] Run the service test and confirm the writes currently proceed.
- [ ] Add the minimal shared assertion and invoke it after loading the destination profile.
- [ ] Re-run the service test and confirm green.

### Task 3: Serialize overlap writes per profile

**Files:**
- Modify: `src/modules/hr/models/employeeProfile.model.js`
- Modify: `src/modules/hr/repositories/employeeProfile.repository.js`
- Modify: `src/modules/hr/repositories/schedule.repository.js`
- Modify: `src/modules/hr/services/schedule.service.js`
- Test: `src/test/hr/repositories/employeeProfile.repository.test.js`
- Test: `src/test/hr/services/schedule.service.test.js`
- Create: `src/test/hr/services/scheduleAssignment.persistence.test.js`

**Interfaces:**
- Produces: `profileRepository.touchScheduleMutation(profileId, { session })`; assignment repository create/update methods accept `{ session }`; assignment service writes run in transactions.

- [ ] Add failing repository tests for session propagation and a replica-set test starting two overlapping writes concurrently for one profile.
- [ ] Run the repository/service/persistence tests and confirm both concurrent writes can currently commit.
- [ ] Add hidden `scheduleMutationVersion`, implement the atomic increment, and transaction-wrap create/update assignment. Lock profile IDs in sorted order before overlap query; map the losing transaction to the existing overlap conflict.
- [ ] Re-run the three tests and confirm exactly one concurrent overlapping assignment persists.

### Task 4: Idempotent schedule updates

**Files:**
- Modify: `src/modules/hr/services/schedule.service.js`
- Test: `src/test/hr/services/schedule.service.test.js`

**Interfaces:**
- Produces: no-op return for unchanged Work Location, Shift, and Assignment payload fields.

- [ ] Add failing tests asserting unchanged updates skip repository writes and audit calls.
- [ ] Run the service test and confirm current mutation calls occur.
- [ ] Compare normalized scalar/ID/array values only for keys present in the payload and return current DTO when unchanged.
- [ ] Re-run the service test and confirm green.

### Task 5: Verification and commit

**Files:**
- Verify all production and test files changed in Tasks 1-4.

**Interfaces:**
- Produces: one implementation commit on the current branch.

- [ ] Run `node -c` for every changed JavaScript file and `git diff --check`.
- [ ] Run the seven Batch 2 baseline suites plus the new persistence suite.
- [ ] Run `npm run test:hr -- --runInBand` if available; otherwise run `npx jest src/test/hr --runInBand`.
- [ ] Run `npm run test:architecture -- --runInBand`.
- [ ] Run `npm test -- --runInBand` once on the final tree.
- [ ] Inspect the diff and commit with `fix(hr): harden schedule edge cases`.
