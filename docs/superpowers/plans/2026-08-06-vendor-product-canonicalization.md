# Vendor Product Canonicalization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict manual vendor selection to the ListingVariant Product Type Group and safely copy legacy cost centers into canonical VendorProducts without rewriting immutable history.

**Architecture:** Runtime filtering is enforced inside Vendor public ports and passed through Mapping to FE. A Vendor-owned idempotent migration consumes an explicit legacy Product Type Group to canonical Product Type Group map, copies cost centers by stable code, reports value conflicts, and deactivates legacy products only after equivalence is proven.

**Tech Stack:** Node.js, CommonJS, Mongoose, Joi, Jest, React, TypeScript, TanStack Query, Vitest.

## Global Constraints

- Canonical VendorProduct identity is `vendorId + externalProductId + canonicalProductTypeGroupId`.
- Product names must not determine migration identity.
- Finance snapshots and VendorSubmissions are immutable.
- The migration defaults to dry-run and must be idempotent.
- Conflicting cost-center values must be reported and never overwritten automatically.
- `SELECTED_VENDOR_PRODUCT_INVALID` remains enabled.
- Run narrow tests before architecture/type checks; do not run the full repository test suite.

---

### Task 1: Filter Manual Vendor Products by ListingVariant Product Type

**Files:**
- Modify: `src/modules/vendor/repositories/vendorProduct.repository.js`
- Modify: `src/modules/vendor/services/vendor.service.js`
- Modify: `src/modules/vendor/public.js`
- Modify: `src/modules/mapping/services/fulfillmentPlan.service.js`
- Modify: `src/modules/mapping/controllers/fulfillmentPlan.controller.js`
- Modify: `src/modules/mapping/validators/fulfillmentPlan.validator.js`
- Test: `src/test/vendor/services/vendor.service.test.js`
- Test: `src/test/mapping/routes/index.test.js`
- Modify: `C:/lng_system/lng-web/lng-web-fe/.worktrees/wasabi-large-file-storage/src/features/portal/mapping/api/mappingApi.ts`
- Modify: `C:/lng_system/lng-web/lng-web-fe/.worktrees/wasabi-large-file-storage/src/features/portal/orders/pages/FulfillmentInlineEditor.tsx`
- Test: `C:/lng_system/lng-web/lng-web-fe/.worktrees/wasabi-large-file-storage/src/test/portal/orders/pages/OrderInlinePanel.test.tsx`

**Interfaces:**
- Produces: `vendorPublic.listActiveVendorProductsByVendor(vendorId, { productTypeGroupId })`.
- Produces: `listMappingVendorProducts(vendorId, { productTypeGroupId })`.
- Consumes: `item.mapping.listingVariant.productTypeGroup.id` from the completed Order Workbench contract.

- [ ] **Step 1: Write failing BE tests**

```js
await service.listActiveVendorProductsByVendor(vendorId, { productTypeGroupId });
expect(productRepository.listActiveByVendor).toHaveBeenCalledWith(vendorId, { productTypeGroupId });

await request(app).get(`/api/mapping/vendors/${vendorId}/products?productTypeGroupId=${productTypeGroupId}`);
expect(mappingService.listManualVendorProducts).toHaveBeenCalledWith(vendorId, { productTypeGroupId });
```

- [ ] **Step 2: Verify BE tests fail**

Run:

```powershell
npx jest src/test/vendor/services/vendor.service.test.js src/test/mapping/routes/index.test.js --runInBand
```

Expected: existing functions omit the Product Type Group option.

- [ ] **Step 3: Implement the minimal BE filter**

```js
async function listActiveByVendor(vendorId, { productTypeGroupId } = {}) {
  return VendorProduct.find({
    vendorId,
    status: recordStatuses.ACTIVE,
    ...(productTypeGroupId ? { productTypeGroupId } : {}),
  }).select('code name productTypeGroupId').sort({ code: 1, _id: 1 }).lean();
}
```

Validate `productTypeGroupId` as an optional ObjectId at the Mapping HTTP boundary and pass it unchanged through Mapping and Vendor public ports.

