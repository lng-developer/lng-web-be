# HR Batch 8 Payroll Adjustment Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make adjustment mutation, audit, and DRAFT payroll refresh atomic and lock finalized periods.

**Architecture:** Payroll Adjustment service owns transactions. Existing Payroll repository queries and `refreshDraftPayrollResult()` accept optional sessions so the current calculation path is reused without formula duplication.

**Tech Stack:** Node.js, CommonJS, Mongoose, MongoDB Memory Server, Joi, Jest.

## Constraints

- Add no endpoint, model, review flow, queue, outbox, dependency, or formula change.
- Preserve optimistic versions and adjustment DTOs.
- Run changed tests during implementation and the HR gate once at completion.

### Task 1: Positive Adjustment Amount

**Files:**
- Modify: `src/modules/hr/models/payrollAdjustment.model.js`
- Modify: `src/modules/hr/validators/payroll.validator.js`
- Modify: `src/test/hr/routes/payroll.routes.test.js`
- Modify the existing HR model test covering Payroll Adjustment.

- [ ] Add failing route/model tests for amount `0`.
- [ ] Change Joi and Mongoose minimum from zero to one.
- [ ] Run the changed route/model tests and verify GREEN.

### Task 2: Session-Aware Payroll Refresh

**Files:**
- Modify: `src/modules/hr/repositories/payroll.repository.js`
- Modify: `src/modules/hr/services/payroll.service.js`
- Verify: `src/test/hr/services/payroll.lifecycle.test.js`

- [ ] Propagate an optional session through period lookup, calculation-input reads, and DRAFT result replacement.
- [ ] Keep default callers unchanged when no session is provided.
- [ ] Add lifecycle evidence that refresh failure rolls back its caller transaction.

### Task 3: Atomic Adjustment Mutations And Period Lock

**Files:**
- Modify: `src/modules/hr/services/payrollAdjustment.service.js`
- Modify: `src/modules/hr/repositories/payroll.repository.js`
- Modify: `src/test/hr/services/payroll.lifecycle.test.js`

- [ ] Add failing tests for create/update/cancel against `FINALIZED` and `PAID` periods.
- [ ] Add failing tests proving create audit failure and DRAFT refresh failure leave no adjustment mutation.
- [ ] Add optional session support to adjustment repository methods.
- [ ] Wrap create/update/cancel, audit, and optional DRAFT refresh in one transaction.
- [ ] Preserve stale/not-found/cancelled classifications and re-run lifecycle tests.

### Task 4: Finalize/Adjustment Race

**Files:**
- Modify: `src/test/hr/services/payroll.lifecycle.test.js`
- Modify production only if the persistence test exposes a remaining root-cause defect.

- [ ] Start finalization and adjustment concurrently for one DRAFT period.
- [ ] Assert either the adjustment is included in DRAFT before finalization or the locked-period adjustment is absent; never allow a persisted adjustment omitted from an open DRAFT result.
- [ ] Run the lifecycle suite and verify GREEN.

### Task 5: Batch Gate And Commit

- [ ] Run syntax checks for changed production files and `git diff --check`.
- [ ] Run focused Payroll lifecycle, route, model, calculation, and readiness suites.
- [ ] Run `npx jest src/test/hr --runInBand --silent` once.
- [ ] Review scope and commit with `fix(hr): make payroll adjustments atomic`.
