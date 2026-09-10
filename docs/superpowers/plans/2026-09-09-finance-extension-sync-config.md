# Finance Extension Sync Configuration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Finance operators enable safe daily Amazon Transaction and Settlement imports through the existing extension-command lifecycle.

**Architecture:** Add a small Finance schedule model inside `integration/extensionCommand`; it creates the same leased, agent-locked commands already used by Orders. The extension receives the two new command types, opens Amazon All Statements only when needed for Settlement, and returns the existing finance-import batch result. The Integration Automation screen controls the two sources per agent.

**Tech Stack:** Node.js, Express, Mongoose, Joi, Jest, React, TanStack Query, Ant Design, Chrome MV3 APIs, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-09-finance-extension-sync-config-design.md`

## Global Constraints

- Keep manual Transaction and Settlement import intact for backfill and recovery.
- Finance schedules are source-scoped (`TRANSACTIONS`, `SETTLEMENTS`) and fixed at one run per 24 hours.
- Reuse extension leases, command status, and the existing agent-wide `activeOrderKey`; no parallel Amazon task may run for one agent.
- The backend never handles Amazon cookies or credentials.
- Settlement imports reuse a matching All Statements tab, otherwise create exactly one background tab, skip `Present`, and download at most one closed statement per command.
- A missing sign-in, unavailable page, cooldown, or missing download link completes one command with an actionable error; it must not produce an extension retry loop.
- Base extension changes on `EC/extension-command-phase-1`, because that is where the manual Finance handlers live.

---

### Task 1: Persist Finance schedules and validate Finance command types

**Files:**
- Create: `lng-web-be/src/modules/integration/extensionCommand/models/extensionFinanceSchedule.model.js`
- Modify: `lng-web-be/src/modules/integration/extensionCommand/constants/extensionCommand.constants.js`
- Modify: `lng-web-be/src/modules/integration/extensionCommand/models/extensionCommand.model.js`
- Modify: `lng-web-be/src/modules/integration/extensionCommand/repositories/extensionCommand.repository.js`
- Modify: `lng-web-be/src/modules/integration/extensionCommand/validators/extensionCommand.validator.js`
- Modify: `lng-web-be/src/modules/integration/extensionCommand/__tests__/extensionCommand.validator.test.js`

**Interfaces:**
- Produces `extensionCommandTypes.IMPORT_TRANSACTIONS` and `extensionCommandTypes.IMPORT_SETTLEMENTS`.
- Produces Finance schedule repository operations keyed by `{ agentId, source }`.
- `ExtensionFinanceSchedule` fields are `shopId`, `agentId`, `source`, `enabled`, `intervalMinutes: 1440`, `nextRunAt`, `lastQueuedAt`, `lastCompletedAt`, `lastSuccessfulDate`, and `lastError`.

- [ ] **Step 1: Write failing validation tests for the new command types and fixed daily schedule input**

```js
const { createCommandSchema, upsertFinanceScheduleSchema, validate } = require('../validators/extensionCommand.validator');

