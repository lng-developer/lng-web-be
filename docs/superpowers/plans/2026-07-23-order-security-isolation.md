# Order Security Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bind external-order import operations to the caller's shop scope, reject cross-shop reuse of a global external-order identity, and remove raw imported snapshots from ordinary order APIs and their frontend consumer.

**Architecture:** Keep the existing global order unique index and enforce ownership before any update or child write. Integration remains responsible for import-job authorization and calls only `auth/public.js`; scoped issue listing resolves allowed job IDs instead of copying `shopId` into issues. DTOs expose only stable normalized fields, and the paired frontend stops using the removed raw fallback.

**Tech Stack:** Node.js, Express, CommonJS, Mongoose, Joi, Jest; React/Vite frontend utility tests.

## Global Constraints

- Preserve the global external-order identity `{ salesChannelCode, marketplaceCode, externalOrderId }`.
- A different-shop identity collision must return HTTP `409` with `CONFLICT_ERROR` before item, timeline, or readiness writes.
- Import creation and retry require shop-scoped `ORDERS:WRITE`; job, raw-record, and issue reads require shop-scoped `ORDERS:READ`, with `ORDERS:WRITE` satisfying read.
- Internal stale-job recovery must pass `{ system: true }` explicitly; missing auth context is not an implicit bypass.
- Integration may call `auth/public.js` but must not import Order internals.
- Do not add a package, collection, schema migration, queue, route, permission, or generic authorization framework.
- Read-only Mongoose queries must use `.lean()` or `distinct()`.
- Remove `externalData`, `variantRaw`, and `customizationRawSummary` only from the standard DTOs named in the spec; expanded and workbench DTO contracts remain unchanged.
- Preserve unrelated working-tree changes and do not commit directly to `develop`.

---

### Task 1: Bind import creation and job operations to shop scope

**Files:**
- Modify: `src/modules/integration/externalOrderImport/controllers/externalOrderImport.controller.js`
- Modify: `src/modules/integration/externalOrderImport/services/externalOrderImport.service.js`
- Test: `src/test/integration/externalOrderImport/controllers/externalOrderImport.controller.test.js`
- Test: `src/test/integration/externalOrderImport/services/externalOrderImport.service.test.js`

**Interfaces:**
- Consumes: `authPublic.canAccessScope(authContext, permission, { scopeType: 'shop', scopeId })`.
- Produces: auth-aware service signatures `importFromManualExcel(payload, authContext)`, `importFromEtsySoldOrderItems(payload, authContext)`, `getImportJob(jobId, authContext)`, `listImportJobIssues(jobId, params, authContext)`, `listImportJobRawRecords(jobId, params, authContext)`, and `retryImportJob(jobId, authContext)`.

- [ ] **Step 1: Add the auth public-port mock and failing denial tests**

Add this mock before requiring the service:

```js
jest.mock('../../../../modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));
```

Add `shopId` to the default job fixture and import the mock:

```js
const authPublic = require('../../../../modules/auth/public');

const shopId = '660000000000000000000201';
const otherShopId = '660000000000000000000202';

beforeEach(() => {
  authPublic.canAccessScope.mockReturnValue(true);
  jobRepository.findById.mockResolvedValue({
    _id: '660000000000000000000601',
    shopId,
    status: 'COMPLETED',
  });
});
```

Add focused service tests:

```js
test('rejects creating an import for a shop outside the caller write scope', async () => {
  authPublic.canAccessScope.mockReturnValue(false);

  await expect(service.importFromManualExcel(
    { shopId: otherShopId, buffer: Buffer.from('x') },
    { scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['ORDERS:WRITE'] }] },
  )).rejects.toMatchObject({
    statusCode: 403,
    code: 'AUTHORIZATION_ERROR',
  });

  expect(manualExcelImportService.importManualExcelOrderReport).not.toHaveBeenCalled();
});

test('rejects reading and retrying another shops import job', async () => {
  authPublic.canAccessScope.mockReturnValue(false);
  const auth = { scopes: [{ scopeType: 'shop', scopeId: otherShopId, permissions: ['ORDERS:READ'] }] };

  await expect(service.getImportJob('660000000000000000000601', auth))
    .rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });
  await expect(service.retryImportJob('660000000000000000000601', auth))
    .rejects.toMatchObject({ statusCode: 403, code: 'AUTHORIZATION_ERROR' });

  expect(rawRecordRepository.listAllByJob).not.toHaveBeenCalled();
  expect(manualExcelImportService.retryManualImportJob).not.toHaveBeenCalled();
});
```

