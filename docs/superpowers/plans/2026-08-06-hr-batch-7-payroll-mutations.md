# HR Batch 7 Payroll Mutation Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep payroll state and audit evidence atomic while making notifications best effort.

**Architecture:** Let Payroll service own transaction boundaries and pass sessions into existing repository transitions and `audit.public.record()`. Process paid results independently to preserve current partial batch behavior.

**Tech Stack:** Node.js, CommonJS, Mongoose, MongoDB Memory Server, Jest.

## Constraints

- Add no model, index, API, queue, outbox, dependency, or formula change.
- Preserve response outcome codes and optimistic version behavior.
- Log notification failures without salary or employee data.
- Run changed payroll tests during implementation and the HR gate once at completion.

### Task 1: Session-Aware Repository Mutations

**Files:**
- Modify: `src/modules/hr/repositories/payroll.repository.js`
- Modify: `src/test/hr/repositories/payroll.repository.test.js` if present; otherwise cover through lifecycle persistence tests.

- [ ] Add failing persistence expectations that provided sessions reach finalization and paid-result writes.
- [ ] Make `finalizeRun()` use a provided session without starting/ending another; retain standalone transaction behavior for existing callers.
- [ ] Add optional session support to `transitionResultToPaid()`.

### Task 2: Atomic Finalization Audit

**Files:**
- Modify: `src/modules/hr/services/payroll.service.js`
- Modify: `src/test/hr/services/payroll.lifecycle.test.js`

- [ ] Add failing tests proving audit failure leaves run/results `DRAFT` and the same version can retry.
- [ ] Move finalization transition and audit into one service-owned transaction.
- [ ] Add a notification-failure test and change notifications to best-effort logging after commit.
- [ ] Run `npx jest src/test/hr/services/payroll.lifecycle.test.js --runInBand` and verify GREEN.

### Task 3: Atomic Paid Audit Per Result

**Files:**
- Modify: `src/modules/hr/services/payroll.service.js`
- Modify: `src/modules/hr/repositories/payroll.repository.js`
- Modify: `src/test/hr/services/payroll.lifecycle.test.js`

- [ ] Add failing mixed-batch tests proving one audit failure rolls back only its result and processing continues.
- [ ] Wrap each conditional paid transition and audit in one transaction.
- [ ] Preserve existing failure classification after a non-transition.
- [ ] Add a paid-notification failure test proving committed state and successful outcome remain.
- [ ] Re-run the payroll lifecycle suite and verify GREEN.

### Task 4: Batch Gate And Commit

- [ ] Run syntax checks for changed production files and `git diff --check`.
- [ ] Run focused payroll lifecycle/calculation/readiness suites.
- [ ] Run `npx jest src/test/hr --runInBand --silent` once.
- [ ] Review scope and commit with `fix(hr): make payroll mutations auditable`.