test('accepts dated transactions and date-free settlement commands', () => {
  const base = { shopId: '507f1f77bcf86cd799439011', agentId: '507f1f77bcf86cd799439012' };
  expect(validate(createCommandSchema, {
    ...base, type: 'IMPORT_TRANSACTIONS', dateFrom: '2026-09-08', dateTo: '2026-09-08',
  }).details).toBeUndefined();
  expect(validate(createCommandSchema, { ...base, type: 'IMPORT_SETTLEMENTS' }).details).toBeUndefined();
  expect(validate(upsertFinanceScheduleSchema, { enabled: true }).value).toEqual({ enabled: true });
});
```

- [ ] **Step 2: Run the validator test and verify RED**

Run: `npx jest --runInBand src/modules/integration/extensionCommand/__tests__/extensionCommand.validator.test.js`

Expected: FAIL because neither Finance command type nor `upsertFinanceScheduleSchema` exists.

- [ ] **Step 3: Add the minimal model, enum values, repository methods, and Joi schemas**

```js
const financeScheduleSources = Object.freeze({ TRANSACTIONS: 'TRANSACTIONS', SETTLEMENTS: 'SETTLEMENTS' });
const extensionFinanceScheduleSchema = new mongoose.Schema({
  shopId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  agentId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
  source: { type: String, enum: Object.values(financeScheduleSources), required: true },
  enabled: { type: Boolean, default: false, index: true },
  intervalMinutes: { type: Number, default: 1440, immutable: true },
  nextRunAt: { type: Date, required: true, index: true },
  lastQueuedAt: { type: Date, default: null }, lastCompletedAt: { type: Date, default: null },
  lastSuccessfulDate: { type: String, default: null }, lastError: { type: String, default: null, maxlength: 1000 },
}, { timestamps: true });
extensionFinanceScheduleSchema.index({ agentId: 1, source: 1 }, { unique: true });
const upsertFinanceScheduleSchema = Joi.object({ enabled: Joi.boolean().required() });
```

Keep `dateFrom`/`dateTo` required only for `IMPORT_TRANSACTIONS`; Settlement commands must not require synthetic period dates.

- [ ] **Step 4: Run the validator test and verify GREEN**

Run: `npx jest --runInBand src/modules/integration/extensionCommand/__tests__/extensionCommand.validator.test.js`

Expected: PASS.

- [ ] **Step 5: Commit the backend persistence checkpoint**

```bash
git add src/modules/integration/extensionCommand
git commit -m "feat(finance): add extension sync schedule persistence"
```

### Task 2: Queue and checkpoint safe daily Finance commands

**Files:**
- Modify: `lng-web-be/src/modules/integration/extensionCommand/services/extensionCommand.service.js`
- Modify: `lng-web-be/src/modules/integration/extensionCommand/repositories/extensionCommand.repository.js`
- Modify: `lng-web-be/src/modules/integration/extensionCommand/services/extensionOrderScheduleScheduler.service.js`
- Modify: `lng-web-be/src/modules/integration/extensionCommand/__tests__/extensionOrderSchedule.service.test.js`
- Modify: `lng-web-be/src/modules/integration/extensionCommand/__tests__/extensionCommand.service.test.js`

**Interfaces:**
- Produces `dispatchDueFinanceSchedules(now)`, `listFinanceSchedules(auth)`, and `upsertFinanceSchedule(agentId, source, input, auth)`.
- `completeCommand` updates a Finance schedule only after a successfully completed matching command.

- [ ] **Step 1: Write failing service tests for queueing, deferral, and checkpoint behavior**

```js
test('queues the next uncompleted UTC transaction day with the agent lock', async () => {
  const now = new Date('2026-09-09T12:00:00.000Z');
  repository.listDueFinanceSchedules.mockResolvedValue([{
    _id: 'schedule-1', source: 'TRANSACTIONS', shopId: 'shop-1', agentId: 'agent-1',
    lastSuccessfulDate: '2026-09-07', intervalMinutes: 1440,
  }]);
  repository.claimDueFinanceSchedule.mockResolvedValue(true);
  repository.findAgentById.mockResolvedValue({ _id: 'agent-1', lastSeenAt: now });
  repository.hasActiveImportCommand.mockResolvedValue(false);

  await service.dispatchDueFinanceSchedules(now);

  expect(repository.createCommand).toHaveBeenCalledWith(expect.objectContaining({
    type: 'IMPORT_TRANSACTIONS', dateFrom: '2026-09-08', dateTo: '2026-09-08', activeOrderKey: 'agent-1',
  }));
});

