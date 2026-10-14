# Design and Production RBAC Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enforce distinct PSD, scale, assignment and QC responsibilities without adding a new Scale Request workflow.

**Architecture:** Keep PSD work in `DesignTask` and per-order scaling in `ProductionTask`. Add narrow Production permissions and role codes, then make production service-level authorization use `csAssigneeId` for scale-worker ownership and separate team queue assignment from QC approval. Existing `PRODUCTION:WRITE` remains the privileged operational fallback.

**Tech Stack:** Node.js, Express, CommonJS, Mongoose, Joi, Jest, existing Auth and Organization public ports.

**Spec:** `docs/superpowers/specs/2026-10-02-design-production-rbac-design.md`

## Global Constraints

- Do not create a `ScaleRequest` model or module.
- Do not grant ordinary `CS_OPERATOR` accounts `PRODUCTION:WRITE`.
- Keep cross-module calls behind `public.js`; keep read-only Mongoose calls lean and return DTOs.
- `csAssigneeId` is the scale assignee; `assignedDesignUserId` remains the legacy production-design assignee.
- Service authorization is authoritative; route guards only reject requests early.
- Preserve optimistic-concurrency, audit and vendor-readiness safeguards.

## Review Focus

- A scale operator calling a task ID assigned to another scaler receives `403`; cover Task 2.
- A Design Leader cannot upload scale output merely because it has `DESIGN:REVIEW`; cover Task 2.
- A Scale Leader can assign `csAssigneeId` but cannot pass QC without `PRODUCTION:QC_REVIEW`; cover Task 3.
- A direct global `PRODUCTION:WRITE` operator retains current emergency/operations behavior; cover Task 2.
- Existing Sales own/team isolation cannot be bypassed through a Production read endpoint; cover Task 4.

---

### Task 1: Add the least-privilege role and permission policy

**Files:**
- Modify: `src/modules/auth/constants/auth.constants.js`
- Modify: `src/modules/auth/scripts/seedRbac.js`
- Create: `src/modules/auth/scripts/migrateProductionScaleAssignments.js`
- Modify: `tests/auth/scripts/seedRbac.test.js`
- Create: `tests/auth/scripts/migrateProductionScaleAssignments.test.js`

**Interfaces:**
- Produces role codes `SCALE_OPERATOR` and `SCALE_LEADER`.
- Produces permission codes `PRODUCTION:SCALE_WORK`, `PRODUCTION:SCALE_ASSIGN`, and `PRODUCTION:QC_REVIEW`.
- Produces `migrateProductionScaleAssignments({ apply })`, a dry-run-first, idempotent role-assignment migration.

- [ ] **Step 1: Write failing role-policy tests**

Assert `SCALE_OPERATOR` has `PRODUCTION:READ` and `PRODUCTION:SCALE_WORK` only; `SCALE_LEADER` additionally has `PRODUCTION:SCALE_ASSIGN`; `QC_REVIEWER` has `PRODUCTION:QC_REVIEW`; neither ordinary role has `PRODUCTION:WRITE`.

- [ ] **Step 2: Write failing migration-plan tests**

Create active Scale/CS-team member and leader fixtures plus an unrelated `CS_OPERATOR`; assert the plan creates/reuses only the explicit Scale-team assignments and leaves unrelated Sales roles untouched.

- [ ] **Step 3: Run focused tests to verify failure**

Run: `npx jest tests/auth/scripts/seedRbac.test.js tests/auth/scripts/migrateProductionScaleAssignments.test.js --runInBand`

Expected: FAIL because the roles, permissions and migration do not yet exist.

- [ ] **Step 4: Implement the role policy and migration**

Extend the existing auth constants and RBAC seed map. Implement the migration using Auth and Organization public data, `AccessAssignment`, and permission-cache invalidation. Require an explicit current team code/role target in the script configuration; do not infer every `CS_OPERATOR` as a scale worker.

- [ ] **Step 5: Re-run the focused tests**

Run the Step 3 command.

Expected: PASS.

- [ ] **Step 6: Commit the policy slice**

