# ListingLaunch Phase 1 Implementation Plan

## Execution notes (2026-09-15)

Implementation branch: `EC/listing-launch-phase-1`. Scope is backend API only; frontend is not included in this plan.

Execution completed locally: Tasks 1–4 delivered as one reviewed feature commit. The original task checklist below is retained as the planning record, not an outstanding execution queue.

- [x] Persistence and real Mongo conditional-selection test.
- [x] Shop-scoped service and DTO; active/expired/future permission coverage.
- [x] Five authenticated HTTP routes, strict input validation, actual application mount coverage.
- [x] Module architecture checks, API docs, Catalog/Auth regression verification.

Final verification: `node node_modules/jest/bin/jest.js tests/listingLaunch tests/catalog tests/auth tests/architecture/architecture.contract.test.js --runInBand --silent` — 53 suites / 445 tests passed; 1 existing suite / 12 tests skipped. All changed runtime JS syntax checks and staged diff whitespace checks passed. Real Mongo tests use ephemeral databases. No production data or deployment was changed.

- Preserve intentional duplicate Catalog SKUs. The earlier conversational recommendation to deduplicate/add uniqueness is withdrawn.
- Tasks 1–3 share one small aggregate and are implemented as one integration unit with model/repository/service/HTTP tests.
- Use an atomic conditional `BRIEF` selection update, rather than unguarded read-then-write, to make the select-once contract true during concurrent requests.
- Match the no-state list index to the actual `updatedAt, _id` sort (replace the proposed `createdAt` index); keep the state-filtered compound index.
- Local controller validation must not import Catalog internals. Reject unknown fields rather than silently accepting identity/state/actor input.
- Reference asset IDs remain inert draft references: bound and validate ObjectId shape only (maximum 50 distinct IDs). Any future consumer must validate Media access/readiness before use.
- Include `public.js` and `publicPort` to satisfy the repository module contract; no cross-module launch mutation is exposed in P1.
- Architecture checks resolve relative imports and exercise a forbidden-import fixture; the original plan regex missed real `../../catalog/...` imports.
- Do not relabel all existing Catalog rows as reconciled marketplace records. Existing manual Catalog drafts and order-import paths remain unchanged.
- Verification and API details are recorded in `docs/listingLaunch/PHASE_1_API.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a shop-scoped, Amazon-only `ListingLaunch` draft workspace where users can create a candidate, select its internal product/template configuration, and save the brief before any AI generation, Amazon export, or Catalog Listing write occurs.

**Architecture:** Add `listingLaunch` as a new module, independent of `catalog`. It owns unpublished candidate data and calls Catalog only through `catalog/public.js` to validate the selected active `ProductTypeGroup` and compatible `InternalTemplate`. `Listing` and `ListingVariant` remain canonical post-import marketplace/production records and must not be created or changed by Phase 1.

**Tech Stack:** Node.js, Express, CommonJS, MongoDB/Mongoose, Joi, Jest.

**Spec:** The approved conversation design: manual Amazon import; Phase 1 covers only `BRIEF -> PRODUCT_SELECTED`; AI, image generation, Amazon template parsing, export, Processing Report import, queues, and Amazon APIs are intentionally out of scope.

## Global Constraints

- Add no Amazon credentials, SP-API client, publishing endpoint, worker, queue, or background job.
- Reuse `CATALOG:READ` / `CATALOG:WRITE` with existing shop-scoped Auth RBAC; do not add a new role or permission in this phase.
- Persist only Media asset IDs, never binary files, local paths, provider keys, prompts, or generated content.
- `ListingLaunch` must import Catalog only through `src/modules/catalog/public.js`.
- Do not create or update `Listing`, `ListingVariant`, `DesignTask`, or Media assets in this phase.
- The only accepted channel is `AMAZON`; `marketplaceCode` remains an explicit string such as `AMAZON_US`.
- Internal Catalog SKU may duplicate. Do not add an SKU uniqueness index or infer an Amazon seller SKU in this phase.

---

## File Structure

- Create `src/modules/listingLaunch/`: isolated unpublished launch aggregate.
- Create `src/modules/listingLaunch/models/listingLaunch.model.js`: Mongoose schema and indexes.
- Create `src/modules/listingLaunch/constants/listingLaunch.constants.js`: allowed state and channel values.
- Create `src/modules/listingLaunch/repositories/listingLaunch.repository.js`: lean read queries and writes.
- Create `src/modules/listingLaunch/services/listingLaunch.service.js`: state transitions, Catalog public-port checks, and scoped authorization.
- Create `src/modules/listingLaunch/services/listingLaunchAccess.helpers.js`: local `CATALOG:*` shop-scope checks using Auth public port; do not import Catalog internals.
- Create `src/modules/listingLaunch/validators/listingLaunch.validator.js`: Joi HTTP payload/query contracts.
- Create `src/modules/listingLaunch/controllers/listingLaunch.controller.js`: validation and HTTP response status only.
- Create `src/modules/listingLaunch/dtos/listingLaunch.dto.js`: response shaping without raw Mongo documents.
- Create `src/modules/listingLaunch/routes/index.js` and `src/modules/listingLaunch/index.js`: module route mount.
- Modify `src/modules/index.js`: mount the module at `/listing-launches`.
- Modify `docs/architecture/MODULE_BOUNDARIES.md`: document ownership and the one allowed Catalog public-port dependency.
- Create model, service, repository, route, DTO, and architecture tests under `tests/listingLaunch/`.

## Contract

`ListingLaunch` document fields:

```js
{
  shopId: ObjectId,                 // required
  salesChannelCode: 'AMAZON',       // required, immutable after creation
  marketplaceCode: String,          // required, uppercase, immutable after creation
  brief: String,                    // required on creation, max 5000
  workingTitle: String | null,      // operator label, max 500
  productTypeGroupId: ObjectId | null,
  internalTemplateId: ObjectId | null,
  referenceAssetIds: [ObjectId],    // optional existing Media references only; no validation in P1
  state: 'BRIEF' | 'PRODUCT_SELECTED',
  selectedBy: ObjectId | null,
  selectedAt: Date | null,
  createdBy: ObjectId | null,
  timestamps: true
}
```

State rules:

```text
POST /listing-launches                 -> BRIEF
POST /:id/select-product               -> PRODUCT_SELECTED
PATCH /:id while BRIEF                 -> change brief, workingTitle, referenceAssetIds
PATCH /:id while PRODUCT_SELECTED      -> change brief, workingTitle, referenceAssetIds only
POST /:id/select-product again         -> conflict
```

`select-product` body is exactly:

```json
{
  "productTypeGroupId": "24-hex-object-id",
  "internalTemplateId": "24-hex-object-id"
}
```

Both IDs are mandatory at selection. The service must call `catalogPublic.getProductTypeGroupById(productTypeGroupId)` and `catalogPublic.getInternalTemplateById(internalTemplateId)`, reject missing/inactive records, and reject a template whose `productTypeGroupId` differs from the selected group.

### Task 1: Establish the Module Boundary and Schema

**Files:**
- Create: `src/modules/listingLaunch/constants/listingLaunch.constants.js`
- Create: `src/modules/listingLaunch/models/listingLaunch.model.js`
- Create: `src/modules/listingLaunch/repositories/listingLaunch.repository.js`
- Create: `tests/listingLaunch/models/listingLaunch.model.test.js`
- Create: `tests/listingLaunch/repositories/listingLaunch.repository.test.js`

**Interfaces:**
- Produces `ListingLaunch` with `BRIEF` and `PRODUCT_SELECTED` states.
- Produces repository functions `create(payload)`, `findById(id)`, `list({ shopIds, shopId, state, page, limit })`, and `update(id, patch)`.

- [ ] **Step 1: Write model tests for defaults, enums, and indexes**

```js
expect(schema.path('salesChannelCode').enumValues).toEqual(['AMAZON']);
expect(schema.path('state').enumValues).toEqual(['BRIEF', 'PRODUCT_SELECTED']);
expect(schema.indexes()).toEqual(expect.arrayContaining([
  [{ shopId: 1, state: 1, updatedAt: -1, _id: -1 }, {}],
]));
```

- [ ] **Step 2: Run the model test to verify it fails**

Run: `npx jest tests/listingLaunch/models/listingLaunch.model.test.js --runInBand`

Expected: FAIL because the ListingLaunch model does not exist.

- [ ] **Step 3: Add the minimal constants and Mongoose schema**

Create the state constants, require `shopId`, `salesChannelCode`, `marketplaceCode`, and `brief`, and add `{ shopId: 1, state: 1, updatedAt: -1, _id: -1 }` plus `{ shopId: 1, createdAt: -1, _id: -1 }` indexes. Do not add an `amazonSellerSku`, content payload, template spreadsheet, or export fields.

- [ ] **Step 4: Write repository tests**

```js
await ListingLaunch.create({ shopId, salesChannelCode: 'AMAZON', marketplaceCode: 'AMAZON_US', brief: 'test' });
const result = await repository.list({ shopId, state: 'BRIEF', page: 1, limit: 20 });
expect(result.items).toHaveLength(1);
expect(result.items[0]).not.toHaveProperty('$__');
```

- [ ] **Step 5: Implement lean repository reads and verify tests pass**

Run: `npx jest tests/listingLaunch/models/listingLaunch.model.test.js tests/listingLaunch/repositories/listingLaunch.repository.test.js --runInBand`

Expected: PASS.

- [ ] **Step 6: Commit the self-contained persistence layer**

```powershell
git add src/modules/listingLaunch tests/listingLaunch
git commit -m "feat(listing-launch): add draft launch persistence"
```

### Task 2: Implement Scoped Draft and Product-Selection Service

**Files:**
- Create: `src/modules/listingLaunch/services/listingLaunchAccess.helpers.js`
- Create: `src/modules/listingLaunch/services/listingLaunch.service.js`
- Create: `src/modules/listingLaunch/dtos/listingLaunch.dto.js`
- Create: `tests/listingLaunch/services/listingLaunch.service.test.js`

**Interfaces:**
- Consumes repository functions from Task 1 and `catalog/public.js`.
- Produces `createListingLaunch(payload, auth)`, `listListingLaunches(query, auth)`, `getListingLaunch(id, auth)`, `updateListingLaunch(id, patch, auth)`, and `selectProduct(id, payload, auth)`.

- [ ] **Step 1: Write the failing service tests**

```js
await expect(service.selectProduct(launchId, { productTypeGroupId, internalTemplateId }, writeAuth))
  .resolves.toMatchObject({ state: 'PRODUCT_SELECTED', productTypeGroupId, internalTemplateId });

