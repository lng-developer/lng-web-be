# Catalog GET Read-Path Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the known N+1 query from listing variants and reduce repeated master-data and summary reads while preserving every existing Catalog GET response contract.

**Architecture:** Keep controllers and routes unchanged. Put query-shape changes in Catalog/Shop repositories, compose them through their existing services and the Shop public port, and continue to return DTOs rather than persistence documents. A read-only benchmark measures warm latency and concurrent behavior before deciding on cache, indexes, cluster capacity, or a read model.

**Tech Stack:** Node.js CommonJS, Express, Mongoose, MongoDB aggregation, Jest.

**Spec:** This plan implements the 2026-09-04 Catalog GET audit: P0 variant batching; P1 summary aggregation and listing-options projections. CSV export semantics and sales ranking projections are explicitly deferred behind product decisions below.

## Global Constraints

- Preserve `GET /api/catalog/listings/:id/variants`, `/listings/summary`, and `/listing-options` status codes and JSON fields.
- Preserve current `noPsdCount` semantics: a Listing whose `defaultPsdTemplateAssetId` is `null` or missing. Do not redefine it as effective variant/template PSD readiness in this change.
- Preserve authorization and scoped-shop filtering.
- Read-only Mongoose queries use `.lean()`; cross-module Shop access goes only through `src/modules/shop/public.js`.
- Do not add cache, indexes, dependencies, migrations, or background jobs.
- Do not commit to the dirty `develop` worktree unless the user explicitly asks.
- Run load checks only against a local/staging backend and a non-production database with representative data; do not create, change, or delete production records for benchmarking.

---

## File Structure

- Modify `src/modules/catalog/services/listingVariant.service.js`: batch template hydration for the list endpoint only.
- Modify `src/modules/catalog/repositories/listing.repository.js`: replace eight summary reads with one aggregation.
- Modify `src/modules/catalog/repositories/productTypeGroup.repository.js`: add a compact active-options query with no total count.
- Modify `src/modules/catalog/repositories/internalTemplate.repository.js`: add a compact active-options aggregation with template counts and compact Product Type Group data.
- Modify `src/modules/catalog/dtos/internalTemplate.dto.js`: expose a dedicated options DTO mapper; preserve the existing standard/detail mappers.
- Modify `src/modules/catalog/services/listing.service.js`: consume specialized Catalog and Shop option reads.
- Modify `src/modules/shop/repositories/shop.repository.js` and `src/modules/shop/public.js`: expose a compact active-shop options read through the public port.
- Modify `tests/catalog/services/listingVariant.service.test.js` and `tests/catalog/repositories/listing.repository.test.js`: prove query count and response compatibility.
- Create `tests/catalog/services/listing.service.test.js`: prove options use specialized reads and preserve its response shape.
- Modify `tests/shop/repositories/shop.repository.test.js` and `tests/shop/public.test.js`: prove the new Shop public-port operation remains scoped and projection-only.

## Task 1: Batch GET listing-variant readiness dependencies (P0)

**Files:**
- Modify: `src/modules/catalog/services/listingVariant.service.js:84-96,202-205`
- Modify: `tests/catalog/services/listingVariant.service.test.js:1-65`

**Interfaces:**
- Consumes: `listingRepository.findById(listingId)`, `repository.listByListing(listingId)`, and `internalTemplateRepository.findByIds(templateIds)`.
- Produces: `listListingVariants(listingId, authContext)` returning the unchanged array of `toListingVariantDto` fields plus `psdReadiness`.

- [x] **Step 1: Add a failing list-endpoint batching test**

  Extend the Internal Template repository mock with `findByIds`. Add a test with three variants, two of which share one template:

  ```js
  test('lists variants with one listing read and one deduplicated template batch', async () => {
    variantRepository.listByListing.mockResolvedValue([
      { _id: 'v1', listingId, internalTemplateId: 't1', status: 'ACTIVE' },
      { _id: 'v2', listingId, internalTemplateId: 't1', status: 'ACTIVE' },
      { _id: 'v3', listingId, internalTemplateId: 't2', status: 'ACTIVE' },
    ]);
    templateRepository.findByIds.mockResolvedValue([
      { _id: 't1', status: 'ACTIVE', requiresPsd: true },
      { _id: 't2', status: 'ACTIVE', requiresPsd: true },
    ]);

    const result = await service.listListingVariants(listingId, { system: true });

    expect(result).toHaveLength(3);
    expect(listingRepository.findById).toHaveBeenCalledTimes(1);
    expect(templateRepository.findByIds).toHaveBeenCalledWith(['t1', 't2']);
    expect(templateRepository.findById).not.toHaveBeenCalled();
  });
  ```

