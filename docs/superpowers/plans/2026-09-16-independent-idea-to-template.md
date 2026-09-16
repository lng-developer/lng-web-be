# Independent Idea to Internal Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn an approved, listing-independent IDEA Design task into one traceable, reusable Catalog InternalTemplate through an explicit operator action.

**Architecture:** Keep `DesignTask` as the single workflow aggregate. Allow only IDEA documents to omit Listing/Shop context, add a small conversion record, and call a new Catalog public-port operation to create one source-linked InternalTemplate. Listings stay Shop-scoped and attach the resulting template later through existing Catalog setup.

**Tech Stack:** Node.js, Express, Mongoose, Joi, Jest; existing Design, Catalog, Media, Auth, Audit, and DTO/public-port patterns.

**Spec:** `docs/superpowers/specs/2026-09-16-independent-idea-to-template-design.md`

## Global Constraints

- Change only IDEA semantics; keep every non-IDEA Design task contract and Shop authorization unchanged.
- Do not make a Catalog Listing, Production task, mapping, or vendor submission during Idea approval or conversion.
- Design crosses into Catalog exclusively through `src/modules/catalog/public.js`; no cross-module model, repository, or service imports.
- Preserve current dirty worktree changes outside this scope.
- Do not add a dependency or a second Idea aggregate.

---

### Task 1: Define the persisted IDEA and conversion contract

**Files:**
- Modify: `src/modules/design/models/designTask.model.js`
- Modify: `src/modules/design/constants/design.constants.js` only if a new explicit conversion enum is required
- Modify: `src/modules/design/validators/designTask.validator.js`
- Modify: `tests/design/models/designTask.model.test.js`
- Test: `tests/design/controllers/designTask.controller.test.js`

**Interfaces:**
- Produces a pure IDEA document with nullable `listingId`, `listingVariantId`, and `shopId`; non-IDEAs remain required by service validation.
- Produces `conversion: { internalTemplateId, convertedBy, convertedAt } | null`.
- `POST /api/design/tasks` accepts `{ taskType: 'IDEA', title, description?, productTypeGroupId, productImageUrl?, productUrl?, referenceAssetIds?, priority? }`.

- [ ] **Step 1: Write failing model and validator tests**

Add tests that accept a pure IDEA with no Listing/Shop, reject IDEA without `title` or `productTypeGroupId`, reject non-IDEA without `listingId`, reject non-IDEA when `shopId` is submitted externally, and reject malformed/non-HTTPS product URLs.

- [ ] **Step 2: Run the focused tests to confirm the current failure**

Run:

```powershell
npm test -- --runInBand tests/design/models/designTask.model.test.js tests/design/controllers/designTask.controller.test.js
```

Expected: failures because `listingId` and `shopId` are currently model-required and IDEA uses the generic Listing-bound body.

- [ ] **Step 3: Add the minimal schema and Joi branches**

Make `listingId` and `shopId` nullable at Mongoose level. Add `title`, `description`, `productImageUrl`, `productUrl`, and the conversion subdocument. Keep the existing active-task index for Listing-backed tasks, but exclude pure IDEAs from its partial filter so null Listing values do not collide. In Joi, use alternatives keyed by `taskType`: the IDEA branch has exactly the new fields; the generic branch retains the current Listing/source/output requirements.

- [ ] **Step 4: Re-run the focused tests**

Run the command from Step 2. Expected: PASS.

---

### Task 2: Enforce pure-IDEA creation, read scope, and lifecycle behavior

**Files:**
- Modify: `src/modules/design/services/designTask.service.js`
- Modify: `src/modules/design/repositories/designTask.repository.js`
- Modify: `src/modules/design/dtos/designTask.dto.js`
- Modify: `tests/design/services/designTask.service.test.js`
- Modify: `tests/design/repositories/designTask.repository.test.js`

**Interfaces:**
- `createTask()` creates a pure IDEA without Catalog Listing lookup and validates the active ProductTypeGroup through Catalog public read API.
- Pure IDEA reads require global Design or Design team scope; Shop-only scope returns no pure IDEA list rows and receives Forbidden on direct reads.
- Task list/detail DTO returns `title`, `description`, `productTypeGroup`, `productImageUrl`, `productUrl`, and `conversion` for IDEA, with null values for other types.

- [ ] **Step 1: Add service tests**

Cover creation without `catalogPublic.getListingById`, active ProductTypeGroup validation, global/team access success, Shop-only direct-read rejection, Shop-only list exclusion, assigned designer work access, and legacy listing-bound IDEA compatibility.

