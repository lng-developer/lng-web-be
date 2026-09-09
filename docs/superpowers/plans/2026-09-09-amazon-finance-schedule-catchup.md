# Amazon Finance Schedule Catch-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Catch up Amazon Transactions in seven-day daily batches and skip completed Settlement statements before an Amazon download.

**Architecture:** BE owns the daily cadence and Transaction checkpoint. The Extension discovers a closed Amazon statement reference ID, asks BE if the shop has completed that source, then runs the existing guarded download only when needed. FinanceImportBatch remains the persistent idempotency evidence; no new model is introduced.

**Tech Stack:** Node.js, Express, Mongoose, Jest, Chrome Extension MV3, native node:test, React, Ant Design, Vitest.

**Spec:** docs/superpowers/specs/2026-09-09-amazon-finance-schedule-catchup-design.md

## Global Constraints

- Transaction schedules remain fixed at 1440 minutes and cover at most seven UTC dates per command.
- Queue at most one command per agent per daily cadence; never add an in-day catch-up loop.
- Settlement identity is `settlements-{referenceId}.txt`; derive shop only from the Extension token.
- The completed check returns only `{ completed: boolean }`.
- Preserve locks, offline retry, cooldown, trusted Amazon URL validation, import validation, and idempotency.
- Do not add dependencies, models, or user-configurable schedule settings.

---

## File Structure

- BE scheduler: src/modules/integration/extensionCommand/services/extensionCommand.service.js
- BE settlement lookup: src/modules/finance/repositories/financeImport.repository.js, services/financeImport.service.js, validators/financeSnapshot.validator.js, controllers/financeImport.controller.js, routes/index.js
- Extension guard: background.js
- FE policy copy: src/features/portal/integrations/components/ExtensionAutomationTab.tsx

### Task 1: Batch Transaction catch-up in the BE scheduler

**Files:**
- Modify: src/modules/integration/extensionCommand/services/extensionCommand.service.js:45-60
- Modify: src/modules/integration/extensionCommand/__tests__/extensionOrderSchedule.service.test.js:84-127

**Interfaces:**
- Consumes: schedule.lastSuccessfulDate and now.
- Produces: transactionWindow(schedule, now) returning inclusive dateFrom/dateTo spanning one to seven dates and ending no later than yesterday UTC.

- [ ] **Step 1: Write failing cases**

Change the current one-day expectation to:
```js
expect(repository.createCommand).toHaveBeenCalledWith(expect.objectContaining({
  type: 'IMPORT_TRANSACTIONS',
  dateFrom: '2026-09-01',
  dateTo: '2026-09-07',
}));
```
Add a six-day range ending yesterday and a no-checkpoint schedule that imports only yesterday.

- [ ] **Step 2: Verify RED**

Run:
```powershell
npm test -- --runInBand src/modules/integration/extensionCommand/__tests__/extensionOrderSchedule.service.test.js
```
Expected: old scheduler still ends its command on dateFrom.

- [ ] **Step 3: Implement the bounded window**

Use:
```js
const TRANSACTION_CATCH_UP_DAYS = 7;
const dateFrom = schedule.lastSuccessfulDate ? addUtcDays(schedule.lastSuccessfulDate, 1) : previousDay;
const maxDateTo = addUtcDays(dateFrom, TRANSACTION_CATCH_UP_DAYS - 1);
return { dateFrom, dateTo: maxDateTo < previousDay ? maxDateTo : previousDay };
```
Keep completeCommand advancing lastSuccessfulDate from command.dateTo only after success.

- [ ] **Step 4: Verify GREEN**

Run:
```powershell
npm test -- --runInBand src/modules/integration/extensionCommand/__tests__/extensionOrderSchedule.service.test.js src/modules/integration/extensionCommand/__tests__/extensionCommand.service.test.js
```

- [ ] **Step 5: Commit**

```powershell
git add src/modules/integration/extensionCommand
git commit -m "feat(finance): batch scheduled transaction catch-up"
```

### Task 2: Add a shop-scoped completed Settlement lookup

