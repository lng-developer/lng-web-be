# Task 1 report — Structured inputs and input versioning

## Status

DONE

Implemented only ListingLaunch Phase 2 Task 1 on `EC/listing-launch-phase-2` from baseline `c1c88193`. No provider, queue, run/version, external API, other-module write, deployment, or push work was added.

## RED evidence

Core behavior was written first in `tests/listingLaunch/services/listingContentInput.service.test.js` and run against a nonfunctional export shell:

```text
node node_modules/jest/bin/jest.js tests/listingLaunch/services/listingContentInput.service.test.js --runInBand
Test Suites: 1 failed, 1 total
Tests:       7 failed, 7 total
```

Failures covered confirmed input persistence, selected-only/profile constraints, exact-shop WRITE access, stale CAS, simultaneous saves, edit invalidation, and canonical snapshot/hash behavior.

The HTTP contract and route inventory were then written before registering the route:

```text
node node_modules/jest/bin/jest.js tests/listingLaunch/routes/index.test.js tests/listingLaunch/architecture/listingLaunch.architecture.test.js --runInBand
Test Suites: 2 failed, 2 total
Tests:       19 failed, 23 passed, 42 total
```

The expected failures were 404/missing inventory entries for `PUT /api/listing-launches/:id/content-inputs`.

## GREEN evidence

Core behavior after the minimum model/repository/service/DTO implementation:

```text
node node_modules/jest/bin/jest.js tests/listingLaunch/services/listingContentInput.service.test.js --runInBand
Test Suites: 1 passed, 1 total
Tests:       7 passed, 7 total
```

HTTP boundary after Joi/controller/route implementation:

```text
node node_modules/jest/bin/jest.js tests/listingLaunch/routes/index.test.js tests/listingLaunch/architecture/listingLaunch.architecture.test.js --runInBand
Test Suites: 2 passed, 2 total
Tests:       42 passed, 42 total
```

Required focused gate:

```text
node node_modules/jest/bin/jest.js tests/listingLaunch --runInBand
Test Suites: 8 passed, 8 total
Tests:       64 passed, 64 total
```

The focused gate emits the pre-existing Mongoose 9 `validateSync()` deprecation warnings from P1 model tests; it has no test failures.

## Changed files

- `src/modules/listingLaunch/constants/listingContentProfile.js`
- `src/modules/listingLaunch/models/listingLaunch.model.js`
- `src/modules/listingLaunch/repositories/listingLaunch.repository.js`
- `src/modules/listingLaunch/services/listingLaunch.service.js`
- `src/modules/listingLaunch/services/listingContentInput.service.js`
- `src/modules/listingLaunch/validators/listingLaunch.validator.js`
- `src/modules/listingLaunch/controllers/listingLaunch.controller.js`
- `src/modules/listingLaunch/routes/index.js`
- `src/modules/listingLaunch/dtos/listingLaunch.dto.js`
- `tests/listingLaunch/services/listingContentInput.service.test.js`
- `tests/listingLaunch/services/listingLaunch.service.test.js`
- `tests/listingLaunch/routes/index.test.js`
- `tests/listingLaunch/architecture/listingLaunch.architecture.test.js`

## Exported interfaces for later tasks

`constants/listingContentProfile.js` exports:

- `listingContentProfile`: code `AMAZON_US_APPAREL_CONTENT_V1`, profile version `1`, marketplace/language, and the internal content limits from the design.

`services/listingContentInput.service.js` exports:

- `saveContentInputs(launchId, payload, auth)` — exact-shop `CATALOG:WRITE`, selected launch and supported profile checks, then atomic expected-version save. Returns the allowlisted ListingLaunch DTO.
- `buildContentSnapshot(launch, { productTypeGroup, internalTemplate })` — returns a fixed-order plain object. Catalog data is allowlisted to group `code/name/printMethod` and template `code/name`; mutable/full Catalog documents and confirmer metadata are excluded.
- `hashContentSnapshot(snapshot)` — SHA-256 of the canonical JSON, returned as lowercase 64-character hex.

`services/listingLaunch.service.js` additionally exports:

- `findAccessibleLaunch(id, permission, auth)` — the existing lookup plus exact-shop access path, exported for reuse inside later ListingLaunch services.

`repositories/listingLaunch.repository.js` additionally exports:

- `saveContentInputs(id, expectedInputVersion, contentInputs)` — a single `findOneAndUpdate` CAS. Version zero matches either missing or numeric zero for P1 compatibility.

`validators/listingLaunch.validator.js` additionally exports `contentInputsSchema`; the controller exports `saveContentInputs`.

## Persistence and contract notes

- `contentInputs` uses strict `_id:false` sub-schemas for the profile, keyword, language, complete product facts, 1–30 normalized unique colors, and server-derived confirmation actor/time.
- `contentInputVersion` and `contentVersionCounter` default to zero. DTO reads missing P1 values as zero.
- `approvedContent` is a strict nullable pointer/evidence sub-schema.
- Successful input saves increment `contentInputVersion` and clear approval in the same update.
- Brief patches increment/clear; working-title and reference-only patches do not. Product selection also increments/clears, as required by the design.
- No transaction is needed for Task 1's single-document mutation. A real one-member `MongoMemoryReplSet` test proves two saves with the same expected version yield exactly one success and one 409.

## Self-review

- Architecture: all database access remains in the ListingLaunch repository; service/controller contain no Mongoose queries. No cross-module internal import was added.
- Authorization: endpoint middleware requires `CATALOG:WRITE`, and service rechecks exact-shop scoped access (including active scope-date behavior through the existing Auth helper). Read-only and wrong-shop users are rejected.
- Input safety: Joi rejects missing bodies, unknown fields, empty material/features, invalid profile/language, malformed or duplicate normalized color codes, and all documented bounds. Server derives actor/time and never accepts shop/state/approval overrides.
- Compatibility: P1 documents with missing counters read as zero and can perform the first expected-version-zero write without migration. Existing P1 states and editable request fields remain unchanged.
- Concurrency: stale/parallel writes cannot both advance the same version; brief invalidation and content saves contend on the same monotonic counter.
- Scope: no later-task collections, workers, provider configuration, or external calls were introduced.

## Concerns

No Task 1 blocker. The only observed warning is the inherited P1 `validateSync()` deprecation noted above; changing those unrelated tests was intentionally skipped.
