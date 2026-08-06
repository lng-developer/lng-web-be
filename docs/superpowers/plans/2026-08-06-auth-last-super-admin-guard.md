# Last Super Admin Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prevent Auth administration from removing the final active account with an active global `SUPER_ADMIN` assignment.

**Architecture:** Add one repository lookup for an eligible surviving Super Admin and one service invariant helper. The helper runs inside existing transactions and touches the `SUPER_ADMIN` role before checking survivors, serializing concurrent destructive mutations without a new lock model.

**Tech Stack:** Node.js, CommonJS, MongoDB/Mongoose transactions, Jest.

## Global Constraints

- Preserve at least one active account with an active global `SUPER_ADMIN` assignment.
- Return HTTP `409`, `CONFLICT_ERROR`, and `At least one active SUPER_ADMIN account is required`.
- Keep controllers, validators, DTOs, routes, models, and public ports unchanged.
- Do not add a collection, dependency, configuration flag, or approval workflow.
- Use repository methods for MongoDB queries and `.lean()` for read-only Mongoose queries.

---

### Task 1: Eligible Super Admin survivor lookup

**Files:**
- Modify: `src/modules/auth/repositories/accessAssignment.repository.js`
- Test: `src/test/auth/repositories/accessAssignment.repository.test.js`

**Interfaces:**
- Produces: `hasOtherActiveGlobalRoleAccount(roleId, excludedAccountId, { session } = {}) -> Promise<boolean>`.
- Eligibility: active assignment, `scopeType: global`, `scopeId: null`, matching role, different account, and joined account status `active`.

- [ ] **Step 1: Write the failing repository test**

Add a test that mocks the Mongoose aggregation chain, calls:

```js
await repository.hasOtherActiveGlobalRoleAccount(roleId, accountId, { session });
```

and asserts the pipeline filters the role/global/active assignment, excludes `accountId`, joins the accounts collection, requires active account status, limits to one result, and returns `true` only when a survivor exists.

- [ ] **Step 2: Run the repository test and verify RED**

Run:

```powershell
npx jest src/test/auth/repositories/accessAssignment.repository.test.js --runInBand
```

Expected: FAIL because `hasOtherActiveGlobalRoleAccount` is not exported.

- [ ] **Step 3: Implement the minimal repository method**

Use `AccessAssignment.aggregate([...]).session(session)` with `$match`, `$lookup`, a second `$match`, `$limit: 1`, then return `results.length > 0`. Export the method.

- [ ] **Step 4: Run the repository test and verify GREEN**

Run the command from Step 2. Expected: PASS.

### Task 2: Shared last-Super-Admin invariant

**Files:**
- Modify: `src/modules/auth/services/authAdmin.service.js`
- Test: `src/test/auth/services/authAdmin.service.test.js`

**Interfaces:**
- Consumes: `hasOtherActiveGlobalRoleAccount(roleId, excludedAccountId, { session })`.
- Produces internal helper:

```js
async function assertCanRemoveGlobalSuperAdmin(accountId, session)
```

- [ ] **Step 1: Write failing service tests for account mutations**

Add focused tests proving `updateAccountStatus(accountId, INACTIVE)` and `archiveAccount(accountId)` reject with:

```js
{ statusCode: 409, code: 'CONFLICT_ERROR', message: 'At least one active SUPER_ADMIN account is required' }
```

when the target has an active global `SUPER_ADMIN` assignment and no survivor exists. Add a passing case when a survivor exists and a no-op case that does not invoke the guard.

- [ ] **Step 2: Write failing service tests for assignment/access mutations**

Cover `updateAccountAccess`, `updateAccessAssignment`, and `deactivateAccessAssignment` when they remove or move the target's active global `SUPER_ADMIN` assignment. Assert unrelated roles and mutations preserving the assignment do not call the survivor lookup.

- [ ] **Step 3: Run the focused tests and verify RED**

Run:

```powershell
npx jest src/test/auth/services/authAdmin.service.test.js --runInBand
```

Expected: new tests FAIL because destructive mutations currently proceed.

- [ ] **Step 4: Implement the invariant helper**

Inside the existing transaction:

1. Load `SUPER_ADMIN` by code.
2. Touch its role document with the same session to serialize competing mutations.
3. Determine whether the target currently has effective active global Super Admin access.
4. If it does, call `hasOtherActiveGlobalRoleAccount`.
5. Throw the stable conflict when no survivor exists.

Call the helper only before a mutation that actually removes effective access. Preserve existing no-op behavior and audit events.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run the command from Step 3. Expected: PASS.

### Task 3: Module verification and delivery

**Files:**
- Verify only; no new production files.

**Interfaces:**
- Confirms the invariant does not change public HTTP shapes except the new conflict response.

- [ ] **Step 1: Run syntax and diff checks**

```powershell
node -c src/modules/auth/repositories/accessAssignment.repository.js
node -c src/modules/auth/services/authAdmin.service.js
git diff --check
```

- [ ] **Step 2: Run the complete Auth suite**

```powershell
npm run test:auth -- --runInBand
```

Expected: all non-DB Auth tests pass; the explicitly gated demo DB suite remains skipped unless its fixtures exist.

- [ ] **Step 3: Run architecture verification**

```powershell
npm run test:architecture -- --runInBand
```

Expected: PASS.

- [ ] **Step 4: Review and commit implementation**

```powershell
git diff --stat
git diff
git add src/modules/auth/repositories/accessAssignment.repository.js src/modules/auth/services/authAdmin.service.js src/test/auth/repositories/accessAssignment.repository.test.js src/test/auth/services/authAdmin.service.test.js
git commit -m "fix(auth): preserve last super admin"
```
