# Full API and Postman Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver complete module-by-module API references and runnable Postman collections for every public LNG Web backend endpoint.

**Architecture:** Treat Express routes, validators, controllers, DTOs, services, and tests as the authoritative contract. Generate a deterministic route inventory, maintain human-readable module Markdown plus importable module collections, and validate that every mounted route is represented exactly once.

**Tech Stack:** Node.js, CommonJS, Express route metadata, JSON Postman Collection v2.1, Jest, existing Markdown docs.

## Global Constraints

- Runtime code wins when existing documentation conflicts with implementation.
- Every endpoint includes method, `/api` path, permissions, params/query/body, success response, operational errors, and lifecycle notes.
- Every module batch ships Markdown and Postman artifacts together.
- No live tokens, passwords, credentials, customer PII, filesystem paths, or provider secrets.
- Destructive/vendor-submit/payroll-write requests are excluded from default collection runs.
- Do not change API behavior merely to simplify documentation.
- Run narrow validation per batch and the full backend suite only at final completion.

---

### Task 1: Route inventory and Postman foundation

**Files:**
- Create: `src/scripts/apiContract/routeInventory.js`
- Create: `src/scripts/apiContract/validateApiContracts.js`
- Create: `src/test/scripts/apiContract/routeInventory.test.js`
- Create: `src/test/scripts/apiContract/validateApiContracts.test.js`
- Create: `docs/api/README.md`
- Create: `docs/api/postman/local.postman_environment.json`
- Create: `docs/api/postman/development.postman_environment.json`
- Create: `docs/api/postman/contract-exclusions.json`
- Modify: `package.json`

**Interfaces:**
- Produces: `buildRouteInventory() -> Array<{ module, method, path, authenticated, permissions }>`.
- Produces: `validateApiContracts({ inventory, collections, exclusions }) -> { missing, unknown, duplicates, missingVariables }`.
- Commands: `npm run api:inventory` and `npm run api:contracts:check`.

- [ ] **Step 1: Write failing inventory tests**

Assert that inventory includes these representative routes with exact metadata:

```js
expect(inventory).toEqual(expect.arrayContaining([
  expect.objectContaining({ module: 'catalog', method: 'POST', path: '/api/catalog/listings/:id/variants/:variantId/request-psd', authenticated: true, permissions: ['CATALOG:WRITE'] }),
  expect.objectContaining({ module: 'production', method: 'PATCH', path: '/api/production/tasks/:taskId/qc', authenticated: true, permissions: ['PRODUCTION:WRITE', 'DESIGN:REVIEW'] }),
]));
```

- [ ] **Step 2: Run inventory tests and verify RED**

Run: `npx jest src/test/scripts/apiContract/routeInventory.test.js --runInBand`

Expected: FAIL because the inventory module does not exist.

- [ ] **Step 3: Implement deterministic route inventory**

Walk mounted routers from `src/modules/index.js`, normalize Express route paths under `/api`, extract method plus known auth/permission middleware names, sort by module/path/method, and output JSON. Do not start the HTTP server or connect to MongoDB.

- [ ] **Step 4: Write and implement contract validation tests**

Tests must reject:

```text
missing route request
unknown Postman request
duplicate method/path
unresolved {{variable}}
invalid Postman JSON
unapproved exclusion
```

- [ ] **Step 5: Add shared Postman environments and README**

Environment values must be empty except safe defaults such as:

```json
{
  "key": "baseUrl",
  "value": "http://localhost:3000",
  "enabled": true
}
```

Document import, login/token capture, variable conventions, file selection, safe collection running, and disabled mutation folders.

- [ ] **Step 6: Add package commands and verify**

```json
"api:inventory": "node src/scripts/apiContract/routeInventory.js",
"api:contracts:check": "node src/scripts/apiContract/validateApiContracts.js"
```

Run:

```powershell
node -c src/scripts/apiContract/routeInventory.js
node -c src/scripts/apiContract/validateApiContracts.js
npx jest src/test/scripts/apiContract --runInBand
```

- [ ] **Step 7: Commit**

```powershell
git add package.json src/scripts/apiContract src/test/scripts/apiContract docs/api
git commit -m "feat(api-docs): add route contract foundation"
```

### Task 2: Access modules contract batch

**Files:**
- Update/Create: `docs/auth/AUTH_RBAC_API.md`
- Update/Create: `docs/shop/SHOP_API.md`
- Update/Create: `docs/organization/ORGANIZATION_API.md`
- Update/Create: `docs/hr/HR_API.md`
- Create: `docs/api/postman/auth.postman_collection.json`
- Create: `docs/api/postman/shop.postman_collection.json`
- Create: `docs/api/postman/organization.postman_collection.json`
- Create: `docs/api/postman/hr.postman_collection.json`

**Interfaces:**
- Consumes: route inventory and shared variables.
- Produces: exact coverage for modules mounted at `/api/auth`, `/api/shops`, `/api/organization`, and `/api/hr` including `/api/hr/integrations` ownership notes.

- [ ] **Step 1: Capture batch inventory**