- [x] **Step 2: Run the focused test and confirm the pre-change failure**

  Run: `npm test -- --runInBand tests/catalog/services/listingVariant.service.test.js`

  Expected: the new assertion fails because `listListingVariants` maps each row through `toDetail`, which calls `findById` once per template and once per listing.

- [x] **Step 3: Add the smallest list-specific hydrator**

  Keep `toDetail(variant)` for single-variant mutation/detail paths. Add a separate helper for list rows that accepts the already-authorized Listing, deduplicates non-empty `internalTemplateId` values, calls `internalTemplateRepository.findByIds` once, builds a `Map(String(template._id), template)`, and maps rows synchronously:

  ```js
  async function toDetailsForListing(variants = [], listing) {
    const templateIds = [...new Set(variants
      .map((variant) => toPlainId(variant.internalTemplateId))
      .filter(Boolean))];
    const templates = templateIds.length
      ? await internalTemplateRepository.findByIds(templateIds)
      : [];
    const templatesById = new Map(templates.map((template) => [toPlainId(template), template]));

    return variants.map((variant) => ({
      ...toListingVariantDto(variant),
      psdReadiness: resolvePsdReadiness(
        variant,
        templatesById.get(toPlainId(variant.internalTemplateId)) || null,
        'LISTING_VARIANT',
        listing,
      ),
    }));
  }
  ```

  Change only `listListingVariants` to retain the return value of `loadListing` and pass it to this helper.

- [x] **Step 4: Run focused regression tests**

  Run: `npm test -- --runInBand tests/catalog/services/listingVariant.service.test.js`

  Expected: PASS. Also verify the existing single-variant tests still prove `toDetail` works for mutation paths.

## Task 2: Collapse Listing Summary into one aggregation (P1)

**Files:**
- Modify: `src/modules/catalog/repositories/listing.repository.js:125-169`
- Modify: `tests/catalog/repositories/listing.repository.test.js:64-113`

**Interfaces:**
- Consumes: `buildFilter(filters)` unchanged.
- Produces: `summarize(filters)` returning exactly `{ totalListingCount, amazonListingCount, etsyListingCount, draftCount, approvedCount, rejectedCount, noPsdCount, channelCounts }`.

- [x] **Step 1: Replace the repository test with a single-aggregate contract test**

  Mock one aggregation result and assert no counts are run:

  ```js
  Listing.aggregate.mockResolvedValue([{
    totals: [{
      totalListingCount: 10,
      amazonListingCount: 6,
      etsyListingCount: 4,
      draftCount: 5,
      approvedCount: 4,
      rejectedCount: 1,
      noPsdCount: 2,
    }],
    channelCounts: [{ code: 'AMAZON', count: 6 }, { code: 'ETSY', count: 4 }],
  }]);

  await expect(repository.summarize({ shopId: shopId })).resolves.toEqual({ /* exact old DTO */ });
  expect(Listing.aggregate).toHaveBeenCalledTimes(1);
  expect(Listing.countDocuments).not.toHaveBeenCalled();
  ```

  Add a second assertion for an empty facet result returning numeric zeroes and `channelCounts: []`.

- [x] **Step 2: Run the repository test and confirm the pre-change failure**

  Run: `npm test -- --runInBand tests/catalog/repositories/listing.repository.test.js`

  Expected: FAIL because the repository invokes seven `countDocuments` calls and expects a separate channel aggregation shape.

