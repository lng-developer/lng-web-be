# Phase 2.1 — authenticated mockup assistant

Seller flow: create draft → select product/template → upload mockup → explicitly analyze → correct observations and confirm product facts → explicitly generate content → edit a new version → approve. UI: `/portal/catalog/listing-launches`, under Sales → Listing → Listing drafts. Exact-shop `CATALOG:READ` or `CATALOG:WRITE` grants reads; writes require `CATALOG:WRITE` and an active shop.

This analyzes an existing image; it does not generate images, recover a print-ready design from a mockup, scale artwork, export CSV, publish, or create canonical Catalog listings. The normalized preview is not the original production file. AI observations are untrusted and are not legal/IP clearance.

## Runtime prerequisites

- MongoDB replica set (transactions); provision model indexes before enabling requests because production disables automatic indexing. Run the deployment's explicit `createIndexes()` step for `ListingMockupAnalysisRun`, not destructive `syncIndexes()`. Verify unique `(launchId, requestKey)`, unique active `launchId` partial filter for `QUEUED/RUNNING`, and recovery/history indexes against `listingMockupAnalysisRun.model.js`. Retain existing P2 indexes.
- API and workers need the same `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`. These remain server-side. No durable local fallback is used by this upload path; legacy Media storage behavior is unchanged.
- Set `LISTING_MOCKUP_ANALYSIS_ENABLED=true`, `LISTING_MOCKUP_ANALYSIS_MODEL` to an account-supported vision model, and `OPENAI_API_KEY`. Configure existing Redis and P2 content flags/model as described in [P2](PHASE_2_API.md).
- Run `npm run worker:listing-mockup` separately from the API and existing content worker. Analysis concurrency is 1, provider timeout 90s, media read timeout 15s, lease/lock 120s, stalled check 60s, recovery sweep 30s. Give process shutdown more than 120s plus operational margin.
- Jobs have one delivery attempt; durable queued runs can be redispatched. Expired RUNNING runs fail instead of automatically repeating a possibly billed request. A seller retry is a new intent/key; an uncertain HTTP response reuses the original key. This reduces duplicate calls but is not a provider-level exactly-once billing guarantee.

## API additions

Base `/api/listing-launches/:id`; authenticated requests use the existing success envelope `{ "success": true, "data": ... }`. IDs below are placeholders for actual ObjectIds.

### Upload: `POST /mockup`

Multipart fields: `file` (one PNG/JPEG/WebP), `expectedMockupRevision=0`, `expectedInputVersion=1`; read both counters from the latest launch instead of hardcoding them. Maximum 10 MiB and 40 megapixels; corrupt, animated and mismatched-type files are rejected. Server normalizes to metadata-free JPEG on white, at most 2048 pixels, quality 90.

Returns 201 with the launch DTO, incremented counters and protected mockup preview metadata. It does not enqueue AI. Replacement clears approval and confirmed image context while preserving history. A conflicting edit returns 409. Cloudinary assets use authenticated delivery; DTOs do not expose signed provider URLs. Preview is served through the permission-checked Media download endpoint with private/no-store caching.

### Analyze: `POST /mockup-analyses`

```json
{ "requestKey": "11111111-1111-4111-8111-111111111111", "expectedMockupRevision": 1 }
```

Returns 202 for a new run or 200 for an idempotent replay, with `data` containing the run DTO and top-level `replayed`. An accepted but temporarily undispatched run can include `dispatchWarning`; do not create another intent merely because dispatch is delayed.

### Poll: `GET /mockup-analyses/:runId`

Returns 200 with a run DTO. Status is `QUEUED → RUNNING → SUCCEEDED | FAILED`. A successful `result` contains `detectedText`, `theme`, `designDescription`, `suggestedKeyword`, and `warnings`. `isStale` identifies a replaced source. Failure exposes safe `errorCode`, `errorMessage` and bounded `validationErrors`, not provider responses or credentials. Run IDs must belong to the launch in the path.

### Confirm: extend `PUT /content-inputs`