Run `npm run api:inventory` and filter modules `auth`, `shop`, `organization`, `hr`. Record every route before editing docs.

- [ ] **Step 2: Audit each endpoint against validators/controllers/DTOs/tests**

For every inventory row, record authentication, permission middleware, path/query/body schema, controller status, response envelope, and service errors. Login must capture `accessToken`; no password is stored.

- [ ] **Step 3: Write Markdown contracts**

Use a consistent endpoint template:

```markdown
### POST `/api/auth/login`
Permission: Public
Body: field table plus JSON example
Success: HTTP status plus DTO JSON
Errors: status/code/trigger table
```

- [ ] **Step 4: Create Postman collections**

Use Collection v2.1. Inherit `{{baseUrl}}`; protected requests inherit Bearer `{{accessToken}}`. Put destructive/account lifecycle and payroll mutations in folders named `Manual - Mutations`.

- [ ] **Step 5: Validate batch**

Run:

```powershell
npm run api:contracts:check
npx jest src/test/auth src/test/shop src/test/organization src/test/hr/routes --runInBand
```

- [ ] **Step 6: Commit**

```powershell
git add docs/auth docs/shop docs/organization docs/hr docs/api/postman
git commit -m "docs(api): document access modules for Postman"
```

### Task 3: Setup modules contract batch

**Files:**
- Update: `docs/catalog/CATALOG_API.md`
- Update: `docs/mapping/MAPPING_API.md`
- Update: `docs/vendor/VENDOR_API.md`
- Update: `docs/media/MEDIA_API.md`
- Create: `docs/api/postman/catalog.postman_collection.json`
- Create: `docs/api/postman/mapping.postman_collection.json`
- Create: `docs/api/postman/vendor.postman_collection.json`
- Create: `docs/api/postman/media.postman_collection.json`

**Interfaces:**
- Produces: complete setup contracts including ListingVariant CRUD/default/request-PSD, FulfillmentPlan recheck/manual selection, vendor hierarchy/cost centers, and multipart Media upload/download.

- [ ] **Step 1: Audit route/validator/DTO/test sources for all four modules**

Explicitly correct stale Listing legacy fields and document these current routes:

```text
GET/POST /api/catalog/listings/:id/variants
PATCH /api/catalog/listings/:id/variants/:variantId
POST /api/catalog/listings/:id/variants/:variantId/default
POST /api/catalog/listings/:id/variants/:variantId/request-psd
```

- [ ] **Step 2: Write request/response/error examples**

Include Product Type normalization, exact Variant selection, missing-template/PSD readiness, mapping blockers, vendor candidate selection, pagination, multipart limits, and binary/download responses.

- [ ] **Step 3: Build Postman workflows**

Provide safe folders for listing/variant reads and explicit manual folders for create/update/default/request-PSD, mapping resolve/select, vendor mutations, and file uploads. Capture `listingId`, `listingVariantId`, `productTypeGroupId`, `fulfillmentPlanId`, `vendorId`, and media IDs.

- [ ] **Step 4: Validate batch**

```powershell
npm run api:contracts:check
npx jest src/test/catalog src/test/mapping src/test/vendor src/test/media --runInBand
```

- [ ] **Step 5: Commit**

```powershell
git add docs/catalog docs/mapping docs/vendor docs/media docs/api/postman
git commit -m "docs(api): document setup modules for Postman"
```

### Task 4: Order ingestion and customization contract batch

**Files:**
- Update: `docs/order/ORDER_API.md`
- Update: `docs/customization/CUSTOMIZATION_API.md`
- Update: `docs/integration/EXTERNAL_ORDER_IMPORT_API.md`
- Create: `docs/api/postman/order.postman_collection.json`
- Create: `docs/api/postman/customization.postman_collection.json`
- Create: `docs/api/postman/integration.postman_collection.json`

**Interfaces:**
- Produces: import-to-normalized-order contracts for Amazon extension report and manual Excel without SP-API terminology.

- [ ] **Step 1: Audit all mounted Order, Customization, and Integration routes**

Separate JSON, Excel/multipart, export/download, queue/recovery, case/timeline, and manual status actions.

- [ ] **Step 2: Document exact import bodies and responses**

Include source type, shop context, multipart keys, accepted file constraints, job/raw-record/issue DTOs, idempotency behavior, customization parse/review/retry states, and order/item lifecycle errors.

- [ ] **Step 3: Build Postman collections**

Default safe run may list/read jobs, orders, and customization only. Imports, retry, cancel, and lifecycle mutations live under clearly marked manual folders.

- [ ] **Step 4: Validate batch**

```powershell
npm run api:contracts:check
npx jest src/test/order src/test/customization src/test/integration/externalOrderImport --runInBand
```

- [ ] **Step 5: Commit**

```powershell
git add docs/order docs/customization docs/integration docs/api/postman
git commit -m "docs(api): document order ingestion modules for Postman"
```

### Task 5: Fulfillment contract batch