- [x] **Step 3: Implement one `$match` plus `$facet` pipeline**

  Replace `Promise.all` with one `Listing.aggregate`:

  ```js
  const [result = {}] = await Listing.aggregate([
    { $match: filter },
    { $facet: {
      totals: [{ $group: {
        _id: null,
        totalListingCount: { $sum: 1 },
        amazonListingCount: { $sum: { $cond: [{ $eq: ['$salesChannelCode', salesChannelCodes.AMAZON] }, 1, 0] } },
        etsyListingCount: { $sum: { $cond: [{ $eq: ['$salesChannelCode', salesChannelCodes.ETSY] }, 1, 0] } },
        draftCount: { $sum: { $cond: [{ $eq: ['$qcStatus', listingQcStatuses.DRAFT] }, 1, 0] } },
        approvedCount: { $sum: { $cond: [{ $eq: ['$qcStatus', listingQcStatuses.APPROVED] }, 1, 0] } },
        rejectedCount: { $sum: { $cond: [{ $eq: ['$qcStatus', listingQcStatuses.REJECTED] }, 1, 0] } },
        noPsdCount: { $sum: { $cond: [{ $eq: ['$defaultPsdTemplateAssetId', null] }, 1, 0] } },
      } }],
      channelCounts: [
        { $group: { _id: '$salesChannelCode', count: { $sum: 1 } } },
        { $project: { _id: 0, code: '$_id', count: 1 } },
        { $sort: { code: 1 } },
      ],
    } },
  ]);
  ```

  Normalize absent `totals[0]` to the existing zero-value response. Do not alter `buildFilter`, permissions, controller validation, or PSD semantics.

- [x] **Step 4: Run focused regression tests**

  Run: `npm test -- --runInBand tests/catalog/repositories/listing.repository.test.js tests/catalog/routes/index.test.js`

  Expected: PASS and no route response change.

## Task 3: Give Listing Options compact, count-free reads (P1)

**Files:**
- Modify: `src/modules/catalog/repositories/productTypeGroup.repository.js:28-40`
- Modify: `src/modules/catalog/repositories/internalTemplate.repository.js:51-62`
- Modify: `src/modules/catalog/dtos/internalTemplate.dto.js`
- Modify: `src/modules/catalog/services/listing.service.js:379-400`
- Modify: `src/modules/shop/repositories/shop.repository.js:41-55`
- Modify: `src/modules/shop/public.js:29-45`
- Create: `tests/catalog/services/listing.service.test.js`
- Modify: `tests/shop/repositories/shop.repository.test.js`
- Modify: `tests/shop/public.test.js`

**Interfaces:**
- Produces `productTypeGroupRepository.listActiveForOptions()` → lean rows needed by `toProductTypeGroupDto`.
- Produces `internalTemplateRepository.listActiveForOptions()` → rows with compact Product Type Group and precomputed array counts.
- Produces `shopPublic.listActiveShopOptions({ shopIds })` → compact active Shop rows only.
- Consumes those methods in `getListingOptions(authContext)` and preserves its JSON fields.

- [x] **Step 1: Write the failing Catalog options service test**

  Mock the three specialized reads and assert the old paginated methods are not used:

  ```js
  shopPublic.listActiveShopOptions.mockResolvedValue([{ _id: shopId, name: 'US Shop', currency: 'USD', status: 'ACTIVE' }]);
  productTypeGroupRepository.listActiveForOptions.mockResolvedValue([{ _id: groupId, code: 'TSHIRT', name: 'T-Shirt', status: 'ACTIVE' }]);
  internalTemplateRepository.listActiveForOptions.mockResolvedValue([{ _id: templateId, code: 'TS-01', name: 'T-Shirt', status: 'ACTIVE', requiredFieldsCount: 2, artworkSlotsCount: 1, designAssetsCount: 3 }]);

  const result = await service.getListingOptions({ system: true });

  expect(result.internalTemplates[0]).toEqual(expect.objectContaining({ id: templateId, requiredFieldsCount: 2 }));
  expect(shopPublic.listActiveShops).not.toHaveBeenCalled();
  ```

- [x] **Step 2: Run the new service test and confirm the pre-change failure**

  Run: `npm test -- --runInBand tests/catalog/services/listing.service.test.js`

  Expected: FAIL because `getListingOptions` calls three paginated list functions and accesses `.items`.