**Files:**
- Modify: src/modules/finance/repositories/financeImport.repository.js
- Modify: src/modules/finance/services/financeImport.service.js
- Modify: src/modules/finance/validators/financeSnapshot.validator.js
- Modify: src/modules/finance/controllers/financeImport.controller.js
- Modify: src/modules/finance/routes/index.js
- Create: src/modules/finance/__tests__/financeImport.service.test.js
- Create: src/modules/finance/__tests__/financeImport.controller.test.js

**Interfaces:**
- Consumes: GET /api/finance/imports/settlements/:referenceId/completed under an Extension bearer token.
- Produces: { completed: boolean }, keyed by authenticated shop, SETTLEMENTS, and sourceRef settlements-{referenceId}.txt.

- [ ] **Step 1: Write failing service tests**

Mock repository.findCompletedSettlementImport and test:
```js
await expect(service.hasCompletedSettlementImport('27554249931', extensionAuth))
  .resolves.toEqual({ completed: true });
expect(repository.findCompletedSettlementImport).toHaveBeenCalledWith({
  shopId: '507f1f77bcf86cd799439011',
  referenceId: '27554249931',
});
```
Also test a no-scope token is forbidden and an uncompleted import returns false.

- [ ] **Step 2: Verify RED**

Run:
```powershell
npm test -- --runInBand src/modules/finance/__tests__/financeImport.service.test.js
```
Expected: method and repository lookup do not exist.

- [ ] **Step 3: Implement the narrow contract**

Repository query:
```js
return FinanceImportBatch.findOne({
  shopId,
  sourceType: 'SETTLEMENTS',
  sourceRef: `settlements-${referenceId}.txt`,
  status: 'COMPLETED',
}).lean();
```
Validate referenceId with `Joi.string().trim().pattern(/^\d+$/).max(80)`. Service derives Extension shop scope and returns only the boolean. Controller and route expose it after authenticate + requireWrite.

- [ ] **Step 4: Verify GREEN**

Run:

```powershell
npm test -- --runInBand src/modules/finance/__tests__/financeImport.service.test.js src/modules/finance/__tests__/financeImport.controller.test.js
```