Run:

```powershell
npm test -- src/test/integration/externalOrderImport/services/externalOrderImport.service.test.js --runInBand
```

Expected: the new denial tests fail because the service does not inspect `authContext`.

- [ ] **Step 2: Add the smallest service-level shop guard**

Import the existing public port and add local constants/helpers inside `externalOrderImport.service.js`:

```js
const authPublic = require('../../../auth/public');

const ORDER_READ_PERMISSION = 'ORDERS:READ';
const ORDER_WRITE_PERMISSION = 'ORDERS:WRITE';
const SHOP_SCOPE_TYPE = 'shop';

function forbidden() {
  return new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
}

function canAccessShop(shopId, permission, authContext = {}) {
  if (authContext.system === true) return true;

  const scope = { scopeType: SHOP_SCOPE_TYPE, scopeId: shopId };
  if (authPublic.canAccessScope(authContext, permission, scope)) return true;

  return permission === ORDER_READ_PERMISSION
    && authPublic.canAccessScope(authContext, ORDER_WRITE_PERMISSION, scope);
}

function assertShopAccess(shopId, permission, authContext = {}) {
  if (!shopId || !canAccessShop(shopId, permission, authContext)) throw forbidden();
}

async function loadAuthorizedImportJob(jobId, permission, authContext) {
  const job = await loadImportJob(jobId);
  assertShopAccess(job.shopId, permission, authContext);
  return job;
}
```

Change import wrappers:

```js
async function importFromManualExcel(payload, authContext) {
  assertShopAccess(payload.shopId, ORDER_WRITE_PERMISSION, authContext);
  return manualExcelImportService.importManualExcelOrderReport(payload);
}

async function importFromEtsySoldOrderItems(payload, authContext) {
  assertShopAccess(payload.shopId, ORDER_WRITE_PERMISSION, authContext);
  return manualExcelImportService.importEtsySoldOrderItems(payload);
}
```

Use `loadAuthorizedImportJob()` in each externally callable job operation:

```js
async function getImportJob(jobId, authContext) {
  const job = await loadAuthorizedImportJob(jobId, ORDER_READ_PERMISSION, authContext);
  return { ...job, summary: await buildImportJobSummary(jobId) };
}

async function listImportJobIssues(jobId, params, authContext) {
  await loadAuthorizedImportJob(jobId, ORDER_READ_PERMISSION, authContext);
  return issueRepository.listByJob(jobId, params);
}

async function listImportJobRawRecords(jobId, params, authContext) {
  await loadAuthorizedImportJob(jobId, ORDER_READ_PERMISSION, authContext);
  return rawRecordRepository.listByJob(jobId, params);
}
```

For retry, replace only the signature and job-loading line:

```diff
-async function retryImportJob(jobId) {
-  const job = await loadImportJob(jobId);
+async function retryImportJob(jobId, authContext) {
+  const job = await loadAuthorizedImportJob(jobId, ORDER_WRITE_PERMISSION, authContext);
```

Do not change `listOpenIssuesForExternalItem()`; it is an internal public-port operation used by Order readiness.

- [ ] **Step 3: Pass `req.auth` from every controller entry point**

Update calls without changing response DTOs:

```js
const result = await service.importFromManualExcel({
  ...body,
  buffer: getUploadBuffer(req, body),
  triggeredBy: req.auth && req.auth.accountId,
}, req.auth);

const result = await service.importFromEtsySoldOrderItems({
  ...body,
  buffer: getUploadBuffer(req, body),
  triggeredBy: req.auth && req.auth.accountId,
}, req.auth);

const job = await service.getImportJob(jobId, req.auth);
const result = await service.listImportJobIssues(jobId, query, req.auth);
const result = await service.listImportJobRawRecords(jobId, query, req.auth);
const result = await service.retryImportJob(jobId, req.auth);
```

Update controller assertions to verify the last argument:

```js
expect(service.retryImportJob).toHaveBeenCalledWith(
  '660000000000000000000601',
  req.auth,
);
```