test('does not advance a transaction watermark when its command fails', async () => {
  const extensionAuth = { tokenType: 'EXTENSION', extensionTokenId: 'token-1' };
  repository.updateClaimed.mockResolvedValue({ _id: 'command-1', type: 'IMPORT_TRANSACTIONS', agentId: 'agent-1', dateTo: '2026-09-08' });

  await service.completeCommand('command-1', { leaseToken: 'x'.repeat(20), success: false }, extensionAuth);

  expect(repository.markFinanceScheduleCompleted).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the service tests and verify RED**

Run: `npx jest --runInBand src/modules/integration/extensionCommand/__tests__/extensionOrderSchedule.service.test.js src/modules/integration/extensionCommand/__tests__/extensionCommand.service.test.js`

Expected: FAIL because Finance schedule dispatch and completion checkpointing do not exist.

- [ ] **Step 3: Implement dispatch through the existing command lock**

```js
async function dispatchDueFinanceSchedules(now = new Date()) {
  for (const schedule of await repository.listDueFinanceSchedules(now)) {
    if (!await repository.claimDueFinanceSchedule(schedule._id, now)) continue;
    const agent = await repository.findAgentById(schedule.agentId);
    if (!isOnline(agent, now) || await repository.hasActiveImportCommand(schedule.agentId)) {
      await repository.postponeFinanceSchedule(schedule._id, now, !isOnline(agent, now) ? 'AGENT_OFFLINE' : 'ACTIVE_IMPORT_COMMAND');
      continue;
    }
    const payload = schedule.source === 'TRANSACTIONS'
      ? { type: extensionCommandTypes.IMPORT_TRANSACTIONS, ...transactionWindow(schedule, now) }
      : { type: extensionCommandTypes.IMPORT_SETTLEMENTS };
    await createLockedImportCommand({ ...payload, shopId: schedule.shopId, agentId: schedule.agentId, createdByAccountId: null });
    await repository.markFinanceScheduleQueued(schedule._id, now);
  }
}
```

`transactionWindow` advances one completed UTC day after `lastSuccessfulDate`; on first run it returns the prior UTC day. Cap a future watermark at the prior completed UTC day. `completeCommand` records `lastCompletedAt`/`lastError` for both sources and sets `lastSuccessfulDate` only for successful Transaction commands.

- [ ] **Step 4: Start Finance dispatch from the existing one-minute scheduler and verify GREEN**

```js
function runOnce() {
  return Promise.all([
    service.dispatchDueOrderSchedules(),
    service.dispatchDueFinanceSchedules(),
  ]).catch((error) => logger.error('extension_schedule_dispatch_failed', { error }));
}
```

Run: `npx jest --runInBand src/modules/integration/extensionCommand/__tests__/extensionOrderSchedule.service.test.js src/modules/integration/extensionCommand/__tests__/extensionCommand.service.test.js`

Expected: PASS, including offline and active-command deferral.

- [ ] **Step 5: Commit the backend scheduler checkpoint**

```bash
git add src/modules/integration/extensionCommand
git commit -m "feat(finance): schedule extension imports daily"
```

### Task 3: Expose scoped Finance schedule configuration and history

**Files:**
- Modify: `lng-web-be/src/modules/integration/extensionCommand/controllers/extensionCommand.controller.js`
- Modify: `lng-web-be/src/modules/integration/extensionCommand/dtos/extensionCommand.dto.js`
- Modify: `lng-web-be/src/modules/integration/extensionCommand/routes/extensionCommand.routes.js`
- Modify: `lng-web-be/src/modules/integration/extensionCommand/services/extensionCommand.service.js`
- Modify: `lng-web-be/src/modules/integration/extensionCommand/__tests__/extensionCommand.service.test.js`

**Interfaces:**
- Produces `GET /api/integration/extension-commands/finance-schedules`.
- Produces `PUT /api/integration/extension-commands/finance-schedules/:agentId/:source` with `{ enabled }`.
- Returns `{ id, shopId, agentId, source, enabled, intervalMinutes, nextRunAt, lastQueuedAt, lastCompletedAt, lastSuccessfulDate, lastError }`.

- [ ] **Step 1: Write failing authorization tests**

```js
test('allows a Finance operator to save only its shop settlement schedule', async () => {
  const financeAuth = { accountId: 'account-1' };
  repository.findAgentById.mockResolvedValue({ _id: 'agent-1', shopId: 'shop-1' });
  repository.upsertFinanceSchedule.mockResolvedValue({ _id: 'schedule-1', source: 'SETTLEMENTS', enabled: true });
  authPublic.canAccessScope.mockImplementation((_auth, permission) => permission === 'FINANCE:WRITE');

  await expect(service.upsertFinanceSchedule('agent-1', 'SETTLEMENTS', { enabled: true }, financeAuth)).resolves.toEqual(expect.objectContaining({ source: 'SETTLEMENTS' }));
});

test('does not expose command history to an account without Orders or Finance read permission', async () => {
  authPublic.canAccessScope.mockReturnValue(false);
  await expect(service.listCommands({ page: 1, limit: 20 }, {})).resolves.toEqual(expect.objectContaining({ items: [] }));
});
```

- [ ] **Step 2: Run the service test and verify RED**

Run: `npx jest --runInBand src/modules/integration/extensionCommand/__tests__/extensionCommand.service.test.js`

Expected: FAIL because Finance schedule APIs and Finance-aware command visibility do not exist.

- [ ] **Step 3: Add DTOs, routes, and source-aware permissions**

```js
router.get('/finance-schedules', authPublic.authenticate, financeRead, asyncHandler(controller.listFinanceSchedules));
router.put('/finance-schedules/:agentId/:source', authPublic.authenticate, financeWrite, asyncHandler(controller.upsertFinanceSchedule));

async function upsertFinanceSchedule(agentId, source, input, auth) {
  const agent = await repository.findAgentById(agentId);
  if (!agent) throw notFound('Extension agent not found');
  assertUserShopAccess(auth, agent.shopId, 'FINANCE:WRITE');
  return repository.upsertFinanceSchedule({ shopId: agent.shopId, agentId, source, enabled: input.enabled, now: new Date() });
}
```

Use an `accessibleShopIds` check that accepts either `ORDERS:READ`/`ORDERS:WRITE` or `FINANCE:READ`/`FINANCE:WRITE` before listing shared command history. Do not widen any write operation beyond its source permission.

- [ ] **Step 4: Run backend command tests and architecture checks**

Run: `npx jest --runInBand src/modules/integration/extensionCommand/__tests__/extensionCommand.validator.test.js src/modules/integration/extensionCommand/__tests__/extensionCommand.service.test.js src/modules/integration/extensionCommand/__tests__/extensionOrderSchedule.service.test.js && npm run test:architecture -- --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit the backend API checkpoint**

```bash
git add src/modules/integration/extensionCommand
git commit -m "feat(finance): expose extension sync settings"
```

### Task 4: Teach the extension to execute Finance commands and bootstrap All Statements

**Files:**
- Modify: `Amazon-Extension/extensionCommandClient.js`
- Modify: `Amazon-Extension/background.js`
- Modify: `Amazon-Extension/tests/extension-contract.test.mjs`

**Interfaces:**
- `pollExtensionCommand({ base, token, client, runImport, runAds, runTransactions, runSettlements })` accepts the two Finance handlers.
- `ensureSettlementStatementsTab()` returns one loaded All Statements tab; it reuses an existing tab or opens one background tab at `https://sellercentral.amazon.com/payments/past-settlements?ref_=xx_settle_ttab_trans`.
- `runScheduledSettlementImport()` imports one newest closed statement and never imports `Present`.

- [ ] **Step 1: Write failing extension contract tests**

```js
test('extension command polling supports transaction and settlement imports', () => {
  const client = read('extensionCommandClient.js');
  assert.match(client, /IMPORT_TRANSACTIONS/);
  assert.match(client, /IMPORT_SETTLEMENTS/);
  assert.match(client, /runTransactions/);
  assert.match(client, /runSettlements/);
});

test('settlement automation opens All Statements only when no statement tab exists', () => {
  const background = read('background.js');
  assert.match(background, /async function ensureSettlementStatementsTab/);
  assert.match(background, /chrome\.tabs\.create\(\{ url: .*past-settlements.*, active: false \}\)/);
  assert.match(background, /candidate\.url\?\.includes\('\/payments\/past-settlements'\)/);
  assert.match(background, /Present/);
});
```

- [ ] **Step 2: Run extension contracts and verify RED**

Run: `node --test tests/extension-contract.test.mjs`

Expected: FAIL because the command client rejects Finance types and no All Statements bootstrap helper exists.

- [ ] **Step 3: Add the two handlers and safe Settlement tab bootstrap**

```js
async function ensureSettlementStatementsTab() {
  const tabs = await chrome.tabs.query({ url: `${SC_BASE}/payments/*` });
  let tab = tabs.find((candidate) => candidate.url?.includes('/payments/past-settlements'));
  if (!tab) tab = await chrome.tabs.create({
    url: `${SC_BASE}/payments/past-settlements?ref_=xx_settle_ttab_trans`, active: false,
  });
  await waitForTabComplete(tab.id, 30_000);
  if (!tab.url?.includes('/payments/past-settlements')) throw new Error('SELLER_CENTRAL_AUTH_REQUIRED');
  await delayMs(750);
  return tab;
}
```

Extend `pollExtensionCommand` to route `IMPORT_TRANSACTIONS` to `runTransactions({ dateFrom, dateTo })` and `IMPORT_SETTLEMENTS` to `runSettlements()`. For the latter, enumerate visible All Statements rows through the existing shadow-DOM helper, discard rows containing `Present`, select one newest closed row not marked completed in local settlement history, then call the current `runImportSettlements` with that row's exact dates. Retain the existing reference-id idempotency key and cooldown. Use the returned finance batch's `importedCount` and `failedCount` when completing the command.

- [ ] **Step 4: Run extension contracts and verify GREEN**

Run: `node --test tests/extension-contract.test.mjs`

Expected: PASS. Confirm the diff does not add cookies, downloads, webRequest, or a background retry alarm.

- [ ] **Step 5: Commit the extension checkpoint**

```bash
git add background.js extensionCommandClient.js tests/extension-contract.test.mjs
git commit -m "feat(finance): run scheduled Amazon imports"
```

### Task 5: Add Finance controls to Integration Automation

**Files:**
- Modify: `lng-web-fe/src/features/portal/integrations/api/integrationApi.ts`
- Modify: `lng-web-fe/src/features/portal/integrations/api/integrationKeys.ts`
- Modify: `lng-web-fe/src/features/portal/integrations/hooks/useExtensionWorkbench.ts`
- Modify: `lng-web-fe/src/features/portal/integrations/components/ExtensionTabContent.tsx`
- Modify: `lng-web-fe/src/features/portal/integrations/components/ExtensionAutomationTab.tsx`
- Modify: `lng-web-fe/src/features/portal/integrations/pages/IntegrationWorkbenchContent.tsx`
- Modify: `lng-web-fe/src/test/portal/integrations/pages/IntegrationWorkbenchPage.test.tsx`

**Interfaces:**
- Produces `ExtensionFinanceSchedule` and `listExtensionFinanceSchedules()`/`upsertExtensionFinanceSchedule(agentId, source, { enabled })`.
- `useExtensionWorkbench` exposes `extensionFinanceSchedules` and `saveFinanceSchedule`.
- Finance writers can see and configure Finance source rows without receiving Order-write controls.

- [ ] **Step 1: Write a failing Integration workbench test**

```tsx
it('lets a Finance writer enable daily settlement sync for its extension agent', async () => {
  const agent = { id: 'agent-1', shopId: shop.id, label: 'RDC 01' };
  vi.mocked(listExtensionManagementAgents).mockResolvedValue({ items: [agent] });
  vi.mocked(listExtensionFinanceSchedules).mockResolvedValue({
    items: [{ id: 'finance-1', agentId: agent.id, shopId: shop.id, source: 'SETTLEMENTS', enabled: false, intervalMinutes: 1440, nextRunAt: '2026-09-10T00:00:00.000Z', lastQueuedAt: null, lastCompletedAt: null, lastSuccessfulDate: null, lastError: null }],
  });
  renderWorkbench('/portal/integrations', account(['FINANCE:WRITE']));
  fireEvent.click(await screen.findByRole('tab', { name: 'Amazon Extension' }));
  fireEvent.click(screen.getByRole('tab', { name: 'Automation' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Enable settlement sync' }));
  await waitFor(() => expect(upsertExtensionFinanceSchedule).toHaveBeenCalledWith(agent.id, 'SETTLEMENTS', { enabled: true }));
});
```

- [ ] **Step 2: Run the focused UI test and verify RED**

Run: `npx vitest run --project ui --maxWorkers=1 src/test/portal/integrations/pages/IntegrationWorkbenchPage.test.tsx --testNamePattern "settlement sync"`

Expected: FAIL because the Finance schedule API and Automation controls do not exist.

- [ ] **Step 3: Add the smallest Finance schedule UI**

```tsx
type ExtensionFinanceScheduleSource = 'TRANSACTIONS' | 'SETTLEMENTS'

export async function upsertExtensionFinanceSchedule(
  agentId: string, source: ExtensionFinanceScheduleSource, input: { enabled: boolean },
) {
  return unwrap<ExtensionFinanceSchedule>(
    await apiClient.put(`${extensionCommandPath}/finance-schedules/${agentId}/${source}`, input),
  )
}
```

Extend the existing Automation table instead of adding another page. For each agent, render Transaction and Settlement rows with `Daily`, next run, last completed time, last error, and an accessible enable/disable button. Keep Order controls as-is. Enable Finance schedule queries and mutations for Finance writers; leave Order token and Order schedule actions gated by Order permissions.

- [ ] **Step 4: Run focused UI test, typecheck, and relevant UI suite**

Run: `npx vitest run --project ui --maxWorkers=1 src/test/portal/integrations/pages/IntegrationWorkbenchPage.test.tsx --testNamePattern "settlement sync" && npm run typecheck && npm run test:ui:ci -- --shard=3/4`

Expected: PASS.

- [ ] **Step 5: Commit the FE checkpoint**

```bash
git add src/features/portal/integrations src/test/portal/integrations/pages/IntegrationWorkbenchPage.test.tsx
git commit -m "feat(finance): configure extension daily sync"
```

### Task 6: Verify the three-repository release boundary

**Files:**
- Verify only: `lng-web-be`, `lng-web-fe`, and `Amazon-Extension`

**Interfaces:**
- Consumes all prior checkpoints.
- Produces three reviewable branches; the extension branch is based on `EC/extension-command-phase-1`.

- [ ] **Step 1: Run backend verification**

Run: `npx jest --runInBand src/modules/integration/extensionCommand/__tests__/extensionCommand.validator.test.js src/modules/integration/extensionCommand/__tests__/extensionCommand.service.test.js src/modules/integration/extensionCommand/__tests__/extensionOrderSchedule.service.test.js && npm run test:architecture -- --runInBand`

Expected: PASS with no failing test suites.

- [ ] **Step 2: Run extension verification**

Run: `node --test tests/extension-contract.test.mjs`

Expected: PASS with no failures.

- [ ] **Step 3: Run FE verification**

Run: `npm run lint && npm run typecheck && npm run test:ui:ci -- --shard=3/4 && npm run build`

Expected: every command exits `0`.

- [ ] **Step 4: Inspect exact changes before PRs**

```bash
git diff --check
git status --short
git log --oneline origin/develop..HEAD
```

Expected: no whitespace errors and only Finance Sync Config changes. For the extension, compare against `EC/extension-command-phase-1` and create its PR only after that manual-import branch has merged.

- [ ] **Step 5: Create the PRs in dependency order**

1. Merge `EC/extension-command-phase-1` into the extension default branch.
2. Open BE and FE PRs from `EC/finance-sync-config` to `develop`.
3. Rebase the extension config branch on the merged default branch, run the extension contract test again, then open its PR.