- [ ] **Step 2: Run the Design service tests to confirm failures**

Run:

```powershell
npm test -- --runInBand tests/design/services/designTask.service.test.js tests/design/repositories/designTask.repository.test.js
```

Expected: failures because current helpers dereference `task.shopId` and creation always loads a Listing.

- [ ] **Step 3: Implement the narrow IDEA branch**

Add dedicated `isPureIdea`, `assertCanReadPureIdea`, and `assertCanOperatePureIdea` helpers. Use them only when `taskType === IDEA` and the persisted task has no Shop/Listing. Keep existing `assertCanAccessShop`, output behavior, and PSD approval flow untouched for all other tasks. Add repository query support so pure IDEAs are omitted from Shop-scoped list/workload queries and included for global/team Design queries.

For IDEA creation, call `catalogPublic.getProductTypeGroupById`, require an active result, persist only the Idea fields, and set `REQUESTED`. Do not set `listingSnapshot`, `targetListingId`, or Shop fields.

- [ ] **Step 4: Extend the DTO without breaking old consumers**

Resolve the product type name through existing Catalog public reads in the Design DTO enrichment path. Return an `idea` object only for pure IDEA records; return `idea: null` and `conversion: null` for other task types.

- [ ] **Step 5: Re-run the focused Design tests**

Run the command from Step 2. Expected: PASS.

---

### Task 3: Add a Catalog public-port conversion operation

**Files:**
- Modify: `src/modules/catalog/models/internalTemplate.model.js`
- Modify: `src/modules/catalog/validators/internalTemplate.validator.js`
- Modify: `src/modules/catalog/services/internalTemplate.service.js`
- Modify: `src/modules/catalog/services/catalog.service.js`
- Modify: `src/modules/catalog/public.js`
- Modify: `tests/catalog/models/internalTemplate.model.test.js`
- Modify: `tests/catalog/services/internalTemplate.service.test.js`

**Interfaces:**
- `catalogPublic.createInternalTemplateFromApprovedIdea({ sourceIdeaTaskId, productTypeGroupId, approvedAssetId, approvedAssetType, template }, authContext)`.
- Returns an existing Template if `sourceIdeaTaskId` was already converted; otherwise creates one template whose `designAssets` includes the approved Media asset and whose `sourceIdeaTaskId` is set.

- [ ] **Step 1: Add failing Catalog tests**

Test that the source Idea id is unique, an existing conversion is returned idempotently, a new template verifies the active Product Type and ready Media asset, and invalid template code/slots/design asset type still follows existing validation errors.

- [ ] **Step 2: Run the Catalog tests to confirm failures**

Run:

```powershell
npm test -- --runInBand tests/catalog/models/internalTemplate.model.test.js tests/catalog/services/internalTemplate.service.test.js
```

Expected: failures because InternalTemplate has no source link or public conversion method.

- [ ] **Step 3: Implement Catalog ownership of the conversion**

Add optional `sourceIdeaTaskId` to InternalTemplate with a unique sparse index. Implement the service operation by first looking up that source id, then composing the existing `createInternalTemplate` payload with the operator-provided `template` definition and one `designAssets` entry for the approved Media asset. Reuse existing ProductTypeGroup and Media validations; do not duplicate them in Design. Export only the narrow method through `catalog/public.js`.

- [ ] **Step 4: Re-run the Catalog tests**

Run the command from Step 2. Expected: PASS.

---

### Task 4: Convert an approved IDEA through the Design API

**Files:**
- Modify: `src/modules/design/validators/designTask.validator.js`
- Modify: `src/modules/design/controllers/designTask.controller.js`
- Modify: `src/modules/design/routes/index.js`
- Modify: `src/modules/design/services/designTask.service.js`
- Modify: `src/modules/design/dtos/designTask.dto.js`
- Modify: `tests/design/services/designTask.service.test.js`
- Modify: `tests/design/controllers/designTask.controller.test.js`
- Modify: `tests/design/routes/index.test.js`

**Interfaces:**
- `POST /api/design/tasks/:taskId/convert-to-internal-template`.
- Requires an APPROVED pure IDEA with an approved Media asset, Design review/write access, and global `CATALOG:WRITE`.
- Request body: `{ template: { code, name, description?, requiredFields?, artworkSlots?, requiresPsd?, status? }, approvedAssetType, approvedAssetLabel? }`.
- Response: `{ ideaTask, internalTemplate, created }` where `created=false` on retry.