For import controller tests, assert:

```js
expect(service.importFromManualExcel).toHaveBeenCalledWith(
  expect.objectContaining({ shopId: req.body.shopId }),
  req.auth,
);
```

- [ ] **Step 4: Make recovery bypass explicit**

Change the internal recovery call only:

```js
const retryResult = await retryImportJob(jobId, {
  system: true,
  source: 'EXTERNAL_ORDER_IMPORT_RECOVERY',
});
```

Update existing service tests that exercise internal behavior directly to pass either a real auth fixture or:

```js
{ system: true, source: 'TEST' }
```

Do not make an absent auth context equivalent to system access.

- [ ] **Step 5: Verify Task 1**

Run:

```powershell
npm test -- src/test/integration/externalOrderImport/controllers/externalOrderImport.controller.test.js src/test/integration/externalOrderImport/services/externalOrderImport.service.test.js --runInBand
```

Expected: both suites pass; denied calls perform no import, raw-record, summary, retry, or queue work.

- [ ] **Step 6: Commit Task 1 on a feature branch**

```powershell
git add src/modules/integration/externalOrderImport/controllers/externalOrderImport.controller.js src/modules/integration/externalOrderImport/services/externalOrderImport.service.js src/test/integration/externalOrderImport/controllers/externalOrderImport.controller.test.js src/test/integration/externalOrderImport/services/externalOrderImport.service.test.js
git commit -m "fix(integration): enforce shop scope for order imports"
```

### Task 2: Scope the global issue list without changing schemas

**Files:**
- Modify: `src/modules/integration/externalOrderImport/repositories/externalOrderImportJob.repository.js`
- Modify: `src/modules/integration/externalOrderImport/repositories/externalOrderImportIssue.repository.js`
- Modify: `src/modules/integration/externalOrderImport/services/externalOrderImport.service.js`
- Create: `src/test/integration/externalOrderImport/repositories/externalOrderImportJob.repository.test.js`
- Create: `src/test/integration/externalOrderImport/repositories/externalOrderImportIssue.repository.test.js`
- Test: `src/test/integration/externalOrderImport/services/externalOrderImport.service.test.js`

**Interfaces:**
- Consumes: the Task 1 constants and auth semantics.
- Produces: `jobRepository.findIds({ shopIds })`, issue filter `importJobIds`, and shop-scoped `listIssues(params, authContext)`.

- [ ] **Step 1: Add failing repository filter tests**

In the job repository test, mock `ExternalOrderImportJob.distinct()` and assert:

```js
await repository.findIds({ shopIds: ['660000000000000000000201'] });

expect(ExternalOrderImportJob.distinct).toHaveBeenCalledWith('_id', {
  shopId: { $in: ['660000000000000000000201'] },
});
```

In the issue repository test, call:

```js
await repository.list({
  importJobIds: [
    '660000000000000000000601',
    '660000000000000000000602',
  ],
  page: 1,
  limit: 20,
});
```

Assert both `find()` and `countDocuments()` receive:

```js
{
  importJobId: {
    $in: [
      '660000000000000000000601',
      '660000000000000000000602',
    ],
  },
}
```

Run:

```powershell
npm test -- src/test/integration/externalOrderImport/repositories/externalOrderImportJob.repository.test.js src/test/integration/externalOrderImport/repositories/externalOrderImportIssue.repository.test.js --runInBand
```

Expected: failures because `findIds`, `shopIds`, and `importJobIds` are not implemented.

- [ ] **Step 2: Implement the repository filters**

Extend the job repository filter:

```js
function buildFilter({ source, sourceType, shopId, shopIds, status } = {}) {
  const filter = {};
  if (source) filter.source = source;
  if (sourceType) filter.sourceType = sourceType;
  if (shopId) filter.shopId = shopId;
  if (shopIds && shopIds.length > 0) filter.shopId = { $in: shopIds };
  if (status) filter.status = status;
  return filter;
}

async function findIds(filters = {}) {
  return ExternalOrderImportJob.distinct('_id', buildFilter(filters));
}
```

Export `findIds`.

Extend the issue repository filter:

```js
function buildFilter({
  importJobId,
  importJobIds,
  source,
  status,
  issueType,
  severity,
  externalOrderId,
  externalItemId,
} = {}) {
  const filter = {};
  if (importJobId) filter.importJobId = importJobId;
  else if (importJobIds) filter.importJobId = { $in: importJobIds };
  if (source) filter.source = source;
  if (status) filter.status = status;
  if (issueType) filter.issueType = issueType;
  if (severity) filter.severity = severity;
  if (externalOrderId) filter.externalOrderId = externalOrderId;
  if (externalItemId) filter.externalItemId = externalItemId;
  return filter;
}
```

Do not add `shopId` to `ExternalOrderImportIssue`.

- [ ] **Step 3: Add failing scoped-list service tests**

Add `findIds: jest.fn()` to the job repository mock. Add:

```js
test('limits issue listing to jobs from readable shops', async () => {
  jobRepository.findIds.mockResolvedValue([
    '660000000000000000000601',
    '660000000000000000000602',
  ]);
  const auth = {
    scopes: [{
      scopeType: 'shop',
      scopeId: '660000000000000000000201',
      permissions: ['ORDERS:READ'],
    }],
  };

  await service.listIssues({ status: 'OPEN', page: 1, limit: 20 }, auth);

  expect(jobRepository.findIds).toHaveBeenCalledWith({
    shopIds: ['660000000000000000000201'],
  });
  expect(issueRepository.list).toHaveBeenCalledWith(expect.objectContaining({
    importJobIds: [
      '660000000000000000000601',
      '660000000000000000000602',
    ],
    status: 'OPEN',
  }));
});

test('returns an empty page when scoped caller has no readable jobs', async () => {
  jobRepository.findIds.mockResolvedValue([]);

  const result = await service.listIssues(
    { page: 2, limit: 10 },
    { scopes: [{ scopeType: 'shop', scopeId: '660000000000000000000201', permissions: ['ORDERS:READ'] }] },
  );

  expect(result).toEqual({ items: [], total: 0, page: 2, limit: 10 });
  expect(issueRepository.list).not.toHaveBeenCalled();
});

test('keeps the unscoped issue list for global readers', async () => {
  await service.listIssues(
    { status: 'OPEN' },
    { permissions: ['ORDERS:READ'] },
  );

  expect(jobRepository.findIds).not.toHaveBeenCalled();
  expect(issueRepository.list).toHaveBeenCalledWith({ status: 'OPEN' });
});
```

Run:

```powershell
npm test -- src/test/integration/externalOrderImport/services/externalOrderImport.service.test.js --runInBand
```

Expected: scoped-list tests fail before service filtering exists.

- [ ] **Step 4: Implement scoped issue listing**

Import `normalizePagination`:

```js
const { normalizePagination } = require('../../../../shared/utils/pagination');
```

Add:

```js
function hasGlobalOrderRead(authContext = {}) {
  const permissions = authContext.permissions || [];
  return authContext.system === true
    || permissions.includes(ORDER_READ_PERMISSION)
    || permissions.includes(ORDER_WRITE_PERMISSION);
}

function getReadableShopIds(authContext = {}) {
  if (hasGlobalOrderRead(authContext)) return null;

  return [...new Set((authContext.scopes || [])
    .filter((scope) => scope.scopeType === SHOP_SCOPE_TYPE
      && scope.scopeId
      && (scope.permissions || []).some((permission) => (
        permission === ORDER_READ_PERMISSION || permission === ORDER_WRITE_PERMISSION
      )))
    .map((scope) => String(scope.scopeId)))];
}

function emptyPage(params = {}) {
  const { page, limit } = normalizePagination(params);
  return { items: [], total: 0, page, limit };
}

async function listIssues(params = {}, authContext = {}) {
  const shopIds = getReadableShopIds(authContext);
  if (shopIds === null) return issueRepository.list(params);
  if (shopIds.length === 0) return emptyPage(params);

  const importJobIds = (await jobRepository.findIds({ shopIds })).map(String);
  if (importJobIds.length === 0) return emptyPage(params);

  if (params.importJobId && !importJobIds.includes(String(params.importJobId))) {
    return emptyPage(params);
  }

  return issueRepository.list(params.importJobId
    ? params
    : { ...params, importJobIds });
}
```

Update `controller.listIssues()` to call:

```js
const result = await service.listIssues(query, req.auth);
```