expect(catalogPublic.getProductTypeGroupById).toHaveBeenCalledWith(productTypeGroupId);
expect(catalogPublic.getInternalTemplateById).toHaveBeenCalledWith(internalTemplateId);

await expect(service.selectProduct(launchId, { productTypeGroupId, internalTemplateId }, writeAuth))
  .rejects.toMatchObject({ statusCode: 409 });
```

Also test: no shop scope returns `403`; list filters to readable shop IDs; an inactive/missing group or template produces a controlled error; a mismatched template/group produces `409`; service never calls a Catalog create/update port.

- [ ] **Step 2: Run the service test to verify it fails**

Run: `npx jest tests/listingLaunch/services/listingLaunch.service.test.js --runInBand`

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement local access enforcement and state transition**

Use `authPublic.canAccessScope()` with `{ scopeType: 'shop', scopeId: shopId }`, allowing `CATALOG:WRITE` to satisfy `CATALOG:READ`, matching Catalog behavior without importing `catalogAccess.helpers.js`. Validate Catalog selection only through `catalog/public.js`; set `selectedBy` from `auth.accountId`, `selectedAt` to `new Date()`, and state to `PRODUCT_SELECTED` in the same update.

- [ ] **Step 4: Shape only DTO responses and verify tests pass**

Run: `npx jest tests/listingLaunch/services/listingLaunch.service.test.js --runInBand`

Expected: PASS. Responses contain IDs, brief, workingTitle, referenceAssetIds, selected product/template IDs, state, and timestamps; never return raw Mongoose documents.

- [ ] **Step 5: Commit the service layer**

```powershell
git add src/modules/listingLaunch tests/listingLaunch
git commit -m "feat(listing-launch): add scoped product selection"
```

### Task 3: Expose the HTTP Contract

**Files:**
- Create: `src/modules/listingLaunch/validators/listingLaunch.validator.js`
- Create: `src/modules/listingLaunch/controllers/listingLaunch.controller.js`
- Create: `src/modules/listingLaunch/routes/index.js`
- Create: `src/modules/listingLaunch/index.js`
- Modify: `src/modules/index.js`
- Create: `tests/listingLaunch/routes/index.test.js`

**Interfaces:**
- Consumes Task 2 service methods.
- Produces authenticated REST endpoints at `/api/listing-launches`.

- [ ] **Step 1: Write route tests for the exact endpoints**

```js
await request(app).post('/api/listing-launches')
  .set('Authorization', bearer)
  .send({ shopId, marketplaceCode: 'amazon_us', brief: 'Create a floral tee collection' })
  .expect(201)
  .expect(({ body }) => expect(body.data).toMatchObject({ salesChannelCode: 'AMAZON', state: 'BRIEF' }));

