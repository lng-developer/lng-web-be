# Manual PSD and Production Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop automatic PSD task creation and safely reconnect legacy ProductionTasks to their existing ListingVariants without inventing template data.

**Architecture:** Keep the existing Design endpoint as the sole PSD-request command. Remove the two best-effort auto-trigger callers, then add one idempotent Production repair script that selects only `TEMPLATE_NOT_FOUND` tasks, rechecks Mapping through its public port, and rechecks Production only when Mapping resolves an exact ListingVariant.

**Tech Stack:** Node.js, CommonJS, Mongoose, Jest, existing module public ports.

## Global Constraints

- Staff must explicitly use **Request PSD**; no automatic DesignTask creation.
- Do not create placeholder InternalTemplates or guess templates from SKU/title.
- Report database and dry-run summary before writes.
- Preserve terminal ProductionTasks and submitted VendorSubmissions.
- Keep cross-module calls behind `public.js`.
- Run narrow tests before broader architecture verification.

---

### Task 1: Remove Production PSD auto-trigger

**Files:**
- Modify: `src/test/production/services/productionTask.service.test.js`
- Modify: `src/modules/production/services/productionTask.service.js:899-920,1099-1103`

**Interfaces:**
- Consumes: existing `createOrRecheckTaskForOrderItem(orderItemId, authContext)`.
- Produces: the same DTO and blockers, with no call to `designPublic.createPsdTemplateTaskFromListing`.

- [ ] **Step 1: Change the PSD-missing service test to assert manual behavior**

Replace the auto-create expectation with:

```js
test('records PSD_MISSING without creating a design task', async () => {
  const result = await service.createOrRecheckTaskForOrderItem(orderItemId, writeContext);
  expect(result.blockers).toContain('PSD_MISSING');
  expect(designPublic.createPsdTemplateTaskFromListing).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx jest src/test/production/services/productionTask.service.test.js -t "records PSD_MISSING without creating" --runInBand`

Expected: FAIL because the current service calls the Design public port.

- [ ] **Step 3: Remove the minimum production code**

Delete `triggerPsdTaskForMissingListing` and its call after the transaction. Do not change blocker derivation or PSD recheck endpoints.

- [ ] **Step 4: Run the Production service tests**

Run: `npx jest src/test/production/services/productionTask.service.test.js --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/production/services/productionTask.service.js src/test/production/services/productionTask.service.test.js
git commit -m "fix(production): require manual PSD requests"
```

### Task 2: Remove Catalog Listing PSD auto-trigger

**Files:**
- Modify: `src/test/catalog/services/catalog.service.test.js`
- Modify: `src/modules/catalog/services/listing.service.js:344-374`

**Interfaces:**
- Consumes: existing manual Listing create service and Design request route.
- Produces: Listing creation with no Design public-port side effect.

- [ ] **Step 1: Change the Listing creation test to assert manual behavior**