- [ ] **Step 1: Add failing route/controller/service tests**

Cover a successful conversion, second-call idempotency, non-IDEA rejection, non-approved rejection, missing approved asset rejection, a caller lacking Catalog write rejection, and a caller with only Shop Design scope rejection. Assert that Design calls `catalogPublic.createInternalTemplateFromApprovedIdea`, never a Catalog model/service.

- [ ] **Step 2: Run the tests to confirm failures**

Run:

```powershell
npm test -- --runInBand tests/design/services/designTask.service.test.js tests/design/controllers/designTask.controller.test.js tests/design/routes/index.test.js
```

Expected: failures because the endpoint and conversion service do not exist.

- [ ] **Step 3: Add validation, authorization, and service orchestration**

Validate the nested template body with the same Catalog field semantics; keep its server-side validation authoritative. In the Design service, load the task, assert pure IDEA + `APPROVED` + approved submission asset, check global Catalog write through Auth public helpers, call the Catalog public port, then atomically persist the Idea conversion record only if it is still unset. If a concurrent caller wins, read and return the Catalog template identified by the persisted conversion instead of creating another.

Record an audit event `DESIGN_IDEA_CONVERTED_TO_TEMPLATE` only after both durable records are linked. Return an explicit warning if the template was created but the Design conversion link could not be persisted; do not hide that partial failure.

- [ ] **Step 4: Add the route before `GET /tasks/:taskId`**

Mount the new POST route before generic `/:taskId` routes, authenticate it, and require Design review/write at the route while preserving service-level global Catalog authorization.

- [ ] **Step 5: Re-run the focused endpoint tests**

Run the command from Step 2. Expected: PASS.

---

### Task 5: Update published contracts, fixtures, and documentation

**Files:**
- Modify: `docs/design/DESIGN_MODULE_GUIDE.md`
- Modify: `docs/design/DESIGN_API.md`
- Modify: `docs/catalog/CATALOG_MODULE_GUIDE.md`
- Modify: `docs/catalog/CATALOG_API.md`
- Modify: `docs/api/postman/design.postman_collection.json`
- Modify: `tools/api-contract/buildFulfillmentPostmanCollections.js`
- Test: `tools/api-contract/validateApiContracts.js`

**Interfaces:**
- Documentation defines pure IDEA fields, access isolation, conversion request/response, one-way Listing attachment after conversion, and the fact that approval itself has no Catalog/Production side effect.
- API fixture uses the new IDEA request, not a fabricated Listing id.

- [ ] **Step 1: Update contract examples**

Replace the current IDEA fixture that requires `listingId` with the pure IDEA body. Add a conversion fixture with a valid template code, approved asset type, and one minimal artwork slot. Document `sourceIdeaTaskId` as a Catalog trace field, not a field clients may write on regular template creation.

- [ ] **Step 2: Run API contract validation**

Run:

```powershell
npm run api:inventory
npm run api:contracts:check
```

Expected: route inventory and fixtures agree with the mounted Design routes.

---

### Task 6: Run integration-focused verification

**Files:**
- No new files.

- [ ] **Step 1: Syntax-check each changed JavaScript file**

Run `node -c` for every modified Design and Catalog `.js` file.

- [ ] **Step 2: Run focused suites**

Run:

```powershell
npm test -- --runInBand tests/design tests/catalog
npm run test:architecture -- --runInBand
```

Expected: PASS.

- [ ] **Step 3: Manual API smoke test**

1. Create a pure IDEA as a global/team Design user; confirm no Listing/Shop is persisted.
2. Assign, submit a Media asset, and approve it.
3. Attempt conversion as a Shop-only Design user and confirm Forbidden.
4. Convert as a Design reviewer with global Catalog write; confirm one InternalTemplate owns the approved Media asset and links to the Idea id.
5. Retry the same endpoint; confirm no second template is created.
6. Attach the template to a test Listing through the existing Catalog workflow; confirm Listing setup is the only point at which a Shop enters the flow.

## Self-Review

- Spec coverage: IDEA input, independent access, approval, catalog conversion, immutable trace, idempotency, legacy compatibility, and Listing handoff all have a task.
- Placeholder scan: no implementation step depends on an unnamed component or unspecified request field.
- Type consistency: `productTypeGroupId`, `approvedAssetId`, `sourceIdeaTaskId`, and `internalTemplateId` use the same names across persistence, port, route, DTO, docs, and tests.
- Scope check: FE UI implementation is intentionally excluded; it should follow only after the backend response contract passes the tests above.