await request(app).post(`/api/listing-launches/${launchId}/select-product`)
  .set('Authorization', bearer)
  .send({ productTypeGroupId, internalTemplateId })
  .expect(200);
```

Test `GET /`, `GET /:id`, `PATCH /:id`, validation rejection for a non-Amazon channel, absent brief, and absent selection IDs, plus `401` without authentication and `403` without shop permission.

- [ ] **Step 2: Run the route test to verify it fails**

Run: `npx jest tests/listingLaunch/routes/index.test.js --runInBand`

Expected: FAIL with route not found.

- [ ] **Step 3: Add validators, thin controllers, and routes**

Implement only these endpoints:

```text
GET   /api/listing-launches
POST  /api/listing-launches
GET   /api/listing-launches/:id
PATCH /api/listing-launches/:id
POST  /api/listing-launches/:id/select-product
```

Use `asyncHandler`, `assertValid`, existing `authPublic.authenticate`, and `authPublic.authorizeAnyPermission('CATALOG:READ', 'CATALOG:WRITE')` for reads / `CATALOG:WRITE` for writes. Mount through `src/modules/index.js`; do not add an endpoint under `/api/catalog`.

- [ ] **Step 4: Run route tests and syntax checks**

Run:

```powershell
npx jest tests/listingLaunch/routes/index.test.js --runInBand
Get-ChildItem -Path src/modules/listingLaunch -Recurse -Filter *.js | ForEach-Object { node -c $_.FullName }
```

Expected: PASS and no syntax output.

- [ ] **Step 5: Commit the HTTP surface**

```powershell
git add src/modules/index.js src/modules/listingLaunch tests/listingLaunch
git commit -m "feat(listing-launch): expose draft routes"
```

### Task 4: Document the Boundary and Run Regression Gates

**Files:**
- Modify: `docs/architecture/MODULE_BOUNDARIES.md`
- Modify: `docs/architecture/CATALOG_MODULE.md`
- Create: `tests/listingLaunch/architecture/listingLaunch.architecture.test.js`

**Interfaces:**
- Documents `ListingLaunch` as the sole owner of unpublished Amazon candidate state.
- Asserts it never imports Catalog internals.

- [ ] **Step 1: Write the failing architecture test**

```js
expect(readModuleFiles('src/modules/listingLaunch'))
  .not.toMatch(/modules\/catalog\/(models|repositories|services|controllers|validators|routes|dtos)/);
