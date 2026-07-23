# Operational Resilience and Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose owner-module retry state, detect four deterministic cross-module mismatches, and provide guarded idempotent repairs.

**Architecture:** Retry metadata remains in records that already own retries. `report` joins bounded public-port summaries for reconciliation; repair commands re-read state and delegate mutations to owner public ports.

**Tech Stack:** Node.js CommonJS, BullMQ/ioredis where already used, Express, Joi, Jest.

## Global Constraints

- Operations Exception Center must be complete first.
- Do not add a universal retry table, queue wrapper, or scheduler abstraction.
- Do not queue a synchronous flow without a demonstrated failure.
- Repair actions require owner-module write permission and audit evidence.

---

### Task 1: Normalize Existing Retry DTOs

**Files:**
- Modify: `src/modules/integration/externalOrderImport/dtos/externalOrderImport.dto.js`
- Modify: `src/modules/vendorSubmission/dtos/vendorSubmission.dto.js`
- Modify shipment DTO only if its persisted tracking retry fields already exist.
- Test corresponding DTO suites.

**Interfaces:**
- Produces: `retry: { attemptCount, lastAttemptAt, nextRetryAt, lastErrorCode, lastErrorMessage, retryState }`.

- [ ] **Step 1: Add failing allow-list tests**

```js
expect(dto.retry).toEqual({
  attemptCount: 3,
  lastAttemptAt,
  nextRetryAt: null,
  lastErrorCode: 'VENDOR_TIMEOUT',
  lastErrorMessage: 'request timed out',
  retryState: 'EXHAUSTED',
});
expect(JSON.stringify(dto)).not.toContain('providerSecret');
```

- [ ] **Step 2: Add one shared technical normalizer only if two DTOs need identical logic**

Create `src/shared/utils/retryState.js` only when duplication is real:

```js
function toRetryState(row = {}) {
  if (row.resolvedAt) return 'RESOLVED';
  if (row.exhaustedAt) return 'EXHAUSTED';
  if (row.nextRetryAt) return 'SCHEDULED';
  if (row.attemptCount > 0) return 'RETRYING';
  return 'NOT_SCHEDULED';
}

module.exports = { toRetryState };
```

Otherwise keep the mapping inside each DTO.

- [ ] **Step 3: Verify and commit**

Run: `npm test -- src/test/integration src/test/vendorSubmission src/test/shipment --runInBand`

```powershell
git add src/modules src/shared src/test
git commit -m "feat(operations): expose retry state"
```

### Task 2: Add Bounded Reconciliation Source Summaries

**Files:**
- Modify: `src/modules/vendorSubmission/public.js`
- Modify: `src/modules/shipment/public.js`
- Modify: `src/modules/finance/public.js`
- Modify: `src/modules/order/public.js`
- Modify owner services/repositories and focused tests.

**Interfaces:**
- Produces:
  - `vendorSubmissionPublic.listReconciliationCandidates(query, authContext)`
  - `shipmentPublic.listSummariesByOrderItemIds(orderItemIds, authContext)` (reuse existing)
  - `financePublic.listSnapshotsByOrderItemIds(orderItemIds, authContext)` (reuse existing)
  - `orderPublic.findItemsByIds(ids)` (reuse existing)

- [ ] **Step 1: Add a failing vendor candidate test**

```js
expect(await service.listReconciliationCandidates({ limit: 100 }, systemContext))
  .toEqual([expect.objectContaining({
    orderItemId,
    status: 'SUBMITTED',
    submittedAt,
  })]);
```

- [ ] **Step 2: Implement one lean bounded owner query**

Return only ids, statuses, timestamps, shop/order links, retry state, and vendor identity. Sort oldest first and cap at 100.

- [ ] **Step 3: Export the query and verify architecture**

```js
listReconciliationCandidates: service.listReconciliationCandidates,
```

Run: `npm run test:architecture -- --runInBand`

