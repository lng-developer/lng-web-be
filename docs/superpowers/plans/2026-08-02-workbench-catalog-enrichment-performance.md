# Workbench Catalog Enrichment Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce workbench latency by running independent catalog template and media enrichment reads concurrently without changing API output.

**Architecture:** Keep the existing listing summary query as the first step. Once listings are available, run `attachTemplateRefs(listings)` and `attachAssetRefs(listings)` concurrently, then merge the media fields onto the template-enriched rows by stable array position.

**Tech Stack:** Node.js, CommonJS, Jest, MongoDB/Mongoose, k6

## Global Constraints

- Preserve the `getListingSummariesByIds(listingIds)` public-port signature and response fields.
- Do not change DTOs, repositories, indexes, caching, production enrichment, MongoDB configuration, or public-port contracts.
- Keep cross-module calls through each target module's `public.js`.
- Do not commit unless the user explicitly requests it.

---

### Task 1: Parallelize independent catalog enrichment

**Files:**
- Modify: `src/test/catalog/services/catalog.service.test.js`
- Modify: `src/modules/catalog/services/listing.service.js:518-522`

**Interfaces:**
- Consumes: `listingRepository.findSummariesByIds(ids)`, `templateRepository.findByIds(ids)`, and `mediaPublic.getAssetsByIds(ids)`.
- Produces: unchanged `getListingSummariesByIds(listingIds)` results containing `internalTemplateDetail`, `psdReadiness`, `previewAsset`, and `psdTemplateAsset`.

- [ ] **Step 1: Write the failing concurrency test**

Add `findSummariesByIds: jest.fn()` to the listing repository mock. Add a test that returns one listing with both `internalTemplateId` and `previewAssetId`, makes template and media mocks return unresolved promises, invokes `service.getListingSummariesByIds([listingId])`, yields one microtask, and asserts both mocks have already been called before resolving either promise. Resolve both promises and assert the returned row contains the template readiness and preview asset reference.

```js
test('loads listing template and media references concurrently', async () => {
  let resolveTemplates;
  let resolveAssets;
  const templates = new Promise((resolve) => { resolveTemplates = resolve; });
  const assets = new Promise((resolve) => { resolveAssets = resolve; });
  listingRepository.findSummariesByIds.mockResolvedValue([
    listingFixture({ internalTemplateId: templateId, previewAssetId }),
  ]);
  templateRepository.findByIds.mockReturnValue(templates);
  mediaPublic.getAssetsByIds.mockReturnValue(assets);

  const resultPromise = service.getListingSummariesByIds([listingId]);
  await Promise.resolve();

  expect(templateRepository.findByIds).toHaveBeenCalledWith([templateId]);
  expect(mediaPublic.getAssetsByIds).toHaveBeenCalledWith([previewAssetId]);

  resolveTemplates([templateFixture()]);
  resolveAssets([{ _id: previewAssetId, url: 'https://example.test/preview.png' }]);
  const [result] = await resultPromise;
  expect(result.internalTemplateDetail._id).toBe(templateId);
  expect(result.previewAsset._id).toBe(previewAssetId);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```powershell
npx jest src/test/catalog/services/catalog.service.test.js --runInBand
```

Expected: the new assertion for `mediaPublic.getAssetsByIds` fails because the existing implementation waits for template enrichment first.

- [ ] **Step 3: Implement the minimum parallel merge**

Replace the nested awaits in `getListingSummariesByIds` with one listing query followed by `Promise.all`. Preserve positional order and copy only the two media attachment fields from the asset-enriched row.

```js
const listings = await listingRepository.findSummariesByIds(uniqueIds);
const [withTemplates, withAssets] = await Promise.all([
  attachTemplateRefs(listings),
  attachAssetRefs(listings),
]);
return withTemplates.map((listing, index) => ({
  ...listing,
  previewAsset: withAssets[index]?.previewAsset || null,
  psdTemplateAsset: withAssets[index]?.psdTemplateAsset || null,
}));
```

- [ ] **Step 4: Run focused verification and verify GREEN**

Run:

```powershell
node -c src/modules/catalog/services/listing.service.js
npx jest src/test/catalog/services/catalog.service.test.js --runInBand
npm run test:architecture -- --runInBand
```

Expected: syntax exits 0; catalog and architecture suites report zero failures.

- [ ] **Step 5: Benchmark the affected endpoint**

Run the existing `test/load/expected-load.js` against `/api/orders/workbench?limit=50` at 5 VU and then 10 VU, using 5-second ramp-up, 20-second steady load, and 5-second ramp-down.

Expected: 0 percent request errors. Compare p95 against the existing 425 ms at 5 VU and 1.02 seconds at 10 VU; the acceptance threshold remains p95 below 1 second.

- [ ] **Step 6: Stop or continue at the measured boundary**

If 10 VU p95 is below 1 second, stop. If it still exceeds 1 second, report the result and propose a separate production-enrichment slice; do not broaden this task automatically.
