# External Order Import Job List API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a paginated, filterable, shop-scoped `GET /external-order-imports` endpoint for the operations dashboard.

**Architecture:** Reuse the existing job repository list query and the service's existing global-versus-shop-scoped authorization helpers. Validate and map HTTP data at the controller boundary; keep route authorization consistent with existing read endpoints.

**Tech Stack:** Node.js, Express, Joi, Mongoose, Jest.

## Global Constraints

- Preserve existing routes, DTOs, status vocabulary, and module boundaries.
- Do not add dependencies, schema fields, indexes, aggregation pipelines, date filters, search, or custom sorting.
- Use TDD and commit each independently reviewable task.
- Keep frontend implementation outside this plan.

---

## File Structure

- Modify `src/test/integration/externalOrderImport/services/externalOrderImport.service.test.js`: authorization and filtering behavior.
- Modify `src/modules/integration/externalOrderImport/services/externalOrderImport.service.js`: `listImportJobs(params, authContext)`.
- Modify `src/test/integration/externalOrderImport/controllers/externalOrderImport.controller.test.js`: validated query forwarding and pagination DTO.
- Modify `src/test/integration/externalOrderImport/routes/externalOrderImport.routes.test.js`: root list route and permission behavior.
- Modify `src/modules/integration/externalOrderImport/validators/externalOrderImport.validator.js`: `jobListQuerySchema`.
- Modify `src/modules/integration/externalOrderImport/controllers/externalOrderImport.controller.js`: `listImportJobs` controller.
- Modify `src/modules/integration/externalOrderImport/routes/externalOrderImport.routes.js`: `GET /` registration.

### Task 1: Shop-Scoped Job Listing Service

**Files:**
- Modify: `src/test/integration/externalOrderImport/services/externalOrderImport.service.test.js`
- Modify: `src/modules/integration/externalOrderImport/services/externalOrderImport.service.js`

**Interfaces:**
- Consumes: `jobRepository.list(filters)` and existing `getReadableShopIds(authContext)`/`emptyPage(params)` behavior.
- Produces: `listImportJobs(params = {}, authContext = {}) -> Promise<{items,total,page,limit}>`.

- [ ] **Step 1: Write failing service tests**

Add `list: jest.fn()` to the job repository mock and reset it to an empty page in `beforeEach`. Add four tests with literal expected filters:

```js
test('lists jobs without shop constraints for a global reader', async () => {
  await service.listImportJobs(
    { status: 'FAILED', page: 1, limit: 20 },
    { permissions: ['ORDERS:READ'] },
  );

  expect(jobRepository.list).toHaveBeenCalledWith({ status: 'FAILED', page: 1, limit: 20 });
});

test('limits job listing to readable shops for a scoped reader', async () => {
  await service.listImportJobs(
    { source: 'MANUAL_EXCEL', page: 2, limit: 10 },
    { scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['ORDERS:READ'] }] },
  );

  expect(jobRepository.list).toHaveBeenCalledWith({
    source: 'MANUAL_EXCEL',
    page: 2,
    limit: 10,
    shopIds: [shopId],
  });
});
```

Also assert that an explicit foreign `shopId` and a caller with no readable shops both receive `{ items: [], total: 0, page, limit }` without calling `jobRepository.list`.

- [ ] **Step 2: Run focused tests and verify RED**

```powershell
$env:MONGODB_URI='mongodb://127.0.0.1:27017/lng_web_test'
npx jest --runInBand src/test/integration/externalOrderImport/services/externalOrderImport.service.test.js -t "list.*jobs|job listing|foreign shop|no readable shops"
```

Expected: FAIL because `service.listImportJobs` does not exist.

- [ ] **Step 3: Implement the minimum service method**

Add:

```js
async function listImportJobs(params = {}, authContext = {}) {
  const shopIds = getReadableShopIds(authContext);
  if (shopIds === null) return jobRepository.list(params);
  if (shopIds.length === 0) return emptyPage(params);

  if (params.shopId) {
    if (!shopIds.includes(String(params.shopId))) return emptyPage(params);
    return jobRepository.list(params);
  }

  return jobRepository.list({ ...params, shopIds });
}
```

Export `listImportJobs`. Do not create a second authorization helper.

- [ ] **Step 4: Run the complete service test file and verify GREEN**

```powershell
$env:MONGODB_URI='mongodb://127.0.0.1:27017/lng_web_test'
npx jest --runInBand src/test/integration/externalOrderImport/services/externalOrderImport.service.test.js
```