Add `req.auth` to the controller test and assert it is forwarded.

- [ ] **Step 5: Verify Task 2**

Run:

```powershell
npm test -- src/test/integration/externalOrderImport/repositories/externalOrderImportJob.repository.test.js src/test/integration/externalOrderImport/repositories/externalOrderImportIssue.repository.test.js src/test/integration/externalOrderImport/services/externalOrderImport.service.test.js src/test/integration/externalOrderImport/controllers/externalOrderImport.controller.test.js --runInBand
```

Expected: all selected suites pass; scoped issue queries cannot omit or override the allowed job set.

- [ ] **Step 6: Commit Task 2 on the feature branch**

```powershell
git add src/modules/integration/externalOrderImport/repositories/externalOrderImportJob.repository.js src/modules/integration/externalOrderImport/repositories/externalOrderImportIssue.repository.js src/modules/integration/externalOrderImport/services/externalOrderImport.service.js src/modules/integration/externalOrderImport/controllers/externalOrderImport.controller.js src/test/integration/externalOrderImport/repositories/externalOrderImportJob.repository.test.js src/test/integration/externalOrderImport/repositories/externalOrderImportIssue.repository.test.js src/test/integration/externalOrderImport/services/externalOrderImport.service.test.js src/test/integration/externalOrderImport/controllers/externalOrderImport.controller.test.js
git commit -m "fix(integration): scope import issues by shop"
```

### Task 3: Reject cross-shop use of a global external-order identity

**Files:**
- Modify: `src/modules/order/services/orderImport.service.js`
- Test: `src/test/order/orderImport.service.test.js`

**Interfaces:**
- Consumes: existing global identity and `conflictError()` from `orderImport.helpers.js`.
- Produces: deterministic `409 CONFLICT_ERROR` before any update or child side effect when `existingOrder.shopId !== dto.shopId`.

- [ ] **Step 1: Add failing normal and duplicate-race tests**

Import the timeline mock in the test:

```js
const orderTimelineService = require('../../modules/order/services/orderTimeline.service');
```

Ensure every existing-order fixture includes `shopId: 'shop-1'`. Add:

```js
test('rejects a global order identity already owned by another shop', async () => {
  orderRepository.findByExternalIdentity.mockResolvedValue({
    _id: 'order-1',
    shopId: 'shop-1',
  });

  await expect(orderImportService.importExternalOrder({
    ...oneItemDto,
    shopId: 'shop-2',
  })).rejects.toMatchObject({
    statusCode: 409,
    code: 'CONFLICT_ERROR',
    details: {
      requestedShopId: 'shop-2',
      identity: {
        salesChannelCode: 'AMAZON',
        marketplaceCode: 'AMAZON_US',
        externalOrderId: '113-3',
      },
    },
  });

  expect(orderRepository.updateFromExternalImport).not.toHaveBeenCalled();
  expect(orderItemRepository.create).not.toHaveBeenCalled();
  expect(orderTimelineService.appendTimeline).not.toHaveBeenCalled();
  expect(orderReadinessService.updateCostCenterStatusForOrder).not.toHaveBeenCalled();
});

test('rejects a different shop after duplicate-key race recovery', async () => {
  orderRepository.findByExternalIdentity
    .mockResolvedValueOnce(null)
    .mockResolvedValueOnce({ _id: 'order-1', shopId: 'shop-1' });
  orderRepository.create.mockRejectedValue(Object.assign(
    new Error('E11000 duplicate key'),
    { code: 11000 },
  ));

  await expect(orderImportService.importExternalOrder({
    ...oneItemDto,
    shopId: 'shop-2',
  })).rejects.toMatchObject({
    statusCode: 409,
    code: 'CONFLICT_ERROR',
  });

  expect(orderRepository.updateFromExternalImport).not.toHaveBeenCalled();
  expect(orderItemRepository.create).not.toHaveBeenCalled();
  expect(orderTimelineService.appendTimeline).not.toHaveBeenCalled();
});
```

Run:

```powershell
npm test -- src/test/order/orderImport.service.test.js --runInBand
```

Expected: both tests fail because `upsertOrder()` currently updates the first shop's order.

- [ ] **Step 2: Add one ownership assertion at the shared upsert boundary**

Add:

```js
function assertOrderOwnedByShop(order, requestedShopId, identity) {
  if (String(order.shopId) === String(requestedShopId)) return;

  throw conflictError('External order is already assigned to another shop', {
    requestedShopId: String(requestedShopId),
    identity,
  });
}
```

Call it immediately after both ways an existing order is obtained:

```js
const recoveredOrder = await orderRepository.findByExternalIdentity(identity);
if (!recoveredOrder) {
  throw conflictError('Duplicate order detected but existing order could not be loaded', {
    identity,
  });
}
assertOrderOwnedByShop(recoveredOrder, dto.shopId, identity);
```

And before the normal update:

```js
assertOrderOwnedByShop(existingOrder, dto.shopId, identity);
const order = await orderRepository.updateFromExternalImport(
  getEntityId(existingOrder),
  buildOrderUpdatePayload(dto, now),
);
```

Do not include the existing owner `shopId` in the error details.

- [ ] **Step 3: Verify Task 3**

Run:

```powershell
npm test -- src/test/order/orderImport.service.test.js src/test/order/models/order.model.test.js --runInBand
```

Expected: same-shop re-import and duplicate recovery pass; cross-shop paths return `409` before any child write; the global unique index test remains unchanged.

- [ ] **Step 4: Commit Task 3 on the feature branch**

```powershell
git add src/modules/order/services/orderImport.service.js src/test/order/orderImport.service.test.js
git commit -m "fix(order): reject cross-shop external identity reuse"
```

### Task 4: Remove raw snapshots from standard DTOs and frontend fallback

**Files:**
- Modify: `src/modules/order/dtos/order.dto.js`
- Modify: `src/modules/order/dtos/orderItem.dto.js`
- Test: `src/test/order/dtos/order.dto.test.js`
- Create: `src/test/order/dtos/orderItem.dto.test.js`
- Modify consumer: `C:/lng_system/lng-web/lng-web-fe/src/features/orders/utils/ordersApi.js`
- Modify consumer test: `C:/lng_system/lng-web/lng-web-fe/src/features/orders/utils/ordersApi.test.js`

**Interfaces:**
- Consumes: existing normalized customization `customerInputs`.
- Produces: standard order/item DTOs with no raw mixed snapshots; frontend color and size derived from normalized customization inputs.

- [ ] **Step 1: Add failing DTO exclusion tests**

Import `toOrderDto` in `order.dto.test.js` and add:

```js
test('standard order DTO excludes raw external data', () => {
  const dto = toOrderDto({
    _id: '660000000000000000000301',
    shopId: '660000000000000000000201',
    externalData: {
      amazon: {
        signedUrl: 'https://secret.example.test/token',
      },
    },
  });

  expect(dto).not.toHaveProperty('externalData');
  expect(JSON.stringify(dto)).not.toContain('secret.example.test');
});
```

Create `orderItem.dto.test.js`:

```js
const { toOrderItemDto } = require('../../../modules/order/dtos/orderItem.dto');

describe('orderItem.dto', () => {
  test('standard item DTO excludes raw variant, customization, and external snapshots', () => {
    const dto = toOrderItemDto({
      _id: '660000000000000000000401',
      orderId: '660000000000000000000301',
      shopId: '660000000000000000000201',
      variantRaw: { Color: 'Sand' },
      customizationRawSummary: {
        customizationUrl: 'https://secret.example.test/customization',
      },
      externalData: {
        amazon: { token: 'secret-token' },
      },
    });

    expect(dto).not.toHaveProperty('variantRaw');
    expect(dto).not.toHaveProperty('customizationRawSummary');
    expect(dto).not.toHaveProperty('externalData');
    expect(JSON.stringify(dto)).not.toContain('secret');
  });
});
```

Run:

```powershell
npm test -- src/test/order/dtos/order.dto.test.js src/test/order/dtos/orderItem.dto.test.js --runInBand
```

Expected: failures because the standard DTOs currently copy the raw fields.

- [ ] **Step 2: Remove only the specified DTO properties**

Delete:

```js
externalData: order.externalData || {},
```

from `toOrderDto()`. Delete:

```js
variantRaw: item.variantRaw,
customizationRawSummary: item.customizationRawSummary,
externalData: item.externalData || {},
```

from `toOrderItemDto()`.