- [ ] **Step 4: Write and verify the failing FE test**

```ts
await waitFor(() => expect(listMappingVendorProducts).toHaveBeenCalledWith('vendor-1', {
  productTypeGroupId: 'group-1',
}))
```

Run:

```powershell
npx vitest run src/test/portal/orders/pages/OrderInlinePanel.test.tsx --project ui --testNamePattern="product type"
```

- [ ] **Step 5: Implement the FE query parameter**

```ts
export async function listMappingVendorProducts(
  vendorId: string,
  params: { productTypeGroupId: string },
) {
  return unwrap<MappingVendorProduct[]>(await apiClient.get(
    `/api/mapping/vendors/${vendorId}/products`,
    { params },
  ))
}
```

Disable the product query until both `vendorId` and ListingVariant Product Type Group are present.

- [ ] **Step 6: Verify Task 1**

```powershell
npx jest src/test/vendor/services/vendor.service.test.js src/test/mapping/routes/index.test.js --runInBand
npm run test:architecture -- --runInBand
```

```powershell
npx vitest run src/test/portal/orders/pages/OrderInlinePanel.test.tsx --project ui
npm run typecheck
```

- [ ] **Step 7: Commit Task 1 separately in BE and FE**

```powershell
git add src/modules/vendor src/modules/mapping src/test/vendor src/test/mapping
git commit -m "fix(mapping): filter vendor products by listing variant"
```

```powershell
git add src/features/portal/mapping/api/mappingApi.ts src/features/portal/orders/pages/FulfillmentInlineEditor.tsx src/test/portal/orders/pages/OrderInlinePanel.test.tsx
git commit -m "fix(orders): filter manual products by listing variant"
```

### Task 2: Build a Reusable Duplicate Audit and Explicit Canonical Map