Expected: all service tests pass.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/integration/externalOrderImport/services/externalOrderImport.service.js src/test/integration/externalOrderImport/services/externalOrderImport.service.test.js
git commit -m "feat(integration): list scoped import jobs"
```

### Task 2: HTTP Job List Contract

**Files:**
- Modify: `src/test/integration/externalOrderImport/controllers/externalOrderImport.controller.test.js`
- Modify: `src/test/integration/externalOrderImport/routes/externalOrderImport.routes.test.js`
- Modify: `src/modules/integration/externalOrderImport/validators/externalOrderImport.validator.js`
- Modify: `src/modules/integration/externalOrderImport/controllers/externalOrderImport.controller.js`
- Modify: `src/modules/integration/externalOrderImport/routes/externalOrderImport.routes.js`

**Interfaces:**
- Consumes: `service.listImportJobs(query, auth)` and existing `toPaginatedDto`/`toImportJobDto`.
- Produces: authenticated `GET /external-order-imports` with `{ success: true, data: { items, pagination } }`.

- [ ] **Step 1: Write the failing controller test**

Add `listImportJobs: jest.fn()` to the service mock and test:

```js
test('lists import jobs with validated filters', async () => {
  service.listImportJobs.mockResolvedValue({
    items: [{ _id: '660000000000000000000601', status: 'FAILED', shopId: '660000000000000000000201' }],
    total: 1,
    page: 2,
    limit: 10,
  });
  const req = {
    auth: { permissions: ['ORDERS:READ'] },
    query: { page: '2', limit: '10', status: 'failed', source: 'manual_excel' },
  };
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

  await controller.listImportJobs(req, res);

  expect(service.listImportJobs).toHaveBeenCalledWith({
    page: 2,
    limit: 10,
    status: 'FAILED',
    source: 'MANUAL_EXCEL',
  }, req.auth);
  expect(res.json.mock.calls[0][0].data).toMatchObject({
    items: [{ id: '660000000000000000000601', status: 'FAILED' }],
    pagination: { total: 1, page: 2, limit: 10 },
  });
});
```

- [ ] **Step 2: Write failing route tests**

Add `listImportJobs: jest.fn()` to the route service mock. Assert `GET /?status=FAILED` returns 200 for scoped `ORDERS:WRITE` and calls `service.listImportJobs`. Add an invalid query test for `GET /?status=NOT_A_STATUS` expecting 400 and no service call.

- [ ] **Step 3: Run controller and route tests and verify RED**

```powershell
$env:MONGODB_URI='mongodb://127.0.0.1:27017/lng_web_test'
npx jest --runInBand src/test/integration/externalOrderImport/controllers/externalOrderImport.controller.test.js src/test/integration/externalOrderImport/routes/externalOrderImport.routes.test.js
```

Expected: FAIL because the controller method and root route do not exist.

- [ ] **Step 4: Add the job-list query schema**

Import `externalOrderImportSourceTypes` and `externalOrderImportJobStatuses`, then add:

```js
const jobListQuerySchema = paginationQuerySchema.keys({
  status: Joi.string().trim().uppercase().valid(...Object.values(externalOrderImportJobStatuses)),
  shopId: objectIdSchema,
  source: Joi.string().trim().uppercase().valid(...Object.values(externalOrderImportSources)),
  sourceType: Joi.string().trim().uppercase().valid(...Object.values(externalOrderImportSourceTypes)),
});
```

Export `jobListQuerySchema`.

- [ ] **Step 5: Add controller and route**

Controller:

```js
async function listImportJobs(req, res) {
  const query = assertValid(jobListQuerySchema, req.query);
  const result = await service.listImportJobs(query, req.auth);
  res.status(httpStatus.OK).json({ success: true, data: toPaginatedDto(result, toImportJobDto) });
}
```

Export it and register this route before `/:jobId` routes:

```js
router.get('/', authPublic.authenticate, requireOrderRead, asyncHandler(controller.listImportJobs));
```

- [ ] **Step 6: Run focused controller and route tests and verify GREEN**

Run the command from Step 3. Expected: all controller and route tests pass.

- [ ] **Step 7: Commit**

```powershell
git add src/modules/integration/externalOrderImport/validators/externalOrderImport.validator.js src/modules/integration/externalOrderImport/controllers/externalOrderImport.controller.js src/modules/integration/externalOrderImport/routes/externalOrderImport.routes.js src/test/integration/externalOrderImport/controllers/externalOrderImport.controller.test.js src/test/integration/externalOrderImport/routes/externalOrderImport.routes.test.js
git commit -m "feat(integration): expose import job list API"
```

### Task 3: Regression Verification

**Files:**
- Verify only; no expected source changes.

**Interfaces:**
- Consumes: Tasks 1 and 2.
- Produces: fresh test and branch-scope evidence.

- [ ] **Step 1: Check diff hygiene**

```powershell
git diff origin/develop...HEAD --check
git status --short
```

- [ ] **Step 2: Run external-order, Integration, and architecture tests**

```powershell
$env:MONGODB_URI='mongodb://127.0.0.1:27017/lng_web_test'
npx jest --runInBand src/test/integration/externalOrderImport
npx jest --runInBand src/test/integration
npm run test:architecture -- --runInBand
```

Expected: zero failed tests.

- [ ] **Step 3: Run full backend regression**

```powershell
$env:MONGODB_URI='mongodb://127.0.0.1:27017/lng_web_test'
npm test -- --runInBand
```

Expected: zero failed suites and tests; intentional skips remain skips.

- [ ] **Step 4: Inspect final branch scope**

```powershell
git log --oneline origin/develop..HEAD
git diff --stat origin/develop...HEAD
git status --short --branch
```

Expected: a clean worktree containing the approved edge-case fixes and job-list API only.