```bash
git add src/modules/auth/constants/auth.constants.js src/modules/auth/scripts/seedRbac.js src/modules/auth/scripts/migrateProductionScaleAssignments.js tests/auth/scripts/seedRbac.test.js tests/auth/scripts/migrateProductionScaleAssignments.test.js
git commit -m "feat(auth): separate production scale permissions"
```

### Task 2: Enforce scale-worker ownership in Production

**Files:**
- Modify: `src/modules/production/constants/production.constants.js`
- Modify: `src/modules/production/routes/index.js`
- Modify: `src/modules/production/services/productionTask.service.js`
- Modify: `src/modules/production/dtos/productionTask.dto.js`
- Modify: `tests/production/services/productionTask.service.test.js`
- Modify: `tests/production/routes/index.test.js`
- Modify: `tests/production/dtos/productionTask.dto.test.js`

**Interfaces:**
- `productionPermissions` exports `SCALE_WORK`, `SCALE_ASSIGN`, and `QC_REVIEW`.
- `assertCanScaleTask(task, authContext)` permits `PRODUCTION:WRITE` or the assigned `csAssigneeId` holder with `PRODUCTION:SCALE_WORK`.
- Scale uploads set `fileChecks[].outputWorkerId` to the authenticated scale worker, not `assignedDesignUserId`.

- [ ] **Step 1: Write failing service tests for scale ownership**

Test an assigned scale operator can upload and submit for QC; another scale operator and a Design Leader receive `403`; a `PRODUCTION:WRITE` operator remains allowed.

- [ ] **Step 2: Write failing route/DTO tests**

Assert scale upload and submit routes require `PRODUCTION:SCALE_WORK` or the privileged fallback, and that the output-worker DTO identifies the CS scale worker.

- [ ] **Step 3: Run focused tests to verify failure**

Run: `npx jest tests/production/services/productionTask.service.test.js tests/production/routes/index.test.js tests/production/dtos/productionTask.dto.test.js --runInBand`

Expected: FAIL because Scale currently accepts `DESIGN:WORK` and uses `assignedDesignUserId`.

- [ ] **Step 4: Implement the narrow scale guard**

Replace `DESIGN:WORK` as a scale authorization path with `PRODUCTION:SCALE_WORK`. Preserve `PRODUCTION:WRITE` as the only operational override. Use `csAssigneeId` for ownership and `authContext.accountId` for output attribution. Keep PSD-related `DesignTask` authorization unchanged.

- [ ] **Step 5: Re-run focused tests**

Run the Step 3 command.

Expected: PASS.

- [ ] **Step 6: Commit the scale ownership slice**

```bash
git add src/modules/production/constants/production.constants.js src/modules/production/routes/index.js src/modules/production/services/productionTask.service.js src/modules/production/dtos/productionTask.dto.js tests/production/services/productionTask.service.test.js tests/production/routes/index.test.js tests/production/dtos/productionTask.dto.test.js
git commit -m "feat(production): enforce scale assignee access"
```

### Task 3: Separate scale assignment and QC review

**Files:**
- Modify: `src/modules/production/routes/index.js`
- Modify: `src/modules/production/services/productionTask.service.js`
- Modify: `src/modules/production/validators/productionTask.validator.js`
- Modify: `tests/production/services/productionTask.service.test.js`
- Modify: `tests/production/routes/index.test.js`

**Interfaces:**
- `assignCsTask(taskId, payload, authContext)` requires `PRODUCTION:SCALE_ASSIGN` or `PRODUCTION:WRITE` and validates the target account has `PRODUCTION:SCALE_WORK`.
- `submitQc(taskId, payload, authContext)` requires `PRODUCTION:QC_REVIEW` or `PRODUCTION:WRITE`.

- [ ] **Step 1: Write failing assignment and QC separation tests**

Assert Scale Leader can assign/reassign only an eligible scale account; Scale Operator cannot assign; Scale Leader cannot pass/reject QC without review permission; QC Reviewer cannot assign or upload scale output.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `npx jest tests/production/services/productionTask.service.test.js tests/production/routes/index.test.js --runInBand`