Do not change `toItemPlatform()`, `toOrderExpandedDto()`, or workbench DTO helpers; those already shape specific allowed values.

- [ ] **Step 3: Add the failing frontend contract test**

In `ordersApi.test.js`, change the raw-variant detail fixture to provide normalized inputs:

```js
const detail = mapOrderDetail({
  order: { externalOrderId: '113-9999999-9999999' },
  items: [{ id: 'item-1', title: 'Shirt', quantity: 1 }],
  customizationsByItemId: new Map([[
    'item-1',
    {
      customerInputs: {
        options: [
          { label: 'Color', name: 'color', value: 'Sand' },
          { label: 'Size', name: 'size', value: 'XL' },
        ],
      },
    },
  ]]),
});

assert.equal(detail.customization.shirtColor, 'Sand');
assert.equal(detail.customization.size, 'XL');
```

Add a source contract assertion:

```js
test('order detail mapper does not depend on raw variant payloads', () => {
  assert.equal(mapOrderDetail.toString().includes('variantRaw'), false);
});
```

Run from the frontend:

```powershell
npm test -- src/features/orders/utils/ordersApi.test.js
```

Expected: the source contract fails while `mapOrderDetail()` still reads `variantRaw`.

- [ ] **Step 4: Remove the frontend raw fallback**

Delete `getVariantValue()` if no other caller remains. Change `mapOrderDetail()` to:

```js
const color =
  getCustomerInputValue(customerInputs, ['color', 'colour']) ||
  toDisplayValue(customerInputs.color, ['value', 'label', 'name']) ||
  '-';
const size =
  getCustomerInputValue(customerInputs, ['size']) ||
  toDisplayValue(customerInputs.size, ['value', 'label', 'name']) ||
  '-';
```

Do not add a replacement raw field or parse marketplace payloads in the frontend.

- [ ] **Step 5: Verify Task 4**

Run backend:

```powershell
npm test -- src/test/order/dtos/order.dto.test.js src/test/order/dtos/orderItem.dto.test.js src/test/order/routes/index.test.js --runInBand
```

Run frontend:

```powershell
npm test -- src/features/orders/utils/ordersApi.test.js
npm run build
```

Expected: DTO and route suites pass; frontend utility tests and build pass; standard responses contain none of the removed raw fields.

- [ ] **Step 6: Commit backend and frontend changes separately**

Backend:

```powershell
git add src/modules/order/dtos/order.dto.js src/modules/order/dtos/orderItem.dto.js src/test/order/dtos/order.dto.test.js src/test/order/dtos/orderItem.dto.test.js
git commit -m "fix(order): hide raw snapshots from detail DTOs"
```

Frontend, from `C:/lng_system/lng-web/lng-web-fe`:

```powershell
git add src/features/orders/utils/ordersApi.js src/features/orders/utils/ordersApi.test.js
git commit -m "fix(orders): consume normalized detail fields"
```

### Task 5: Run the security regression gate

**Files:**
- Verify only; no new production file is expected.

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: evidence that scoped import access, identity ownership, DTO redaction, architecture boundaries, and the frontend consumer all remain correct.

- [ ] **Step 1: Run focused backend suites**

```powershell
npm test -- src/test/integration/externalOrderImport src/test/order/orderImport.service.test.js src/test/order/dtos src/test/order/routes/index.test.js --runInBand
```

Expected: all selected suites pass.

- [ ] **Step 2: Run architecture verification**

```powershell
npm run test:architecture -- --runInBand
```

Expected: architecture tests pass; Integration imports Auth only through `auth/public.js`.

- [ ] **Step 3: Run the complete Order suite**

```powershell
npm test -- src/test/order --runInBand
```

Expected: all Order suites pass with no snapshots changed unexpectedly.

- [ ] **Step 4: Run frontend verification**

From `C:/lng_system/lng-web/lng-web-fe`:

```powershell
npm test -- src/features/orders/utils/ordersApi.test.js
npm run lint
npm run build
```

Expected: tests, lint, and production build pass.

- [ ] **Step 5: Inspect final scope and secret risk**

From each changed repository:

```powershell
git status --short
git diff --check
git diff --stat
git diff --cached
```

Expected: only planned files are changed; no `.env`, credentials, signed URLs, tokens, or unrelated user edits are staged.