**Files:**
- Create: `src/modules/vendor/scripts/vendorProductCanonicalization.js`
- Create: `src/modules/vendor/data/vendorProductCanonicalMap.json`
- Test: `src/test/vendor/scripts/vendorProductCanonicalization.test.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `auditVendorProductCanonicalization({ collections, canonicalMap })`.
- Produces: report fields `identityGroups`, `missingMappings`, `costCenterConflicts`, `historicalReferences`, and `safeGroups`.
- The JSON map contains exact `{ legacyProductTypeGroupId, canonicalProductTypeGroupId }` rows reviewed from current database evidence.

- [ ] **Step 1: Write the failing audit test**

```js
const result = await auditVendorProductCanonicalization({ collections, canonicalMap });
expect(result).toMatchObject({
  missingMappings: [],
  safeGroups: [expect.objectContaining({ vendorId, externalProductId: 'LFCG760' })],
});
```

Include cases for missing external ID, more than two duplicates, missing canonical product, and historical references.

- [ ] **Step 2: Verify the test fails**

```powershell
npx jest src/test/vendor/scripts/vendorProductCanonicalization.test.js --runInBand
```

- [ ] **Step 3: Implement the read-only audit**

Group by exact `vendorId + externalProductId`. Resolve canonical groups only from JSON. Return conflicts instead of throwing for row-level data issues; throw only when the canonical map itself contains duplicate legacy IDs or invalid ObjectIds.

- [ ] **Step 4: Add the dry-run command**

```json
{
  "audit:vendor-products:canonical": "node src/modules/vendor/scripts/vendorProductCanonicalization.js"
}
```

The CLI connects through existing database config and prints JSON without mutation when `--apply` is absent.

- [ ] **Step 5: Populate and review the explicit map**

Derive candidate pairs from ProductTypeGroup IDs already referenced by Mapping configuration and ListingVariants. Run the audit and require `missingMappings.length === 0` before Task 3.

- [ ] **Step 6: Verify Task 2**

```powershell
npx jest src/test/vendor/scripts/vendorProductCanonicalization.test.js --runInBand
npm run audit:vendor-products:canonical
```

- [ ] **Step 7: Commit Task 2**

```powershell
git add src/modules/vendor/scripts src/modules/vendor/data src/test/vendor/scripts package.json
git commit -m "feat(vendor): audit canonical vendor products"
```

### Task 3: Copy Cost Centers Idempotently and Deactivate Safe Legacy Products

**Files:**
- Modify: `src/modules/vendor/scripts/vendorProductCanonicalization.js`
- Test: `src/test/vendor/scripts/vendorProductCanonicalization.test.js`

**Interfaces:**
- Produces: `applyVendorProductCanonicalization({ collections, canonicalMap, now })`.
- Consumes: Task 2 audit report and exact canonical map.

- [ ] **Step 1: Write failing migration tests**

```js
expect(await applyVendorProductCanonicalization(input)).toMatchObject({
  copiedCostCenters: 1,
  skippedIdenticalCostCenters: 1,
  conflicts: [],
  deactivatedProducts: 1,
  rewrittenFinanceSnapshots: 0,
  rewrittenVendorSubmissions: 0,
});
```

Add separate tests proving rerun counts copied rows as zero, a price/shipping mismatch blocks deactivation, and historical documents remain untouched.

- [ ] **Step 2: Verify migration tests fail**

```powershell
npx jest src/test/vendor/scripts/vendorProductCanonicalization.test.js --runInBand
```

- [ ] **Step 3: Implement copy/upsert by stable cost-center code**

Compare `vendorId`, code, size, color, base cost, domestic/international/priority shipping, tax, surcharges, and status. Insert a canonical copy only when no target code exists. Skip exact target rows. Record any difference as a conflict.

- [ ] **Step 4: Implement safe deactivation**

Deactivate a legacy VendorProduct only when every active legacy cost center has an identical canonical counterpart and the group has no unresolved conflict. Do not delete any document.

- [ ] **Step 5: Implement active-plan repair**

For BLOCKED plans, call Mapping's existing recheck through its public port after migration. Do not rewrite immutable finance or submission history. READY/CONFIRMED plans are reported for manual review unless exact equivalence is proven by tests.

- [ ] **Step 6: Verify Task 3**

```powershell
npx jest src/test/vendor/scripts/vendorProductCanonicalization.test.js src/test/mapping/services/fulfillmentPlan.service.test.js --runInBand
npm run test:architecture -- --runInBand
```

- [ ] **Step 7: Commit Task 3**

```powershell
git add src/modules/vendor/scripts src/test/vendor/scripts
git commit -m "feat(vendor): migrate canonical product cost centers"
```

### Task 4: Dry-Run, Apply, and Verify Real Data

**Files:**
- No source changes expected; save command output outside Git if a report artifact is needed.

**Interfaces:**
- Consumes: Task 2 CLI and Task 3 `--apply` behavior.

- [ ] **Step 1: Run dry-run against `lng_web_be`**

```powershell
npm run audit:vendor-products:canonical
```

Record database name, safe groups, conflicts, historical references, copied-row forecast, and legacy products eligible for deactivation.

- [ ] **Step 2: Stop for review if any conflict exists**

Do not use `--apply` while `missingMappings` or `costCenterConflicts` is non-empty. Present exact product and cost-center IDs for review.

- [ ] **Step 3: Apply only after clean dry-run**

```powershell
npm run audit:vendor-products:canonical -- --apply
```

- [ ] **Step 4: Rerun dry-run to prove idempotency**

Expected: `copiedCostCenters = 0`, no active legacy product remains eligible, and immutable history counts are unchanged.

- [ ] **Step 5: Verify the reported order**

For order `111-5676843-8053015`, verify canonical VendorProduct `6a5757dc002c71ac0195b510` exposes the `8cm / Base Engraving` cost center, manual selection succeeds, the plan uses ListingVariant `6a73083f7dbbaf08a053317a`, and status reaches `READY` unless an independent blocker remains.

- [ ] **Step 6: Final verification**

```powershell
git diff --check
```

Run the narrow BE suites from Tasks 1-3, FE OrderInlinePanel suite, FE typecheck, and architecture contract. Do not run full tests.