**Files:**
- Update: `docs/design/DESIGN_API.md`
- Update: `docs/production/PRODUCTION_API.md`
- Update: `docs/vendorSubmission/VENDOR_SUBMISSION_API.md`
- Update: `docs/shipment/SHIPMENT_API.md`
- Create: `docs/api/postman/design.postman_collection.json`
- Create: `docs/api/postman/production.postman_collection.json`
- Create: `docs/api/postman/vendorSubmission.postman_collection.json`
- Create: `docs/api/postman/shipment.postman_collection.json`

**Interfaces:**
- Produces: manual PSD request, designer submission/approval, Production file/QC workflow, vendor submission/retry, and shipment tracking contracts.

- [ ] **Step 1: Correct stale Design and Production workflow text**

Remove all claims that missing PSD automatically creates DesignTask. Document Catalog Variant `request-psd` as the staff entrypoint and Design task APIs as the execution/review workflow.

- [ ] **Step 2: Document all fulfillment endpoint contracts**

Include assignment permissions, file-check inputs, multipart fields, QC per-file decisions, blockers, concurrency/terminal conflicts, payload previews, dry-run vs live vendor submit, failure/retry/quarantine, webhook normalization, and tracking recheck.

- [ ] **Step 3: Build Postman workflows with safety boundaries**

Read/preview requests may run safely. Upload, QC, live vendor submit, retry, webhook simulation, shipment mutation, and bulk actions must be placed under `Manual - Mutations`; live vendor submit is disabled by default.

- [ ] **Step 4: Validate batch**

```powershell
npm run api:contracts:check
npx jest src/test/design src/test/production src/test/vendorSubmission src/test/shipment src/test/e2e/orderFulfillmentFlow.e2e.test.js --runInBand
```

- [ ] **Step 5: Commit**

```powershell
git add docs/design docs/production docs/vendorSubmission docs/shipment docs/api/postman
git commit -m "docs(api): document fulfillment modules for Postman"
```

### Task 6: Finance and support modules contract batch

**Files:**
- Update: `docs/finance/FINANCE_API.md`
- Update: `docs/report/REPORT_API.md`
- Create: `docs/audit/AUDIT_API.md`
- Create: `docs/notification/NOTIFICATION_API.md`
- Create: `docs/workScore/WORK_SCORE_API.md`
- Create: `docs/api/postman/finance.postman_collection.json`
- Create: `docs/api/postman/report.postman_collection.json`
- Create: `docs/api/postman/audit.postman_collection.json`
- Create: `docs/api/postman/notification.postman_collection.json`
- Create: `docs/api/postman/workScore.postman_collection.json`

**Interfaces:**
- Produces: finance import/recalculation, read-model reporting, immutable audit reads, notification lifecycle, and Design/Scale score contracts.

- [ ] **Step 1: Audit routes and document exact filters, money fields, dates, enums, pagination, exports, and scoped permissions**

Use numeric/currency examples consistent with DTOs. Explicitly mark finance recalculation, score overrides/voiding, and notification bulk mutations as manual.

- [ ] **Step 2: Build collections and capture identifiers**

Capture only safe IDs such as `financeBatchId`, `auditEventId`, `notificationId`, and `workScoreId`; never capture financial source payloads or PII into environments.

- [ ] **Step 3: Validate batch**

```powershell
npm run api:contracts:check
npx jest src/test/finance src/test/report src/test/audit src/test/notification src/test/workScore --runInBand
```

- [ ] **Step 4: Commit**

```powershell
git add docs/finance docs/report docs/audit docs/notification docs/workScore docs/api/postman
git commit -m "docs(api): document business support modules for Postman"
```

### Task 7: Aggregate collection, route coverage, and FE handoff

**Files:**
- Create: `docs/api/postman/LNG_Web_BE.postman_collection.json`
- Create: `docs/api/ENDPOINT_INDEX.md`
- Update: `docs/api/README.md`
- Update: `docs/api/postman/contract-exclusions.json`

**Interfaces:**
- Produces: one discoverable endpoint index and aggregate Postman collection covering every non-excluded inventory route.

- [ ] **Step 1: Generate endpoint index from validated collections**

Group by module and list method, path, permission, collection/request name, mutation risk, and documentation link. Do not duplicate body/response content already in module references.

- [ ] **Step 2: Assemble aggregate collection**

Reuse module request definitions mechanically so module and aggregate collections cannot drift. Order folders by operational flow: Access, Setup, Ingestion, Fulfillment, Finance/Support.

- [ ] **Step 3: Run contract verification**

```powershell
npm run api:inventory
npm run api:contracts:check
npm run test:architecture -- --runInBand
```

Expected: zero missing, unknown, duplicate, or unresolved-variable findings.

- [ ] **Step 4: Run safe local smoke subset when BE is available**

Run only health, authenticated read/list/detail, and preview requests. Do not run import, upload, approval, payroll write, vendor submit, webhook, cancel, delete, retry, or bulk mutation requests.

- [ ] **Step 5: Run final backend verification**

```powershell
npm test -- --runInBand --silent
git diff --check
git status --short --branch
```

- [ ] **Step 6: Commit**

```powershell
git add docs/api
git commit -m "docs(api): publish complete FE endpoint catalog"
```
