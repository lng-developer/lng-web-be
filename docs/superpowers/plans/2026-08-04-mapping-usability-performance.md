# Mapping Usability and Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove confirmed duplicate mapping APIs and make the operator preview compact while preserving matching decisions and manual vendor selection.

**Architecture:** Keep `buildPreview()` as the complete internal matcher so `resolve` and `recheck` retain deterministic auto selection. Shape only the HTTP preview DTO into a compact trace with counts and one top candidate; use the existing vendor-candidate search endpoint for manual selection. Remove routes only after removing their current frontend wrappers and route tests.

**Tech Stack:** Node.js, Express, Mongoose, Jest, React, TypeScript, TanStack Query, Vitest.

## Global Constraints

- Preserve `MAPPING:READ` / `MAPPING:WRITE`, rule audit writes, matching score/order, and public-port boundaries.
- Do not add dependencies, Redis, a queue, database migrations, or rule-data changes.
- Do not call a write endpoint against live data for benchmarking.
- Keep the established `{ success: true, data }` envelope.
- Do not commit documentation-only changes unless the user asks.

---

## File Structure

- Modify `src/modules/mapping/routes/index.js`: remove the two confirmed unused routes.
- Modify `src/modules/mapping/dtos/fulfillmentPlan.dto.js`: expose compact preview candidate summary instead of full candidate arrays.
- Modify `src/modules/mapping/services/fulfillmentPlan.service.js`: build independent preview reads concurrently and pass the compact DTO shape to HTTP preview and conflict responses.
- Modify `src/test/mapping/routes/index.test.js`: prove deleted routes are absent and retained routes still dispatch.
- Modify `src/test/mapping/services/fulfillmentPlan.service.test.js`: prove complete matching still chooses the same candidate while the HTTP DTO is compact.
- Modify `C:/Users/stack/Task/lng-web-fe/src/features/portal/mapping/api/mappingApi.ts`: remove the dead workbench API wrapper and update preview types.
- Modify `C:/Users/stack/Task/lng-web-fe/src/features/portal/mapping/model/mappingModel.ts`: derive trace candidate display from compact summary/auto-match.
- Modify `C:/Users/stack/Task/lng-web-fe/src/features/portal/mapping/components/LiveTracePanel.tsx`: show counts and the top/auto candidate; retain the explicit manual-search button.
- Modify `C:/Users/stack/Task/lng-web-fe/src/test/portal/mapping/model/mappingModel.test.ts`: cover compact preview trace rendering.
- Modify `src/test/shared/httpMetrics.test.js`: prove the existing metrics middleware emits a bounded label for the retained mapping preview route.

### Task 1: Remove confirmed dead API surfaces

**Files:**
- Modify: `src/modules/mapping/routes/index.js`
- Modify: `src/test/mapping/routes/index.test.js`
- Modify: `C:/Users/stack/Task/lng-web-fe/src/features/portal/mapping/api/mappingApi.ts`
- Test: `src/test/mapping/routes/index.test.js`

**Consumes:** Confirmed no current frontend caller for `GET /config-workbench` and the `confirm` alias.

**Produces:** No route at `/api/mapping/config-workbench` or `/api/mapping/order-items/:orderItemId/confirm`; `select` remains the only manual-confirmation API.

- [ ] **Step 1: Add route regression tests**

  Add assertions that `GET /config-workbench` and `POST /order-items/:id/confirm` return 404, while `POST /order-items/:id/select` still calls `selectFulfillmentPlan`.

  ```js
  expect(response.status).toBe(404);
  expect(service.selectFulfillmentPlan).toHaveBeenCalledWith(orderItemId, payload, expect.any(Object));
  ```

- [ ] **Step 2: Run the focused test and confirm failure**

  Run: `npm test -- --runInBand src/test/mapping/routes/index.test.js`

  Expected: the two 404 assertions fail while the routes still exist.

- [ ] **Step 3: Remove only the route definitions and unused imports/wrapper**

  Delete the `/config-workbench` route registration and the `/confirm` route registration. Remove `getMappingWorkbench()` and its unused type dependencies from `mappingApi.ts`; retain `selectFulfillmentCandidate()`.

- [ ] **Step 4: Run focused backend and frontend checks**

  Run:

  ```powershell
  npm test -- --runInBand src/test/mapping/routes/index.test.js
  Set-Location C:/Users/stack/Task/lng-web-fe
  npm run test:portal -- --runInBand src/test/portal/mapping/api/mappingApi.test.ts
  ```

  Expected: retained APIs dispatch; deleted surfaces return 404; frontend type/tests have no import of the removed wrapper.

