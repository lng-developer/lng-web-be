# Remove Listing Legacy Fields Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make ListingVariant the sole owner of Product Type, internal template, PSD asset, and preview asset.

**Architecture:** Remove the four legacy fields at the Catalog aggregate boundary first, then remove every downstream fallback so resolution always uses `listingVariantId` or `defaultVariantId`. Finish with a dry-run-by-default Mongo cleanup that unsets only legacy Listing fields and reconciles their indexes.

**Tech Stack:** Node.js, CommonJS, Express, Mongoose, Joi, Jest, React, TypeScript, Ant Design, Vitest.

## Global Constraints

- Do not preserve legacy previews for the three listings without variants.
- Do not create placeholder Product Types or ListingVariants.
- Do not delete Listing, ListingVariant, MediaAsset, order, or historical snapshot documents.
- Missing PSD only blocks Production; only Catalog `Request PSD` may create a DesignTask.
- Cross-module calls must use each module's `public.js`.
- Run focused tests per boundary and the full suite only once at the final gate.

---

### Task 1: Remove Legacy Ownership From Catalog Listing

**Files:**
- Modify: `src/modules/catalog/models/listing.model.js`
- Modify: `src/modules/catalog/validators/listing.validator.js`
- Modify: `src/modules/catalog/dtos/listing.dto.js`
- Modify: `src/modules/catalog/services/listing.service.js`
- Modify: `src/modules/catalog/repositories/listing.repository.js`
- Test: `src/test/catalog/models/listing.model.test.js`
- Test: `src/test/catalog/services/listing.service.test.js`

**Interfaces:**
- Produces: Listing DTO without `productTypeGroup`, `internalTemplate`, `psdTemplateAssetId`, or `previewAssetId`.
- Produces: Listing writes that ignore/reject the four removed ownership fields.
- Preserves: `defaultVariantId` as the only Listing-to-variant pointer.

- [ ] **Step 1: Write failing schema and DTO tests**