The controller test calls `hasCompletedSettlementImport` with `req.auth` and asserts the exact 200 response; the service test asserts cross-shop source references cannot report true.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/finance
git commit -m "feat(finance): guard completed settlement downloads"
```

### Task 3: Guard the Extension before a Settlement download

**Files:**
- Modify: C:/lng_system/lng-web/_worktrees/Amazon-Extension-finance-sync-config/background.js:1369-1435
- Modify: C:/lng_system/lng-web/_worktrees/Amazon-Extension-finance-sync-config/tests/amazon-settlement.test.mjs
- Modify: C:/lng_system/lng-web/_worktrees/Amazon-Extension-finance-sync-config/tests/extension-contract.test.mjs

**Interfaces:**
- Consumes: discovered { referenceId, dateFrom, dateTo } and BE completed result.
- Produces: { ok: true, skipped: true, reason: 'SETTLEMENT_ALREADY_IMPORTED', referenceId } without downloading or uploading.

- [ ] **Step 1: Write failing Extension test**

Add an injectable decision helper to amazonSettlement.js:
```js
assert.deepEqual(
  settlementImportDecision({ completed: true, referenceId: '27554249931' }),
  { ok: true, skipped: true, reason: 'SETTLEMENT_ALREADY_IMPORTED', referenceId: '27554249931' },
);
```
Add an integration assertion that the completed branch never invokes fetchSettlementsTxtFromAmazon.

- [ ] **Step 2: Verify RED**

Run:
```powershell
node --test tests/amazon-settlement.test.mjs tests/extension-contract.test.mjs
```

- [ ] **Step 3: Implement the pre-download call**

After auto-discovery, call:
```js
const response = await getJson(
  `${deriveApiUrls(ingestUrl).base}/api/finance/imports/settlements/${encodeURIComponent(referenceId)}/completed`,
  ingestToken,
);
```
When response.data.completed is true, log the visible skip and return it. On a failed check, throw and do not download. Otherwise retain local history, cooldown, trusted URL, validation, SHA-256, and upload behavior unchanged.

- [ ] **Step 4: Verify GREEN**

Run:
```powershell
node --test tests/amazon-settlement.test.mjs tests/extension-contract.test.mjs tests/extension-command-client.test.mjs
```

- [ ] **Step 5: Commit**

```powershell
git add background.js amazonSettlement.js tests
git commit -m "feat(settlement): skip completed statement downloads"
```

### Task 4: State the fixed policy in the Automation UI

**Files:**
- Modify: C:/lng_system/lng-web/lng-web-fe/.worktrees/EC-finance-sync-config/src/features/portal/integrations/components/ExtensionAutomationTab.tsx
- Modify: C:/lng_system/lng-web/lng-web-fe/.worktrees/EC-finance-sync-config/src/test/portal/integrations/pages/IntegrationWorkbenchPage.test.tsx

**Interfaces:**
- Consumes: existing source, enabled, nextRunAt.
- Produces: Transaction copy Daily · Up to 7 days per run and Settlement copy Daily · Newly closed statements only.

- [ ] **Step 1: Write failing UI assertion**

```tsx
expect(within(agentCard).getByText('Daily · Up to 7 days per run')).toBeVisible();
expect(within(agentCard).getByText('Daily · Newly closed statements only')).toBeVisible();
```

- [ ] **Step 2: Verify RED**

Run:
```powershell
npx vitest run --project ui --maxWorkers=1 src/test/portal/integrations/pages/IntegrationWorkbenchPage.test.tsx -t "finance schedule safeguards"
```

- [ ] **Step 3: Implement copy only**

Branch on the existing source in renderFinanceSchedule. Disabled stays Not scheduled; enabled retains its next-run timestamp after the new policy label. Preserve all existing action labels and callbacks.

- [ ] **Step 4: Verify GREEN**

Run:
```powershell
npx vitest run --project ui --maxWorkers=1 src/test/portal/integrations/pages/IntegrationWorkbenchPage.test.tsx -t "finance schedule safeguards|enables daily settlement|requests an enabled settlement|shows the three schedules"
```

- [ ] **Step 5: Commit**

```powershell
git add src/features/portal/integrations/components/ExtensionAutomationTab.tsx src/test/portal/integrations/pages/IntegrationWorkbenchPage.test.tsx
git commit -m "feat(finance): explain scheduled import safeguards"
```

### Task 5: Cross-project verification

**Files:** Verify only.

- [ ] **Step 1: Run BE focused suites**

Run the extension-command suites from Task 1 and finance-import suite from Task 2. Then run the repository's documented lint/test command for affected modules.

- [ ] **Step 2: Run Extension suites**

```powershell
node --test tests/amazon-settlement.test.mjs tests/extension-contract.test.mjs tests/extension-command-client.test.mjs
```

- [ ] **Step 3: Run FE checks**

```powershell
npx eslint src/features/portal/integrations/components/ExtensionAutomationTab.tsx src/test/portal/integrations/pages/IntegrationWorkbenchPage.test.tsx
npm run typecheck
npx vitest run --project ui --maxWorkers=1 src/test/portal/integrations/pages/IntegrationWorkbenchPage.test.tsx
```

- [ ] **Step 4: Verify local runtime and worktrees**

Confirm GET http://127.0.0.1:5000/health and GET http://127.0.0.1:5173/api/finance/health return 200. Inspect Automation copy in the existing Vite UI. Check git status --short in BE, Extension, and FE worktrees; report commit hashes and do not push or open a PR without an explicit request.

## Self-review

- Task 1 covers seven-day daily Transaction catch-up and success-only checkpoints.
- Tasks 2-3 cover shop-scoped, persisted Settlement reference checks before Amazon download.
- Task 4 covers user-visible policy, and Task 5 covers all test and runtime evidence.
- No new dependency, model, schedule input, or retry loop is planned.
