# Operations Exception Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a scoped, paginated report endpoint that aggregates deterministic operational exceptions without persisting duplicate workflow state.

**Architecture:** Add narrow `listOperationalExceptions(query, systemContext)` public-port functions to owning modules, then merge their bounded rows in `report.service.js`. `report` owns filtering, stable ordering, authorization-derived actions, and DTO shaping.

**Tech Stack:** Express 5, Joi, Mongoose lean queries, Jest 30.

## Global Constraints

- POD Golden Flow recovery tests must pass first.
- No exception model, repository, collection, package, or background projection.
- Cross-module calls use public ports only.
- A source-port failure fails the entire request.
- Default `limit` is 50; maximum is 100.

---

### Task 1: Define the Report Contract

**Files:**
- Modify: `src/modules/report/constants/report.constants.js`
- Modify: `src/modules/report/validators/report.validator.js`
- Modify: `src/modules/report/dtos/report.dto.js`
- Test: `src/test/report/services/report.service.test.js`

**Interfaces:**
- Produces: `operationalExceptionQuerySchema` and `toOperationalExceptionDto(row, now)`.

- [ ] **Step 1: Add failing DTO/validation tests**

```js
expect(validate(operationalExceptionQuerySchema, { severity: 'blocked', limit: 500 }).details).toBeDefined();
expect(toOperationalExceptionDto({
  sourceModule: 'production',
  exceptionCode: 'PSD_MISSING',
  severity: 'BLOCKED',
  entityType: 'PRODUCTION_TASK',
  entityId: 'task-1',
  firstObservedAt: new Date('2026-07-23T00:00:00Z'),
}, new Date('2026-07-23T01:00:00Z'))).toMatchObject({
  id: 'production:PRODUCTION_TASK:task-1:PSD_MISSING',
  ageSeconds: 3600,
});
```

- [ ] **Step 2: Implement constants, schema, and DTO**

```js
const operationalExceptionCodes = Object.freeze([
  'MAPPING_MISSING',
  'CUSTOMIZATION_REVIEW_REQUIRED',
  'PSD_MISSING',
  'PRODUCTION_QC_BLOCKED',
  'VENDOR_SUBMISSION_FAILED',
  'TRACKING_PENDING',
  'FINANCE_SNAPSHOT_INCOMPLETE',
]);
```

The Joi schema accepts `sourceModule`, `exceptionCode`, `severity`, `shopId`, `ageFromSeconds`, `page`, and `limit`; uppercase enum inputs and cap `limit` at `100`. The DTO must allow-list only spec fields and calculate non-negative integer `ageSeconds`.

- [ ] **Step 3: Verify and commit**

Run: `npm test -- src/test/report --runInBand`

```powershell
git add src/modules/report src/test/report
git commit -m "feat(report): define operational exception contract"
```

### Task 2: Expose Bounded Source Queries

**Files:**
- Modify: `src/modules/mapping/public.js`
- Modify: `src/modules/customization/public.js`
- Modify: `src/modules/production/public.js`
- Modify: `src/modules/vendorSubmission/public.js`
- Modify: `src/modules/shipment/public.js`
- Modify: `src/modules/finance/public.js`
- Modify each owner's existing service/repository and focused tests only where no bounded list already exists.

**Interfaces:**
- Produces in each public port: `listOperationalExceptions(query, authContext) -> Promise<Array<OperationalExceptionSourceRow>>`.

- [ ] **Step 1: Add one failing owner test per predicate**

Use this shared row shape in expectations:

```js
{
  sourceModule: 'vendorSubmission',
  exceptionCode: 'VENDOR_SUBMISSION_FAILED',
  severity: 'BLOCKED',
  entityType: 'VENDOR_SUBMISSION',
  entityId: submissionId,
  shopId,
  orderId,
  orderItemId,
  firstObservedAt: failedAt,
  lastObservedAt: updatedAt,
  context: { status: 'FAILED' },
}
```

- [ ] **Step 2: Implement the smallest lean query**

Each repository query must:

```js
return Model.find(filter)
  .sort({ updatedAt: 1, _id: 1 })
  .limit(Math.min(Number(query.limit) || 50, 100))
  .lean();
```

Map persisted deterministic states only. Reuse existing list/query functions when they already return the necessary fields.