- [x] **Step 3: Add smallest specialized reads without changing generic list APIs**

  Add `recordStatuses` to the Product Type Group repository imports and `shopStatuses` to the Shop repository imports. Implement these focused repository/port functions:

  ```js
  // productTypeGroup.repository.js
  const listActiveForOptions = () => ProductTypeGroup.find({ status: recordStatuses.ACTIVE })
    .select('code name sortOrder printMethod status createdAt updatedAt')
    .sort({ sortOrder: 1, name: 1, code: 1, _id: 1 })
    .lean();

  // shop.repository.js
  const listActiveForOptions = ({ shopIds } = {}) => Shop.find(buildFilter({
    status: shopStatuses.ACTIVE, shopIds,
  })).select('name currency status').sort({ createdAt: -1, _id: -1 }).lean();
  ```

  For templates, add `recordStatuses` to the existing constants import and use this one aggregation instead of `find + count + populate`:

  ```js
  const listActiveForOptions = () => InternalTemplate.aggregate([
    { $match: { status: recordStatuses.ACTIVE } },
    { $sort: { code: 1, _id: 1 } },
    { $lookup: {
      from: 'producttypegroups',
      localField: 'productTypeGroupId',
      foreignField: '_id',
      as: 'productTypeGroup',
    } },
    { $unwind: { path: '$productTypeGroup', preserveNullAndEmptyArrays: true } },
    { $project: {
      code: 1,
      name: 1,
      description: 1,
      requiresPsd: 1,
      status: 1,
      productTypeGroupId: {
        _id: '$productTypeGroup._id',
        code: '$productTypeGroup.code',
        name: '$productTypeGroup.name',
        printMethod: '$productTypeGroup.printMethod',
        status: '$productTypeGroup.status',
      },
      requiredFieldsCount: { $size: { $ifNull: ['$requiredFields', []] } },
      artworkSlotsCount: { $size: { $ifNull: ['$artworkSlots', []] } },
      designAssetsCount: { $size: { $ifNull: ['$designAssets', []] } },
    } },
  ]);
  ```

  Add `toInternalTemplateOptionDto(template)` beside `toInternalTemplateDto`. It must return the same keys as the latter’s non-detail branch but use `template.requiredFieldsCount || 0`, `template.artworkSlotsCount || 0`, and `template.designAssetsCount || 0` rather than reading the omitted arrays. Expose Shop’s function only through `shop/public.js`; Catalog must not import Shop internals.

- [x] **Step 4: Switch `getListingOptions` and preserve scope**

  Replace the current three paginated calls with:

  ```js
  const [shops, productTypeGroups, internalTemplates] = await Promise.all([
    shopPublic.listActiveShopOptions({ shopIds }),
    productTypeGroupRepository.listActiveForOptions(),
    internalTemplateRepository.listActiveForOptions(),
  ]);
  ```

  Keep the existing `shopIds` calculation, sales-channel mapping, Shop mapping, and Product Type Group DTO mapping. Map templates with `toInternalTemplateOptionDto`.

- [x] **Step 5: Run focused module tests**

  Run: `npm test -- --runInBand tests/catalog/services/listing.service.test.js tests/catalog/routes/index.test.js tests/shop/repositories/shop.repository.test.js tests/shop/public.test.js`

  Expected: PASS. Verify scoped `shopIds: []` still returns an empty shop array without a broad Shop query.

## Task 4: Verify query shape and API compatibility

**Files:**
- No production file changes expected.

**Interfaces:**
- Verifies the three endpoint contracts produced by Tasks 1–3.

- [x] **Step 1: Syntax-check every changed CommonJS file**

  Run:

  ```powershell
  node -c src/modules/catalog/services/listingVariant.service.js
  node -c src/modules/catalog/repositories/listing.repository.js
  node -c src/modules/catalog/repositories/productTypeGroup.repository.js
  node -c src/modules/catalog/repositories/internalTemplate.repository.js
  node -c src/modules/catalog/dtos/internalTemplate.dto.js
  node -c src/modules/catalog/services/listing.service.js
  node -c src/modules/shop/repositories/shop.repository.js
  node -c src/modules/shop/public.js
  ```

  Expected: every command exits `0`.

