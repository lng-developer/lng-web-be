# ListingLaunch Phase 1

Backend API for unpublished Amazon candidate briefs and product selection.

## Scope

One launch belongs to one shop and marketplace. Phase 1 supports `BRIEF -> PRODUCT_SELECTED`. It stores selected Catalog IDs without creating marketplace Listings, ListingVariants, DesignTasks, or files. AI generation, export, import reconciliation, UI, and seller upload remain later work.

## Permissions

All routes require authentication. Reads accept `CATALOG:READ` or `CATALOG:WRITE`; writes require `CATALOG:WRITE`. Permissions may be global or granted to the exact launch shop using Auth scoped RBAC. A list without an explicit shop is limited to readable shops. An explicit inaccessible shop is forbidden. `shopId`, channel, marketplace, state, and actor fields cannot be modified through PATCH.

## Endpoints

| Method | Path | Result |
| --- | --- | --- |
| POST | `/api/listing-launches` | Create a BRIEF, HTTP 201 |
| GET | `/api/listing-launches` | Paginated drafts, HTTP 200 |
| GET | `/api/listing-launches/:id` | One draft, HTTP 200 |
| PATCH | `/api/listing-launches/:id` | Edit brief/reference IDs, HTTP 200 |
| POST | `/api/listing-launches/:id/select-product` | Select once, HTTP 200 |

Create payload:

```json
{
  "shopId": "660000000000000000000201",
  "marketplaceCode": "AMAZON_US",
  "brief": "Floral design for a T-shirt collection",
  "workingTitle": "Floral tee pilot",
  "referenceAssetIds": []
}
```

`salesChannelCode` defaults to `AMAZON`; other channels are rejected. The shop must exist and be active. `workingTitle` is an operator label, not SEO copy. `brief` is required (1–5000 characters); `workingTitle` is optional (up to 500 characters). Unknown request fields are rejected.

Select payload:

```json
{
  "productTypeGroupId": "660000000000000000000301",
  "internalTemplateId": "660000000000000000000701"
}
```

Both selected resources must be active, and the template must belong to that product type group. Selection records the actor and timestamp. The update atomically checks `state=BRIEF`; a second/concurrent selection returns HTTP 409 without overwriting the winner.

PATCH accepts only `brief`, `workingTitle`, and `referenceAssetIds`, in both states. Selection cannot be reset/replaced in this phase. Reference IDs are shape-validated (at most 50 distinct ObjectIds) but are not resolved, downloaded, or treated as approved assets. Before any later generation/export use, that phase must check Media existence, readiness, ownership/access, and rights.

Responses use `{ "success": true, "data": ... }`; list data includes `items`, `total`, `page`, and `limit`, following the shared pagination helper. List query accepts `shopId`, `state`, `page`, and `limit`. Validation errors use HTTP 400, missing resources 404, denied permissions 403, and selection conflicts 409. No provider credentials are needed for this phase; the API uses the existing application login.

## Implementation decisions and limits

- The plan's generic repository update is extended with a conditional selection write to enforce select-once under concurrency.
- Validation uses a local helper; Catalog controller/validator internals cannot be imported across the module boundary.
- Existing Catalog draft and order-import paths remain valid; only launches created by this new workflow defer Catalog writes until future reconciliation.
- Product selection stores live references, not immutable snapshots. A future generation/export stage must revalidate and capture the inputs it uses.
- Existing Catalog permissions deliberately also grant launch access. Dedicated launch permissions can be introduced if the organization needs separate operators.
- Brief edits use last-write-wins. There is no edit history, cancel/reopen, bulk generation, or create-idempotency mechanism in Phase 1.

## Verification

Local implementation verification (2026-09-15): combined ListingLaunch, Catalog, Auth, and architecture run passed 53 suites / 445 tests; 1 existing suite / 12 tests were skipped. Runtime JS syntax and diff whitespace checks passed. The integration test uses real Catalog/Shop public ports against ephemeral MongoDB and proves one concurrent selection winner with zero Catalog Listing/ListingVariant writes.

Production disables Mongoose `autoIndex`. During an approved deployment, create the new collection's declared indexes before enabling volume traffic; do not call `syncIndexes()` on existing Catalog collections. Local verification does not deploy the API or modify production data.

Run focused launch/Catalog tests, the repository architecture suite, and JavaScript syntax checks. Mongo-backed tests must use ephemeral `MongoMemoryServer`, never a production connection.

```powershell
npx jest tests/listingLaunch tests/catalog --runInBand
npm run test:architecture -- --runInBand
Get-ChildItem src/modules/listingLaunch -Recurse -Filter *.js | ForEach-Object { node -c $_.FullName }
git diff --check
```