Send the complete [P2 input command](PHASE_2_API.md), including the current `expectedInputVersion`, with this extra field:

```json
{
  "mockupReview": {
    "sourceAnalysisRunId": "0123456789abcdef01234567",
    "mockupConfirmed": true,
    "detectedText": "Seller-corrected text",
    "theme": "Cat accounting",
    "designDescription": "Seller-reviewed design description"
  }
}
```

The server derives asset/revision/hash and confirmation actor/time. Clients cannot submit provenance. Product material, features and available colors remain seller-confirmed facts, never inferred from the image. Generation and approval reject missing/stale confirmation when a mockup is attached. Existing text-only drafts remain supported with the legacy snapshot hash unchanged.

## Operational limits

- Upload throttle is per account **per API process**, 10/minute, with bounded in-memory bookkeeping. It is not a distributed quota or AI spending cap; add shared limits before a larger multi-instance rollout.
- Monitor AI tokens/latency/failures and Cloudinary storage/bandwidth. Historical assets are retained; no automatic retention deletion is introduced. Ambiguous DB persistence failures retain the cloud asset and log evidence rather than risking deletion of a committed reference; reconcile identified orphans operationally.
- Upload normalization is in memory. Media download may use temporary scratch files and cleans them on completion; include crashed-process scratch files in existing temp-directory maintenance. Never delete arbitrary seller assets as cleanup.
- The UI preserves dirty edits during refetch and blocks conflicting actions. On a cross-tab 409, review the latest state; reload/discard explicitly before resubmitting. No silent overwrite or automatic AI retry.

## Safe local browser fixture

From BE in one PowerShell terminal:

```powershell
$env:MOCKUP_PREVIEW_ENABLED='true'
node tests/manual/listingMockupPreview.js
```

From FE in another:

```powershell
$env:VITE_API_BASE_URL='http://127.0.0.1:5281'
$env:VITE_UPLOAD_API_BASE_URL='http://127.0.0.1:5281'
node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5280 --strictPort --open false
```

Open `http://127.0.0.1:5280`, sign in as `preview@example.test` with any nonempty fixture password. This helper binds loopback, refuses production mode, uses disposable `MongoMemoryReplSet` database `disposable_mockup_browser_test`, in-memory media and fixed fake AI responses. It is not an authentication or AI accuracy test. Stop both terminals with Ctrl+C; fixture data is disposable. Never deploy this helper.

## Verification record — 2026-09-15

- BE full Jest: 400 suites passed, 4 skipped; 3197 tests passed, 25 skipped. External DB/Redis opt-ins disabled. Includes real HTTP/service/repository lifecycle with mocked cloud/AI and preservation of canonical Catalog boundaries.
- FE full CI: 67 unit files / 221 tests and 114 UI files / 516 tests passed. Added actual LegacySidebar entry afterward; its focused suite passed 18 tests.
- Browser fixture: created/resumed draft, selected product, uploaded preview without an AI call, analyzed explicitly, corrected observations, confirmed facts, generated content, saved manual revision, approved, and reloaded persisted approval. Replacing the image removed approval and disabled generation until a new confirmation. Desktop and 390px layouts inspected; actual sidebar navigation verified. This is mocked-provider browser evidence, not live service proof.
- FE lint (zero errors), typecheck and production build passed after the sidebar fix. A subsequent draft brief/title editor has a focused regression ensuring title-only changes do not resubmit the brief; the feature UI suite now passes 6 tests. The editor preserves input on errors and uses the existing PATCH API.
- Baseline warnings: Mongoose validateSync deprecation, two pre-existing FE Hook dependency warnings, and existing large entry bundle warning. No claim of a clean dependency-security audit.

## Opt-in live pilot (not executed)

Operator must authorize a test Cloudinary account, shop, image and paid model call. Verify unsigned Cloudinary delivery is denied, authorized app preview works, worker reads the same normalized hash, real Redis delivers the job, and the configured model produces schema-valid observations. Measure correction effort, latency and usage. Delete only explicitly approved disposable assets. Amazon acceptance, export and deployment are outside this verification.