- [x] **Step 2: Run the Catalog and architecture gates**

  Run:

  ```powershell
  npm test -- --runInBand tests/catalog/services/listingVariant.service.test.js tests/catalog/services/listing.service.test.js tests/catalog/repositories/listing.repository.test.js tests/catalog/routes/index.test.js tests/shop/repositories/shop.repository.test.js tests/shop/public.test.js
  npm run test:architecture -- --runInBand
  ```

  Expected: all selected tests and architecture tests pass.

- [ ] **Step 3: Verify the changes against a running backend without writing data**

  With an authenticated browser session, make one request each to the existing endpoint URLs and compare only field names/types to a pre-change response:

  ```text
  GET /api/catalog/listings/:id/variants
  GET /api/catalog/listings/summary
  GET /api/catalog/listing-options
  ```

  Confirm from MongoDB command monitoring or a temporary development-only trace that variant listing uses one Listing read plus one template batch, summary uses one aggregate, and options executes one read per source. Remove temporary tracing before production use; do not add permanent timing output.

## Task 5: Measure warm and concurrent read behavior

**Files:**
- Create: `tools/scripts/benchmarks/catalogGetReadPath.js`
- Modify: `package.json` to add `benchmark:catalog-get-read-path`.

**Interfaces:**
- Consumes environment variables `CATALOG_BENCHMARK_BASE_URL`, `CATALOG_BENCHMARK_TOKEN`, and `CATALOG_BENCHMARK_LISTING_ID`.
- Produces one JSON report to stdout with per-scenario request count, success/error count, requests per second, and latency `p50`, `p95`, and `p99` in milliseconds.

- [x] **Step 1: Add a deterministic read-only benchmark runner**

  Use Node’s built-in `fetch`, `performance.now`, and `Promise.all`; do not add `autocannon` or another permanent dependency. Reject execution unless all three environment variables exist. Build authorized GET requests with the existing bearer token and never send a mutating method.

  Define these scenarios exactly:

  ```js
  const scenarios = [
    { name: 'listing-options', path: '/api/catalog/listing-options' },
    { name: 'listing-summary', path: '/api/catalog/listings/summary' },
    { name: 'listing-page', path: '/api/catalog/listings?page=1&limit=20' },
    { name: 'listing-variants', path: `/api/catalog/listings/${listingId}/variants` },
    { name: 'dashboard-mix', paths: [
      '/api/catalog/listing-options',
      '/api/catalog/listings/summary',
      '/api/catalog/listings?page=1&limit=20',
      '/api/catalog/listings?page=1&limit=5&sort=quantitySoldDesc',
    ] },
  ];
  ```

  Each request records elapsed milliseconds, status, and a compact error message. Treat only HTTP `200` as success. Sort successful latency samples numerically and compute percentile index `Math.ceil(samples.length * percentile) - 1`; emit `null` for latency percentiles when there are no successes.

- [x] **Step 2: Add runner self-checks without network access**

  Export `percentile(samples, percentile)` and `summarize(samples)` from the script. Add a Node assertion block invoked by `npm run benchmark:catalog-get-read-path -- --self-test`:

  ```js
  assert.equal(percentile([10, 20, 30, 40], 0.5), 20);
  assert.equal(percentile([10, 20, 30, 40], 0.95), 40);
  assert.deepEqual(summarize([]), { count: 0, p50: null, p95: null, p99: null });
  ```

  Run: `npm run benchmark:catalog-get-read-path -- --self-test`

  Expected: exits `0` without contacting a backend.