### Task 2: Compact the preview response without changing selection

**Files:**
- Modify: `src/modules/mapping/dtos/fulfillmentPlan.dto.js`
- Modify: `src/modules/mapping/services/fulfillmentPlan.service.js`
- Modify: `src/test/mapping/services/fulfillmentPlan.service.test.js`

**Consumes:** `buildPreview()` continues to contain all vendor products/cost centers for `buildAutoMatch()`.

**Produces:** `toPreviewDto(preview)` returns `candidateSummary` and does not return `vendorProductCandidates` or `costCenterCandidates`.

- [ ] **Step 1: Add a failing DTO/service test**

  Build a preview fixture with two vendor products and 372 cost-center candidates. Assert the result preserves `autoMatch` and returns:

  ```js
  expect(result.candidateSummary).toEqual(expect.objectContaining({
    vendorProductCount: 2,
    costCenterCount: 372,
    topCandidate: expect.objectContaining({ id: 'cost-center-1', confidence: 'HIGH' }),
  }));
  expect(result).not.toHaveProperty('vendorProductCandidates');
  expect(result).not.toHaveProperty('costCenterCandidates');
  ```

- [ ] **Step 2: Run the focused test and confirm failure**

  Run: `npm test -- --runInBand src/test/mapping/services/fulfillmentPlan.service.test.js`

  Expected: assertions fail because current DTO includes both full arrays.

- [ ] **Step 3: Implement the compact DTO**

  Add `candidateSummary` in `toPreviewDto()` with counts from the internal arrays and `topCandidate` from the already-sorted first cost center. Reuse `compactCostCenter()`; do not rescore or requery. Remove the two full candidate arrays from this DTO only.

  Keep `buildPreview()` arrays unchanged because `buildAutoMatch()`, persistence, and manual override validation rely on complete internal data.

- [ ] **Step 4: Preserve blocked response compactness**

  Ensure both `previewFulfillmentPlan()` and the conflict details emitted by `persistReadyPlan()` use the same compact `toPreviewDto()`. A blocked response must expose checks/blockers/candidate counts without leaking hundreds of candidates.

- [ ] **Step 5: Run focused verification**

  Run:

  ```powershell
  npm test -- --runInBand src/test/mapping/services/fulfillmentPlan.service.test.js
  npm test -- --runInBand src/test/mapping/routes/index.test.js
  ```

  Expected: all existing selection/scoring tests pass after updating only assertions that intentionally expected full HTTP DTO arrays.

### Task 3: Keep the workbench usable with compact preview data

**Files:**
- Modify: `C:/Users/stack/Task/lng-web-fe/src/features/portal/mapping/api/mappingApi.ts`
- Modify: `C:/Users/stack/Task/lng-web-fe/src/features/portal/mapping/model/mappingModel.ts`
- Modify: `C:/Users/stack/Task/lng-web-fe/src/features/portal/mapping/components/LiveTracePanel.tsx`
- Modify: `C:/Users/stack/Task/lng-web-fe/src/test/portal/mapping/model/mappingModel.test.ts`

**Consumes:** Compact `MappingPreview.candidateSummary` and existing `searchVendorCandidates()`.

**Produces:** Trace panel displays candidate counts and one auto/top candidate; manual selection still opens `VendorCandidatePickerModal` and calls the existing search API.

- [ ] **Step 1: Add a failing mapping-model test**

  Feed `toMappingTraceView()` a compact preview with no candidate arrays and assert it exposes:

  ```ts
  expect(trace.candidateCount).toBe(372)
  expect(trace.topCandidate?.vendorCostCenterId).toBe('cost-center-1')
  expect(trace.candidates).toEqual([])
  ```

- [ ] **Step 2: Run the focused frontend test and confirm failure**

  Run:

  ```powershell
  Set-Location C:/Users/stack/Task/lng-web-fe
  npm run test:portal -- --runInBand src/test/portal/mapping/model/mappingModel.test.ts
  ```

  Expected: the compact fields do not exist in the current frontend model.

- [ ] **Step 3: Update types and trace model**

  Add `candidateSummary?: { vendorProductCount: number; costCenterCount: number; topCandidate: VendorCandidate | null }` to `MappingPreview`. Make `toMappingTraceView()` return `candidateCount`, `topCandidate`, and an empty `candidates` array when preview is compact.