```js
expect(Listing.schema.path('productTypeGroupId')).toBeUndefined();
expect(Listing.schema.path('internalTemplateId')).toBeUndefined();
expect(Listing.schema.path('psdTemplateAssetId')).toBeUndefined();
expect(Listing.schema.path('previewAssetId')).toBeUndefined();
expect(toListingDto(listing)).not.toHaveProperty('productTypeGroup');
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run: `npx jest src/test/catalog/models/listing.model.test.js src/test/catalog/services/listing.service.test.js --runInBand`

Expected: FAIL because the legacy schema paths and DTO fields still exist.

- [ ] **Step 3: Remove the four schema fields, related indexes, validator inputs, population, asset lookups, DTO properties, and service write paths**

Keep `defaultVariantId` unchanged. Do not add compatibility aliases.

- [ ] **Step 4: Run Catalog tests and verify GREEN**

Run: `npx jest src/test/catalog --runInBand`

Expected: PASS.

### Task 2: Remove Downstream Listing Fallbacks

**Files:**
- Modify: `src/modules/mapping/services/fulfillmentPlan.service.js`
- Modify: `src/modules/mapping/dtos/fulfillmentPlan.dto.js`
- Modify: `src/modules/design/services/designTask.service.js`
- Modify: `src/modules/order/dtos/order.dto.js`
- Modify: `src/modules/order/services/orderWorkflow.service.js`
- Modify: `src/modules/production/services/productionTask.service.js`
- Modify: `src/modules/production/dtos/productionTask.dto.js`
- Test: `src/test/mapping/services/fulfillmentPlan.service.test.js`
- Test: `src/test/design/services/designTask.service.test.js`
- Test: `src/test/order/dtos/order.dto.test.js`
- Test: `src/test/order/services/orderWorkflow.service.test.js`
- Test: `src/test/production/services/productionTask.service.test.js`

**Interfaces:**
- Consumes: `catalogPublic.getListingVariantById(variantId)` and Listing `defaultVariantId`.
- Produces: `LISTING_VARIANT_NOT_FOUND` when neither customization-selected nor default variant resolves.
- Preserves: Historical FulfillmentPlan and ProductionTask snapshots.

- [ ] **Step 1: Add failing resolver tests**

```js
test('does not fall back to legacy Listing ownership fields', async () => {
  catalogPublic.getListingVariantById.mockResolvedValue(null);
  const result = await previewFulfillmentPlan(orderItemId);
  expect(result.blockingReasons).toContain('LISTING_VARIANT_NOT_FOUND');
});
```

Add DTO assertions that new Listing snapshots do not expose the four legacy fields while stored historical task snapshots remain readable.

- [ ] **Step 2: Run affected tests and verify RED**

Run: `npx jest src/test/mapping/services/fulfillmentPlan.service.test.js src/test/design/services/designTask.service.test.js src/test/order/dtos/order.dto.test.js src/test/order/services/orderWorkflow.service.test.js src/test/production/services/productionTask.service.test.js --runInBand`

Expected: FAIL because current services still read Listing-owned Product Type/template/assets.

- [ ] **Step 3: Delete Listing-field fallback branches**

Resolve the effective selection only from the selected `ListingVariant`; use `defaultVariantId` only when customization has no Product Type. Preserve snapshot parsing for historical documents, because snapshots are not Listing fields. Delete automatic PSD task creation from Mapping and Production.

- [ ] **Step 4: Run affected module and architecture tests**

Run: `npx jest src/test/mapping src/test/design src/test/order src/test/production src/test/architecture.contract.test.js --runInBand`

Expected: PASS.

### Task 3: Remove Legacy Listing Inputs From FE

**Files:**
- Modify: `src/features/portal/catalog/api/catalogApi.ts`
- Modify: `src/features/portal/catalog/pages/CatalogListingWorkbenchPage.tsx`
- Modify: `src/test/portal/catalog/api/catalogApi.test.ts`
- Modify: `src/test/portal/catalog/pages/CatalogListingWorkbenchPage.test.tsx`

**Interfaces:**
- Consumes: Listing API without legacy ownership fields.
- Preserves: `ListingVariantManager` as the sole Product Type/template/asset editor.

- [ ] **Step 1: Add failing API/UI assertions**

```ts
expect(screen.queryByLabelText('Product type')).not.toBeInTheDocument();
expect(screen.queryByLabelText('Preview asset ID')).not.toBeInTheDocument();
```

- [ ] **Step 2: Run the affected FE tests and verify RED**

Run: `npm run test:ui -- src/test/portal/catalog/pages/CatalogListingWorkbenchPage.test.tsx`

- [ ] **Step 3: Remove legacy Listing types, request payload properties, and form controls**

Do not change ListingVariant controls.

- [ ] **Step 4: Run targeted FE tests**

Run: `npx vitest run src/test/portal/catalog/api/catalogApi.test.ts src/test/portal/catalog/pages/CatalogListingWorkbenchPage.test.tsx src/test/portal/catalog/pages/ListingVariantManager.test.tsx`

Expected: PASS.

### Task 4: Add Idempotent Database Cleanup

**Files:**
- Create: `src/modules/catalog/scripts/removeListingLegacyFields.js`
- Modify: `package.json`
- Create: `src/test/catalog/scripts/removeListingLegacyFields.test.js`

**Interfaces:**
- Produces: `buildCleanupPlan(indexes, counts)` as a pure function for tests.
- CLI: `npm run cleanup:listings:legacy-fields` for dry-run and `npm run cleanup:listings:legacy-fields -- --apply` for apply.

- [ ] **Step 1: Write failing cleanup-plan tests**

```js
expect(buildCleanupPlan(indexes, counts)).toEqual({
  unset: ['productTypeGroupId', 'internalTemplateId', 'psdTemplateAssetId', 'previewAssetId'],
  dropIndexes: expect.arrayContaining(['productTypeGroupId_1_status_1']),
  affected: counts,
});
```

Also assert that unrelated compound identity indexes are never selected.

- [ ] **Step 2: Run the script test and verify RED**

Run: `npx jest src/test/catalog/scripts/removeListingLegacyFields.test.js --runInBand`

Expected: FAIL because the script does not exist.

- [ ] **Step 3: Implement the smallest dry-run/apply script**

Use one `updateMany` with:

```js
{
  $unset: {
    productTypeGroupId: '',
    internalTemplateId: '',
    psdTemplateAssetId: '',
    previewAssetId: '',
  },
}
```

Only drop indexes whose exact key matches a removed Listing field index. Cancel active PSD DesignTasks without `listingVariantId` using reason `LISTING_VARIANT_NOT_FOUND`. Use `require.main === module` and export the pure planner.

- [ ] **Step 4: Run script and Catalog tests**

Run: `npx jest src/test/catalog/scripts/removeListingLegacyFields.test.js src/test/catalog --runInBand`

Expected: PASS.

- [ ] **Step 5: Run DB dry-run and review output**

Run: `npm run cleanup:listings:legacy-fields`

Expected before apply: database `lng_web_be`, counts matching the four legacy fields, and only legacy indexes listed.

- [ ] **Step 6: Apply only after the dry-run is safe, then prove idempotency**

Run: `npm run cleanup:listings:legacy-fields -- --apply && npm run cleanup:listings:legacy-fields`

Expected final dry-run: all affected counts are `0`, no legacy indexes remain, and no additional actions are required.

### Task 5: Final Verification

**Files:**
- Verify all modified files.

**Interfaces:**
- Produces: one final evidence gate for BE and FE.

- [ ] **Step 1: Run syntax and diff checks**

Run changed JS files with `node -c`, then run `git diff --check` in both worktrees.

- [ ] **Step 2: Run the full BE suite once**

Run: `npm test -- --runInBand`

Expected: PASS.

- [ ] **Step 3: Run FE lint, unit tests, affected UI tests, and build**

Run: `npm run lint && npm run test:unit && npx vitest run src/test/portal/catalog/api/catalogApi.test.ts src/test/portal/catalog/pages/CatalogListingWorkbenchPage.test.tsx src/test/portal/catalog/pages/ListingVariantManager.test.tsx && npm run build`

Expected: PASS; the existing Vite chunk-size warning is non-blocking.