- [ ] **Step 3: Run the benchmark in staged load steps**

  Use a valid Catalog-read token and a Listing ID that has variants. Run one 10-request sequential warm-up per scenario; discard this output. Then run each scenario at 10, 25, and 50 concurrent users, with 20 requests per user. A user executes one request for single-path scenarios; a dashboard-mix user executes its four paths sequentially, reproducing one dashboard refresh without artificial parallelism.

  Example PowerShell invocation:

  ```powershell
  $env:CATALOG_BENCHMARK_BASE_URL = 'http://localhost:3000'
  node scripts/benchmark/catalog-get-read-path.js --concurrency 10 --requests-per-user 20
  node scripts/benchmark/catalog-get-read-path.js --concurrency 25 --requests-per-user 20
  node scripts/benchmark/catalog-get-read-path.js --concurrency 50 --requests-per-user 20
  ```

  Set `CATALOG_BENCHMARK_TOKEN` and `CATALOG_BENCHMARK_LISTING_ID` in the current shell before these commands, without printing or saving either value. Save the JSON output outside the repository or attach it to the implementation report; never save bearer tokens or connection strings in source control.

- [ ] **Step 4: Capture database evidence during the 25- and 50-user runs**

  In MongoDB Atlas monitoring, record the same time window’s connections, operation rate, read units, CPU, and query latency. Capture slow-query/Profiler evidence only if enabled already; do not enable an invasive profiler on production for this task.

  Interpret results with this decision table:

  | Observation | Decision |
  |---|---|
  | `p95` improves after Tasks 1–3 and error rate is zero; Atlas resource graphs stay flat | Ship query changes; no cache or new index. |
  | Latency rises with concurrency while Atlas connections/CPU/read units rise and query execution remains short | Capacity/connection-pool/Atlas-tier constraint; do not add an index as a workaround. |
  | One endpoint has high query duration and its `explain('executionStats')` examines far more keys/documents than returned | Audit that endpoint’s filter/sort and add only a measured ESR-aligned index. |
  | Only sales-sort degrades as OrderItem volume grows | Start the separate Listing Sales Projection plan. |
  | Options/Summary are fast in DB but repeat excessively per browser session | Consider explicit invalidation cache only after measuring request repetition. |

- [ ] **Step 5: Run completion checks**

  Run:

  ```powershell
  node scripts/benchmark/catalog-get-read-path.js --self-test
  npm test -- --runInBand tests/catalog/services/listingVariant.service.test.js tests/catalog/services/listing.service.test.js tests/catalog/repositories/listing.repository.test.js tests/catalog/routes/index.test.js tests/shop/repositories/shop.repository.test.js tests/shop/public.test.js
  npm run test:architecture -- --runInBand
  ```

  Expected: the benchmark self-check, focused tests, and architecture test all pass. Report the 10/25/50-user JSON results separately from unit-test success.

## Explicitly Deferred Decisions

### CSV export

`GET /listings/export.csv` currently fetches and enriches one page of up to 5,000 rows in memory. It does not export all 8,288 current Listings. The execution choice changes the API behavior and must be approved first:

1. **Bounded export:** keep the 5,000-row contract and add a clear client-visible warning before download. Lowest implementation cost; not an all-record export.
2. **Full export:** implement a separate streaming cursor/export-job design. Correct for all records, but requires a defined file delivery and retention policy.

Do not silently change the cap or reuse the enriched listing list for an unbounded response.

### Sales-ranked listing read model

`sort=orderCountDesc|quantitySoldDesc|lastSoldAtDesc` already starts from `OrderItem` with `$group → $sort → $limit 5`; this is correct for the present top-five requirement. When actual OrderItem volume makes the measured aggregate exceed the endpoint SLO, create a separate plan to maintain a Listing Sales Projection at order-import/status transitions and read top five through an indexed projection. Do not add this projection before the measured threshold is reached.

## Self-Review

- Spec coverage: Task 1 covers the P0 N+1 issue; Task 2 covers summary’s eight reads; Task 3 covers options’ paginated/count/populate overhead; Task 4 supplies syntax, unit, architecture, and runtime compatibility checks.
- Deferred work: CSV semantics and sales projections are deliberately gated because each changes a business/API contract or has no current performance evidence requiring it.
- Placeholder scan: no implementation step relies on unspecified function names or implicit test behavior; all new repository/public methods are named in Task 3.
- Type consistency: `listActiveForOptions` returns persistence rows for Catalog repositories; `listActiveShopOptions` is the sole Shop cross-module public API; `toInternalTemplateOptionDto` emits the pre-existing compact template response shape.