Expected: FAIL because assignment and QC currently share broad `PRODUCTION:WRITE`/Design permissions.

- [ ] **Step 3: Implement assignment and QC guards**

Add exact route guards and service checks. Reuse the existing account eligibility and audit helpers; do not create another assignment table. Preserve the existing QC condition that required scale output must exist before a pass decision.

- [ ] **Step 4: Re-run focused tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Commit the delegation/QC slice**

```bash
git add src/modules/production/routes/index.js src/modules/production/services/productionTask.service.js src/modules/production/validators/productionTask.validator.js tests/production/services/productionTask.service.test.js tests/production/routes/index.test.js
git commit -m "feat(production): split scale assignment from qc"
```

### Task 4: Apply scoped queue visibility and verify the complete pipeline

**Files:**
- Modify: `src/modules/production/services/productionTask.service.js`
- Modify: `src/modules/production/repositories/productionTask.repository.js`
- Modify: `tests/production/services/productionTask.service.test.js`
- Modify: `tests/api/routePermissionMatrix.supertest.test.js`
- Modify: `tests/e2e/orderFulfillmentFlow.e2e.test.js`

**Interfaces:**
- A Scale Operator production list/detail constraint is `csAssigneeId === authContext.accountId`.
- A Scale Leader sees the scale queue but not unrelated Design queue mutations.
- The PSD approval → scale upload → QC pass path reaches `READY_TO_SEND_VENDOR` under the new permissions.

- [ ] **Step 1: Write failing read-scope and E2E tests**

Assert direct-ID and list visibility for an assigned/unassigned scale operator, Scale Leader queue visibility, Sales-user denial for production queue access, and full PSD approval through QC pass with distinct actors.

- [ ] **Step 2: Run focused tests to verify failure**

Run: `npx jest tests/production/services/productionTask.service.test.js tests/api/routePermissionMatrix.supertest.test.js tests/e2e/orderFulfillmentFlow.e2e.test.js --runInBand`

Expected: FAIL because current queue filtering is based on `assignedDesignUserId`/Design permissions.

- [ ] **Step 3: Implement read constraints and endpoint matrix changes**

Make the Production list/detail service apply `csAssigneeId` visibility for Scale Operators, preserve leader/admin access and prevent a static read permission from exposing the whole queue. Update the route-permission matrix to include the three new permissions.

- [ ] **Step 4: Re-run focused tests**

Run the Step 2 command.

Expected: PASS.

- [ ] **Step 5: Run architecture and Auth regression gates**

Run:

```bash
npm run test:architecture -- --runInBand
npm run test:auth -- --runInBand
```

Expected: PASS; report unrelated baseline failures separately.

- [ ] **Step 6: Dry-run and apply migration only after target DB confirmation**

Read the database name from `.env` without outputting the connection string. Run the new migration without `--apply`, review target account counts, then run it with `--apply`. Re-run dry-run and expect no pending changes.

- [ ] **Step 7: Commit the visibility and verification slice**

```bash
git add src/modules/production/services/productionTask.service.js src/modules/production/repositories/productionTask.repository.js tests/production/services/productionTask.service.test.js tests/api/routePermissionMatrix.supertest.test.js tests/e2e/orderFulfillmentFlow.e2e.test.js
git commit -m "feat(production): scope scale queue visibility"
```

## Self-review

- Spec coverage: Tasks 1-4 cover roles/permissions, assignment ownership, QC separation, scoped reads, audit-preserving service changes, migration and pipeline verification.
- Step clarity: each implementation step names the exact module boundary and the test that proves it.
- Type consistency: `csAssigneeId` is the sole scale-worker identity; new permission names are shared by constants, routes, service guards, seeds and tests.
- Review focus coverage: Task 2 covers cross-assignee and privileged behavior; Task 3 covers Design Leader and QC separation; Task 4 covers Sales endpoint isolation.
- Proportion: no new module or persistence model is planned; changes stay within Auth and Production boundaries.
