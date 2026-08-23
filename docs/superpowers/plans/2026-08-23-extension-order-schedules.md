# Extension Order Schedules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Queue one non-overlapping Orders import per enabled extension agent at a configured 1-4 hour interval.

**Architecture:** Keep schedules in the existing `integration/extensionCommand` module. A one-minute process timer calls a service that atomically advances due schedules before it creates normal `IMPORT_NEW_ORDERS` commands. FE consumes the new schedule endpoints next to existing extension controls.

**Tech Stack:** Node.js, Express, Mongoose, Joi, Jest, React, React Query, Ant Design.

**Spec:** `docs/superpowers/specs/2026-08-23-extension-order-schedules-design.md`

## Global Constraints

- Orders only; no Ads, Transactions, or Settlements schedule.
- Use `60`, `120`, `180`, or `240` minutes only; default `120`.
- No Amazon credentials, cookies, or extension access tokens in schedule records or responses.
- Reuse the existing online threshold and extension command status model.
- Missed runs coalesce into one later attempt; never create a backlog.

---

### Task 1: Persist and dispatch order schedules

**Files:**
- Create: `src/modules/integration/extensionCommand/models/extensionOrderSchedule.model.js`
- Modify: `src/modules/integration/extensionCommand/repositories/extensionCommand.repository.js`
- Modify: `src/modules/integration/extensionCommand/services/extensionCommand.service.js`
- Create: `src/modules/integration/extensionCommand/__tests__/extensionOrderSchedule.service.test.js`

**Interfaces:**
- Produces: `upsertOrderSchedule`, `listOrderSchedules`, `claimDueOrderSchedule`, and `dispatchDueOrderSchedules`.

- [ ] **Step 1: Write the failing service tests**

```js
it('queues one one-day order command for a due online schedule', async () => {
  await service.dispatchDueOrderSchedules(new Date('2026-08-23T00:00:00.000Z'));
  expect(repository.createCommand).toHaveBeenCalledWith(expect.objectContaining({
    type: 'IMPORT_NEW_ORDERS', numDays: 1, createdByAccountId: null,
  }));
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx jest --runInBand src/modules/integration/extensionCommand/__tests__/extensionOrderSchedule.service.test.js`

Expected: FAIL because `dispatchDueOrderSchedules` does not exist.

- [ ] **Step 3: Add model, repository and minimal dispatch implementation**

```js
async function dispatchDueOrderSchedules(now = new Date()) {
  const schedules = await repository.listDueOrderSchedules(now);
  for (const schedule of schedules) {
    if (!await repository.claimDueOrderSchedule(schedule._id, now, schedule.intervalMinutes)) continue;
    if (!isOnline(schedule.agent, now) || await repository.hasActiveOrderCommand(schedule.agentId)) {
      await repository.postponeOrderSchedule(schedule._id, now, 15);
      continue;
    }
    await repository.createCommand({ type: 'IMPORT_NEW_ORDERS', shopId: schedule.shopId, agentId: schedule.agentId, numDays: 1, createdByAccountId: null });
  }
}
```

- [ ] **Step 4: Run the service tests and verify GREEN**

Run: `npx jest --runInBand src/modules/integration/extensionCommand/__tests__/extensionOrderSchedule.service.test.js`

Expected: PASS.

### Task 2: Expose authorized schedule configuration

**Files:**
- Modify: `src/modules/integration/extensionCommand/controllers/extensionCommand.controller.js`
- Modify: `src/modules/integration/extensionCommand/routes/extensionCommand.routes.js`
- Modify: `src/modules/integration/extensionCommand/validators/extensionCommand.validator.js`
- Modify: `src/modules/integration/extensionCommand/dtos/extensionCommand.dto.js`
- Modify: `src/modules/integration/extensionCommand/services/extensionCommand.service.js`
- Test: `src/modules/integration/extensionCommand/__tests__/extensionCommand.validator.test.js`
- Test: `src/modules/integration/extensionCommand/__tests__/extensionOrderSchedule.service.test.js`

**Interfaces:**
- Produces: `GET /order-schedules` and `PUT /order-schedules/:agentId`.

- [ ] **Step 1: Write failing validation and authorization tests**