- [ ] **Step 3: Export owner service functions**

Add exactly one public export per module:

```js
listOperationalExceptions: service.listOperationalExceptions,
```

- [ ] **Step 4: Verify owner suites and architecture**

Run: `npm test -- src/test/mapping src/test/customization src/test/production src/test/vendorSubmission src/test/shipment src/test/finance --runInBand`

Run: `npm run test:architecture -- --runInBand`

- [ ] **Step 5: Commit**

```powershell
git add src/modules/mapping src/modules/customization src/modules/production src/modules/vendorSubmission src/modules/shipment src/modules/finance src/test
git commit -m "feat(operations): expose bounded exception reads"
```

### Task 3: Aggregate, Scope, and Order Exceptions

**Files:**
- Modify: `src/modules/report/services/report.service.js`
- Modify: `src/modules/report/dtos/report.dto.js`
- Test: `src/test/report/services/report.service.test.js`

**Interfaces:**
- Consumes: six `listOperationalExceptions` public-port methods.
- Produces: `getOperationalExceptions(query, authContext) -> { items, total, page, limit }`.

- [ ] **Step 1: Add failing aggregation tests**

Cover global scope, scoped shop access, denied shop, deterministic ordering, code/module filters, and rejection when one source rejects.

```js
await expect(service.getOperationalExceptions({}, authContext))
  .resolves.toMatchObject({ page: 1, limit: 50 });
expect(result.items.map((item) => item.exceptionCode))
  .toEqual(['PSD_MISSING', 'TRACKING_PENDING']);
```

- [ ] **Step 2: Implement bounded fan-out**

Reuse `applyReportScope()` and `systemContext()`. Call selected ports with `limit: page * limit`, merge, filter, then sort by severity (`BLOCKED` first), `firstObservedAt`, `sourceModule`, and `id`. Slice the requested page.

```js
const rows = (await Promise.all(loaders.map((load) => load(sourceQuery, systemContext(authContext))))).flat();
```

Do not use `Promise.allSettled`; a missing source is not a complete result.

- [ ] **Step 3: Derive allowed actions**

Map only existing actions and remove any action the caller cannot perform:

```js
const actionsByCode = {
  PSD_MISSING: ['RECHECK_PSD'],
  VENDOR_SUBMISSION_FAILED: ['RETRY_VENDOR_SUBMISSION'],
  TRACKING_PENDING: ['RECHECK_TRACKING'],
  FINANCE_SNAPSHOT_INCOMPLETE: ['RECALCULATE_FINANCE'],
};
```

Use `authPublic.canAccessScope` with the owner permission; do not trust client-provided permissions.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- src/test/report --runInBand`

```powershell
git add src/modules/report src/test/report
git commit -m "feat(report): aggregate operational exceptions"
```

### Task 4: Add the HTTP Endpoint and E2E Recovery Assertion

**Files:**
- Modify: `src/modules/report/controllers/report.controller.js`
- Modify: `src/modules/report/routes/index.js`
- Test: `src/test/report/routes/index.test.js`
- Modify: `src/test/e2e/orderFulfillmentFlow.e2e.test.js`

**Interfaces:**
- Produces: `GET /api/reports/operations/exceptions`.

- [ ] **Step 1: Add failing route tests**

Assert authentication, report read permission, query normalization, `200` pagination payload, and `400` for `limit=101`.

- [ ] **Step 2: Add controller and route**

```js
async function getOperationalExceptions(req, res) {
  const query = assertValid(operationalExceptionQuerySchema, req.query);
  res.status(httpStatus.OK).json({
    success: true,
    data: await service.getOperationalExceptions(query, req.auth),
  });
}
```

Mount it with existing `authenticate`, `requireRead`, and `asyncHandler`.

- [ ] **Step 3: Add disappearance-after-recovery E2E assertion**

Create one persisted source exception, query the service, run its existing recovery operation, query again, and assert its stable exception id is absent.

- [ ] **Step 4: Run full verification and commit**

Run: `npm test -- src/test/report src/test/e2e --runInBand`

Run: `npm run test:architecture -- --runInBand`

Run: `npm test -- --runInBand`

```powershell
git add src/modules/report src/test/report src/test/e2e
git commit -m "feat(report): expose operations exception center"
```