expect(readModuleFiles('src/modules/listingLaunch'))
  .not.toMatch(/SP-API|amazon.*publish/i);
```

- [ ] **Step 2: Run it to verify the test protects the boundary**

Run: `npx jest tests/listingLaunch/architecture/listingLaunch.architecture.test.js --runInBand`

Expected: PASS once the initial implementation follows the boundary; then intentionally add a temporary forbidden import locally to confirm the assertion fails, remove it, and rerun.

- [ ] **Step 3: Update architecture docs**

Document: Launch owns draft/selection state only; Catalog owns only reconciled Listing/ListingVariant; launch calls `catalog/public.js`; Phase 1 has no AI, design, export, Amazon API, or processing-report integration.

- [ ] **Step 4: Run focused and architecture gates**

Run:

```powershell
npx jest tests/listingLaunch tests/catalog --runInBand
npm run test:architecture -- --runInBand
git diff --check
```

Expected: all selected tests pass, architecture gate passes, and `git diff --check` produces no output.

- [ ] **Step 5: Commit documentation and verification coverage**

```powershell
git add docs/architecture tests/listingLaunch
git commit -m "docs(listing-launch): define phase one boundary"
```

## Acceptance Criteria

- An authorized user can create, list, read, and edit an Amazon-only shop-scoped launch draft.
- An authorized user can select exactly one active Catalog product group and a compatible active internal template once.
- Every read and write enforces the launch shop scope.
- No Catalog Listing, ListingVariant, DesignTask, Media asset, Amazon file, AI request, provider key, queue, or marketplace request is created.
- DTOs hide raw documents and all repositories use `.lean()` for reads.
- Focused launch tests, Catalog regression tests, architecture tests, syntax checks, and `git diff --check` pass.