- [ ] **Step 4: Simplify the trace panel**

  Replace the full candidate list with a concise candidate count plus one top/auto-match row. Keep `Find candidate` as the route to the existing paginated/manual picker; do not add a second candidate API.

- [ ] **Step 5: Run portal verification**

  Run:

  ```powershell
  Set-Location C:/Users/stack/Task/lng-web-fe
  npm run test:portal -- --runInBand src/test/portal/mapping/model/mappingModel.test.ts src/test/portal/mapping/pages/MappingWorkbenchPage.test.tsx
  npm run build
  ```

  Expected: the workbench compiles, compact preview renders, and manual picker behavior remains covered.

### Task 4: Reduce sequential work in the preview builder

**Files:**
- Modify: `src/modules/mapping/services/fulfillmentPlan.service.js`
- Modify: `src/test/mapping/services/fulfillmentPlan.service.test.js`

**Consumes:** Order item context loaded by `orderPublic.findItemById()`.

**Produces:** Independent reads run in parallel; matching result and call arguments remain unchanged.

- [ ] **Step 1: Add a concurrency-oriented service test**

  Use deferred promises for SKU-normalize rules, listing lookup, and customization view. Assert all three mocks are called before any deferred promise is resolved.

  ```js
  expect(mappingRuleService.listActiveSkuNormalizeRulesForContext).toHaveBeenCalled();
  expect(catalogPublic.findListingForOrderItem).toHaveBeenCalled();
  expect(customizationPublic.getOrderItemCustomizationView).toHaveBeenCalled();
  ```

- [ ] **Step 2: Run the focused test and confirm failure**

  Run: `npm test -- --runInBand src/test/mapping/services/fulfillmentPlan.service.test.js`

  Expected: current implementation awaits the SKU-rule query before starting listing/customization reads.

- [ ] **Step 3: Parallelize only independent reads**

  After loading the item, start SKU-normalize rules, canonical listing lookup, and customization view with `Promise.all`. Keep template lookup after listing resolution; keep vendor-cost-center lookup after product candidates are known. Preserve fallback SKU lookup and all existing error behavior.

- [ ] **Step 4: Run focused service verification**

  Run: `npm test -- --runInBand src/test/mapping/services/fulfillmentPlan.service.test.js`

  Expected: matching/scoring, fallback listing, customization and production-side-effect tests remain green.

### Task 5: Measure the delivered API and document operational evidence

**Files:**
- Modify: `src/test/shared/httpMetrics.test.js`
- Modify: `docs/mapping/MAPPING_MODULE_GUIDE.md`

**Consumes:** Existing optional metrics implementation loaded by `requestLogger`.

**Produces:** Route count/latency is observable when metrics are enabled; documentation names removed endpoints and compact-preview behavior.

- [ ] **Step 1: Add a failing route-label metrics test**

  Extend `httpMetrics.test.js` with an authenticated test-server request to `POST /api/mapping/order-items/:orderItemId/preview` using mocked mapping/auth middleware. Assert the registry exposes both metrics with the bounded route label `/api/mapping/order-items/:orderItemId/preview` and never contains the concrete ObjectId.

- [ ] **Step 2: Run the metric test and confirm failure**

  Run: `npm test -- --runInBand src/test/shared/httpMetrics.test.js`

  Expected: the mapping-route assertion fails before its test server/mocks are added.

- [ ] **Step 3: Add the smallest test-server setup needed for the assertion**

  Reuse the existing request logger and optional metrics registry. Do not add a mapping-specific logger, metric name, dependency, or persistent access-log collection.

- [ ] **Step 4: Add the mapping guide changes**

  Remove `confirm` and `config-workbench` from endpoint documentation. State that preview returns candidate counts/top candidate and that manual candidate retrieval uses `POST /order-items/:orderItemId/vendor-candidates/search`.

- [ ] **Step 5: Run final verification**

  Run:

  ```powershell
  npm test -- --runInBand src/test/mapping
  npm test -- --runInBand src/test/shared/httpMetrics.test.js
  npm run test:architecture -- --runInBand
  Set-Location C:/Users/stack/Task/lng-web-fe
  npm run build
  ```

  Then run a read-only preview profile against a fixture or authorized local API and record response bytes plus warm latency. Acceptance is a materially smaller preview payload with unchanged `autoMatch`; do not claim a latency percentage until the measured output is available.