```js
test('creates a listing with missing PSD without creating a design task', async () => {
  const result = await service.createListing(validPayload, writeContext);
  expect(result).toBeDefined();
  expect(designPublic.createPsdTemplateTaskFromListing).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the test and verify RED**

Run: `npx jest src/test/catalog/services/catalog.service.test.js -t "missing PSD without creating" --runInBand`

Expected: FAIL because Listing creation currently triggers Design.

- [ ] **Step 3: Remove the minimum Catalog code**

Delete `isActiveApprovedListing`, `triggerPsdDesignTaskForManualListing`, and the create-service call that invokes it. Preserve the explicit Design route `POST /tasks/from-listings/:listingId/psd-template`.

- [ ] **Step 4: Run Catalog and Design tests**

Run: `npx jest src/test/catalog/services/catalog.service.test.js src/test/design/services/designTask.service.test.js src/test/design/routes/index.test.js --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/catalog/services/listing.service.js src/test/catalog/services/catalog.service.test.js
git commit -m "fix(catalog): keep PSD requests staff initiated"
```

### Task 3: Add an idempotent legacy Production repair command

**Files:**
- Create: `src/modules/production/scripts/repairListingVariantLinks.js`
- Create: `src/test/production/scripts/repairListingVariantLinks.test.js`
- Modify: `package.json`

**Interfaces:**
- Consumes: `mapping.public.recheckFulfillmentPlan(orderItemId, {}, systemContext)` and `production.public.createOrRecheckTaskForOrderItem(orderItemId, systemContext)`.
- Produces: `repairListingVariantLinks({ dryRun = true, limit = null }) -> { database, dryRun, checked, eligible, repaired, skipped, failed, reasons }`.

- [ ] **Step 1: Write failing script tests**

Cover these exact cases:

```js
test('dry-run reports eligible legacy tasks without invoking recheck', async () => {});
test('apply rechecks mapping then production when a variant resolves', async () => {});
test('apply skips missing listing and unresolved variant without guessing', async () => {});
test('rerun skips tasks that already carry listingVariantId', async () => {});
```

Mock only repository selection and public ports. Assert the returned counters and call order.

- [ ] **Step 2: Run the tests and verify RED**

Run: `npx jest src/test/production/scripts/repairListingVariantLinks.test.js --runInBand`

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement the minimum command**

The script must:

```js
const SYSTEM_CONTEXT = { system: true, source: 'PRODUCTION_VARIANT_REPAIR' };

// Select non-terminal ProductionTasks with TEMPLATE_NOT_FOUND and no listingVariantId.
// In dry-run, classify only; perform no public-port mutations.
// In apply mode, recheck Mapping first.
// Continue only when the returned plan has listingVariantId.
// Recheck Production through production.public.
// Record per-reason counts; never assign internalTemplateId directly.
```

CLI behavior:

```text
node src/modules/production/scripts/repairListingVariantLinks.js
node src/modules/production/scripts/repairListingVariantLinks.js --apply
node src/modules/production/scripts/repairListingVariantLinks.js --apply --limit=16
```

Add package script:

```json
"repair:production-variant-links": "node src/modules/production/scripts/repairListingVariantLinks.js"
```

- [ ] **Step 4: Run script unit tests and syntax checks**

Run:

```powershell
node -c src/modules/production/scripts/repairListingVariantLinks.js
npx jest src/test/production/scripts/repairListingVariantLinks.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 5: Commit**

```powershell
git add package.json src/modules/production/scripts/repairListingVariantLinks.js src/test/production/scripts/repairListingVariantLinks.test.js
git commit -m "feat(production): add safe variant link repair"
```

### Task 4: Verify code and repair `lng_web_be`

**Files:**
- No source changes expected.

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: test evidence, dry-run/apply summaries, and database readback.

- [ ] **Step 1: Run narrow regression tests**

Run:

```powershell
npx jest src/test/production src/test/catalog/services/catalog.service.test.js src/test/design src/test/mapping/services/fulfillmentPlan.service.test.js src/test/vendorSubmission/services/vendorSubmission.service.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 2: Run architecture contracts**

Run: `npm run test:architecture -- --runInBand`

Expected: PASS.

- [ ] **Step 3: Run dry-run against the configured database**

Run: `npm run repair:production-variant-links`

Expected: output names database `lng_web_be`, reports eligible/skipped reasons, and performs zero writes.

- [ ] **Step 4: Apply the idempotent repair**

Run: `npm run repair:production-variant-links -- --apply`

Expected: only exact variant resolutions are rechecked; missing Listing and unresolved Variant remain skipped.

- [ ] **Step 5: Prove idempotency and read back state**

Run dry-run again and query counts for `listingVariantId`, `TEMPLATE_NOT_FOUND`, `PSD_MISSING`, and terminal statuses. Confirm there are no new automatic DesignTasks and no submitted VendorSubmission changed.

- [ ] **Step 6: Inspect final branch state**

Run:

```powershell
git diff --check
git status --short --branch
git log -5 --oneline
```

Expected: clean working tree with separate documentation, behavior, and repair commits.
