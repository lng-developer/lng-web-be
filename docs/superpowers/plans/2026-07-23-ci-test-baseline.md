# CI and Test Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Jest discovery deterministic and restore a green architecture, E2E, and full-suite baseline without changing production behavior.

**Architecture:** Keep Jest configuration in `package.json`, where the repository already owns its scripts and has no separate Jest config. Repair the E2E repository mock to match the production repository contract; do not weaken production guards.

**Tech Stack:** Node.js CommonJS, Jest 30.

## Global Constraints

- Do not change files below `src/modules/`.
- Do not add dependencies or skip failing tests.
- Ignore only directories named `.worktrees`.
- Run commands from the repository root.

---

### Task 1: Exclude Local Worktrees from Jest Discovery

**Files:**
- Modify: `package.json`
- Test: Jest discovery from the repository root

**Interfaces:**
- Consumes: Jest `testPathIgnorePatterns`.
- Produces: deterministic discovery excluding `<rootDir>/.worktrees/`.

- [ ] **Step 1: Prove duplicate discovery**

Run: `npm test -- src/test/e2e --runInBand --listTests`

Expected before the fix: output includes a path containing `/.worktrees/` when a local worktree exists.

- [ ] **Step 2: Add the smallest Jest configuration**

Add this top-level property after `devDependencies`:

```json
"jest": {
  "testPathIgnorePatterns": [
    "/node_modules/",
    "<rootDir>/.worktrees/"
  ]
}
```

- [ ] **Step 3: Verify discovery**

Run: `npm test -- src/test/e2e --runInBand --listTests`

Expected: only `src/test/e2e/financeImportSnapshotFlow.e2e.test.js` and `src/test/e2e/orderFulfillmentFlow.e2e.test.js` from the primary checkout.

- [ ] **Step 4: Commit**

```powershell
git add package.json
git commit -m "test(jest): ignore repository worktrees"
```

### Task 2: Restore the Production Repository E2E Contract

**Files:**
- Modify: `src/test/e2e/orderFulfillmentFlow.e2e.test.js`

**Interfaces:**
- Consumes: `productionTaskRepository.updateScaledOutputIfMutable(taskId, patch)`.
- Produces: a stateful mock that returns an updated task before QC lock and `null` after lock.

- [ ] **Step 1: Run the focused test**

Run: `npm test -- src/test/e2e/orderFulfillmentFlow.e2e.test.js --runInBand`

Expected: FAIL with `repository.updateScaledOutputIfMutable is not a function`.

- [ ] **Step 2: Add the missing mock function**

Add the function to the production repository mock:

```js
updateScaledOutputIfMutable: jest.fn(),
```

In the test setup, bind it to the in-memory task:

```js
productionTaskRepository.updateScaledOutputIfMutable.mockImplementation(async (_taskId, patch) => {
  if (!productionTask || productionTask.status === 'QC_PASSED') return null;
  productionTask = { ...productionTask, ...patch };
  return productionTask;
});
```

Use the existing in-memory task variable name if it differs; do not introduce a second task store.

- [ ] **Step 3: Cover the immutable result**

Add a focused assertion to the existing scaled-output scenario:

```js
productionTask.status = 'QC_PASSED';
await expect(
  productionTaskRepository.updateScaledOutputIfMutable(productionTask.id, { scaledOutputAssetId: 'asset-2' }),
).resolves.toBeNull();
```

- [ ] **Step 4: Verify focused E2E**

Run: `npm test -- src/test/e2e/orderFulfillmentFlow.e2e.test.js --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/test/e2e/orderFulfillmentFlow.e2e.test.js
git commit -m "test(production): restore scaled output E2E mock"
```

### Task 3: Establish the Green Baseline

**Files:**
- No file changes expected.

**Interfaces:**
- Consumes: repository test scripts.
- Produces: a recorded green verification result in the implementation handoff.

- [ ] **Step 1: Run architecture checks**

Run: `npm run test:architecture -- --runInBand`

Expected: PASS.

- [ ] **Step 2: Run E2E checks**

Run: `npm test -- src/test/e2e --runInBand`

Expected: 2 suites PASS and no `.worktrees` path in output.

- [ ] **Step 3: Run the full suite**

Run: `npm test -- --runInBand`

Expected: all suites PASS.

- [ ] **Step 4: Check final scope**

Run: `git diff origin/develop...HEAD --check`

Expected: no whitespace errors; production module files are absent from the diff.