```js
expect(validate(upsertOrderScheduleSchema, { enabled: true, intervalMinutes: 30 }).details).toBeTruthy();
await expect(service.upsertOrderSchedule(agentId, { enabled: true, intervalMinutes: 120 }, unauthorizedAuth)).rejects.toMatchObject({ statusCode: 403 });
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `npx jest --runInBand src/modules/integration/extensionCommand/__tests__/extensionCommand.validator.test.js src/modules/integration/extensionCommand/__tests__/extensionOrderSchedule.service.test.js`

Expected: FAIL because the schedule schema and service methods do not exist.

- [ ] **Step 3: Add whitelist validation, scoped authorization, DTO and routes**

```js
const upsertOrderScheduleSchema = Joi.object({
  enabled: Joi.boolean().required(),
  intervalMinutes: Joi.number().integer().valid(60, 120, 180, 240).required(),
});
```

- [ ] **Step 4: Run the API-focused tests and verify GREEN**

Run: `npx jest --runInBand src/modules/integration/extensionCommand/__tests__/extensionCommand.validator.test.js src/modules/integration/extensionCommand/__tests__/extensionOrderSchedule.service.test.js`

Expected: PASS.

### Task 3: Start and stop the backend scheduler

**Files:**
- Create: `src/modules/integration/extensionCommand/services/extensionOrderScheduleScheduler.service.js`
- Modify: `src/server.js`
- Test: `src/modules/integration/extensionCommand/__tests__/extensionOrderSchedule.service.test.js`

**Interfaces:**
- Produces: `startExtensionOrderScheduleScheduler` and `stopExtensionOrderScheduleScheduler`.

- [ ] **Step 1: Write a failing scheduler test**

```js
expect(service.dispatchDueOrderSchedules).toHaveBeenCalledTimes(1);
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx jest --runInBand src/modules/integration/extensionCommand/__tests__/extensionOrderSchedule.service.test.js`

Expected: FAIL because the scheduler module does not exist.

- [ ] **Step 3: Add one-minute timer and lifecycle wiring**

```js
function startExtensionOrderScheduleScheduler() {
  if (timer) return;
  timer = setInterval(() => service.dispatchDueOrderSchedules().catch((error) => logger.error('extension_order_schedule_dispatch_failed', { error })), 60 * 1000);
}
```

- [ ] **Step 4: Run scheduler/service tests and architecture test**

Run: `npx jest --runInBand src/modules/integration/extensionCommand/__tests__/extensionOrderSchedule.service.test.js && npm run test:architecture -- --runInBand`

Expected: PASS.

### Task 4: Add the FE schedule control

**Files:**
- Modify: `src/features/portal/integrations/api/integrationApi.ts`
- Modify: `src/features/portal/integrations/api/integrationKeys.ts`
- Modify: `src/features/portal/integrations/pages/IntegrationWorkbenchPage.tsx`
- Modify: `src/test/portal/integrations/pages/IntegrationWorkbenchPage.test.tsx`

**Interfaces:**
- Consumes: list and upsert order schedule API responses.

- [ ] **Step 1: Write a failing UI test**

```tsx
fireEvent.click(await screen.findByRole('button', { name: 'Configure order schedule' }));
fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
await waitFor(() => expect(upsertExtensionOrderSchedule).toHaveBeenCalledWith('agent-1', { enabled: true, intervalMinutes: 120 }));
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx vitest run --project ui --maxWorkers=1 src/test/portal/integrations/pages/IntegrationWorkbenchPage.test.tsx --testNamePattern "order schedule"`

Expected: FAIL because no schedule control exists.

- [ ] **Step 3: Add API client and a compact table popover**

```tsx
<Popover content={<Button onClick={() => saveSchedule.mutate({ agentId: agent.id, enabled, intervalMinutes })}>Save schedule</Button>}>
  <Button aria-label={t('portal.integrations.extension.configureOrderSchedule', { defaultValue: 'Configure order schedule' })} icon={<ClockCircleOutlined />} />
</Popover>
```

- [ ] **Step 4: Run focused UI test and typecheck**

Run: `npx vitest run --project ui --maxWorkers=1 src/test/portal/integrations/pages/IntegrationWorkbenchPage.test.tsx --testNamePattern "order schedule" && npm run typecheck`

Expected: PASS.

### Task 5: Final verification

- [ ] **Step 1: Run changed backend tests**

Run: `npx jest --runInBand src/modules/integration/extensionCommand/__tests__/extensionCommand.service.test.js src/modules/integration/extensionCommand/__tests__/extensionCommand.validator.test.js src/modules/integration/extensionCommand/__tests__/extensionOrderSchedule.service.test.js`

Expected: PASS.

- [ ] **Step 2: Run extension contract suite**

Run: `node --test tests/*.test.mjs`

Expected: PASS.

- [ ] **Step 3: Inspect changes**

Run: `git diff --check && git status --short`

Expected: no whitespace errors and only schedule-related changes.