- [ ] **Step 4: Commit**

```powershell
git add src/modules/vendorSubmission src/test/vendorSubmission
git commit -m "feat(vendor-submission): expose reconciliation candidates"
```

### Task 3: Compute Four Reconciliation Findings

**Files:**
- Modify: `src/modules/report/constants/report.constants.js`
- Modify: `src/modules/report/dtos/report.dto.js`
- Modify: `src/modules/report/services/report.service.js`
- Test: `src/test/report/services/report.service.test.js`

**Interfaces:**
- Produces: `getOperationalReconciliation(query, authContext)`.

- [ ] **Step 1: Add table-driven failing tests**

```js
it.each([
  ['SUBMITTED_WITHOUT_SHIPMENT', submittedWithoutShipment],
  ['SHIPPED_WITHOUT_FINANCE_SNAPSHOT', shippedWithoutSnapshot],
  ['FINANCE_ITEM_LINK_INCOMPLETE', incompleteFinanceLinks],
  ['TERMINAL_VENDOR_FAILURE_WITH_ACTIVE_PRODUCTION', exhaustedVendorWithActiveTask],
])('returns %s', async (code, fixture) => {
  fixture();
  const result = await service.getOperationalReconciliation({}, authContext);
  expect(result.items).toContainEqual(expect.objectContaining({ findingCode: code }));
});
```

- [ ] **Step 2: Implement pure predicates**

Keep four small functions in `report.service.js`; each accepts already-fetched summaries and returns a row or `null`. Use one request timestamp for grace-period comparisons.

- [ ] **Step 3: Add pagination and DTO shaping**

Reuse Exception Center ordering and scope behavior. Do not persist findings.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- src/test/report --runInBand`

```powershell
git add src/modules/report src/test/report
git commit -m "feat(report): add operational reconciliation"
```

### Task 4: Add Guarded Repair Commands

**Files:**
- Modify: `src/modules/report/controllers/report.controller.js`
- Modify: `src/modules/report/routes/index.js`
- Modify: `src/modules/report/validators/report.validator.js`
- Modify owner `public.js` only for a missing deterministic repair operation.
- Test: `src/test/report/routes/index.test.js`
- Test: owner service suites.

**Interfaces:**
- Produces: `POST /api/reports/operations/reconciliation/:findingId/repair`.
- Consumes existing shipment recheck, finance recalculation, vendor retry, and guarded production transitions.

- [ ] **Step 1: Add failing stale-finding and permission tests**

Assert `403` without owner write permission, `409` when source state no longer matches, and `200` with an owner result for a current finding.

- [ ] **Step 2: Validate the repair command**

```js
const reconciliationRepairSchema = Joi.object({
  findingCode: Joi.string().valid(
    'SUBMITTED_WITHOUT_SHIPMENT',
    'SHIPPED_WITHOUT_FINANCE_SNAPSHOT',
    'FINANCE_ITEM_LINK_INCOMPLETE',
    'TERMINAL_VENDOR_FAILURE_WITH_ACTIVE_PRODUCTION',
  ).required(),
});
```

- [ ] **Step 3: Re-read and delegate**

The report service parses the stable finding identity, reloads current source summaries, rejects stale findings, checks owner permission/scope, then calls exactly one owner public method. It never imports owner internals.

- [ ] **Step 4: Verify idempotency and audit**

Call each repair twice; the second call must return the already-correct state or `409` stale, never duplicate a submission/shipment/snapshot. Assert existing audit/timeline port invocation.

- [ ] **Step 5: Run full verification and commit**

Run: `npm test -- src/test/report src/test/vendorSubmission src/test/shipment src/test/finance src/test/production --runInBand`

Run: `npm run test:architecture -- --runInBand`

Run: `npm test -- --runInBand`

```powershell
git add src/modules src/test
git commit -m "feat(operations): add guarded reconciliation repair"
```
