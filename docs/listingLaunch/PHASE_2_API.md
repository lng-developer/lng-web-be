# ListingLaunch Phase 2: content generation and seller review

Backend APIs and a separate worker generate a text draft, retain immutable AI/manual versions, and record seller approval. Start with the [Phase 1 create and select APIs](PHASE_1_API.md). The [Phase 2.1 mockup assistant](PHASE_2_1_API.md) adds a seller UI and optional image observations. Launch state remains `BRIEF | PRODUCT_SELECTED`; content runs have their own lifecycle.

The text-only P2 path never creates Catalog Listing/ListingVariant, DesignTask, or Media records. Phase 2.1 adds authenticated Media uploads and image analysis, but neither phase generates artwork, renders mockups, exports files, calls an Extension, or publishes to Amazon. Amazon upload remains manual in a later export phase.

## Access and request contract

Use the application's existing authentication. All reads require `CATALOG:READ` or `CATALOG:WRITE`; writes require `CATALOG:WRITE`, globally or for the exact launch shop. Scope start/end dates apply. A run/version must belong to the launch in the URL, even if both launches belong to an accessible shop.

ObjectIds are 24 hexadecimal characters, normalized to lowercase; responses return scalar string IDs, never populated Mongo objects. UUID request keys normalize to lowercase. Bodies are required for write routes, reject unknown fields, and accept only the fields below. Never send actor IDs, `shopId`, snapshots, state, provider/model overrides, or secrets to P2 routes. GET version pagination accepts only `page` and `limit`.

Base: `/api/listing-launches/:id`.

| Method | Suffix | Body/query | Success |
| --- | --- | --- | --- |
| PUT | `/content-inputs` | Full inputs plus `expectedInputVersion` | 200 launch DTO |
| POST | `/content-generations` | `requestKey`, `expectedInputVersion` | 202 run DTO; 200 terminal replay |
| GET | `/content-generations/:runId` | None | 200 run DTO |
| GET | `/content-versions` | `page`, `limit` (1–100) | 200 paginated versions |
| POST | `/content-versions/:versionId/revisions` | Complete content object | 201 manual version DTO |
| POST | `/content-versions/:versionId/approve` | `expectedInputVersion`, `selectedColorCodes` | 200 launch DTO with approval validity |

Success envelope: `{ "success": true, "data": ... }`. A dispatch warning may additionally appear as top-level `dispatchWarning` on an accepted generation.

## Walkthrough

### 1. Save confirmed inputs

Create a launch and select an active Catalog group/template using P1. Read `contentInputVersion` from the returned launch. A newly created launch starts at 0; selecting its product increments it to 1. Do not hardcode this value in the UI.

`PUT /api/listing-launches/:id/content-inputs`:

```json
{
  "expectedInputVersion": 1,
  "profileCode": "AMAZON_US_APPAREL_CONTENT_V1",
  "keyword": "Cat accountant",
  "language": "en-US",
  "productFacts": {
    "brand": "LNG",
    "productName": "Cat shirt",
    "material": "Cotton",
    "features": ["Crew neck"]
  },
  "availableColors": [
    { "code": "BLACK", "label": "Black" },
    { "code": "WHITE", "label": "White" }
  ],
  "factsConfirmed": true
}
```

The response is a launch DTO containing saved `contentInputs`, `contentInputVersion: 2`, and `approvedContent: null`. `confirmedBy` and `confirmedAt` are assigned by the server. Optional fact fields omitted in the request are returned as null; omit them when resubmitting if absent, because the input validator accepts non-empty strings, not null.

Input limits:

| Field | Accepted input |
| --- | --- |
| keyword | 1–200 trimmed characters |
| language/profileCode | `en-US` / `AMAZON_US_APPAREL_CONTENT_V1` |
| brand/productName/material | 1–120 / 1–200 / 1–500 trimmed characters |
| features | 1–10 non-empty strings, each at most 300 characters |
| personalization/careInstructions | Optional non-empty strings, at most 1000 characters each |
| availableColors | 1–30 `{code,label}` objects; code 1–60 uppercase letters/digits/underscore/hyphen, label 1–100 characters |
| factsConfirmed | Must be true |

Color codes are trimmed and uppercased before duplicate checks. An empty list, null item, duplicate normalized code, or unknown nested field returns 400. Inputs and generation are supported only for `AMAZON_US` after product selection. Seller confirmation is the source of garment facts; Catalog group/template metadata does not establish material or color inventory.

### 2. Request generation and poll

`POST /api/listing-launches/:id/content-generations`:

```json
{
  "requestKey": "11111111-1111-4111-8111-111111111111",
  "expectedInputVersion": 2
}
```

The durable run is saved before enqueue. Example 202 response (IDs/timestamps are illustrative):

```json
{
  "success": true,
  "data": {
    "id": "660000000000000000000801",
    "launchId": "660000000000000000000101",
    "shopId": "660000000000000000000201",
    "requestKey": "11111111-1111-4111-8111-111111111111",
    "inputVersion": 2,
    "inputHash": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "profileVersion": 1,
    "promptVersion": 1,
    "provider": "OPENAI",
    "model": "operator-configured-model",
    "status": "QUEUED",
    "requestedBy": "660000000000000000000901",
    "createdAt": "2026-09-15T00:00:00.000Z",
    "startedAt": null,
    "finishedAt": null,
    "resultVersionId": null,
    "providerRequestId": null,
    "usage": null,
    "errorCode": null,
    "errorMessage": null,
    "validationErrors": []
  }
}
```

`GET /api/listing-launches/:id/content-generations/660000000000000000000801` returns the same shape. Status progresses `QUEUED -> RUNNING -> SUCCEEDED | FAILED`. `resultVersionId` remains null until success. On success, use it to select the matching item from the version list. Provider input snapshots, raw output, prompts, credentials, and lease internals are not returned.

Missing provider usage is `null`, not zero. When reported, usage is `{inputTokens, outputTokens, totalTokens}`, with an unknown individual count also null. There is no currency-cost field or pricing calculation: cost is unknown, not zero. Usage is not an invoice.

Replay/retry rules:

- Same key and same command returns the original run: 202 while queued/running; 200 after success/failure. Authorization is rechecked. Replay still works if inputs later change or generation is disabled.
- Same key with a different `expectedInputVersion` returns 409. An independent new key while a run is active also returns 409.
- After `FAILED`, an explicit regenerate uses a **new UUID** and the current input version. Replaying the failed key never reruns the provider.
- If readiness fails before reservation, return 503 without accepting work. If enqueue fails after reservation, return 202 with `CONTENT_DISPATCH_PENDING` and `dispatchWarning`; polling remains QUEUED. Worker recovery redispatches the existing durable run. A same-key replay reads that run; it does not itself enqueue again.

### 3. Read versions and make a manual revision

`GET /api/listing-launches/:id/content-versions?page=1&limit=20` returns `{success:true,data:{items:[],total,page,limit}}`, newest version first. Each item has scalar `id`, `launchId`, `shopId`, `version`, `source`, nullable `runId`/`parentVersionId`, `inputVersion`, `inputHash`, `profileVersion`, `content`, `createdBy`, timestamps, and `isStale`. AI versions have a run ID; manual versions have a parent version ID.

`POST /api/listing-launches/:id/content-versions/:versionId/revisions` accepts the **complete content object**, without a `content` wrapper:

```json
{
  "title": "Cat accountant cotton shirt",
  "bullets": ["Cotton", "Crew neck", "Cat design", "Accountant theme", "LNG brand"],
  "searchTerms": ["cat accountant"],
  "recommendedColors": [{ "code": "BLACK", "reason": "Neutral base" }]
}
```

The response is a new immutable `source: MANUAL` version with its next monotonically allocated number. Original AI text and earlier edits remain readable. Revisions inherit the parent's input fingerprint and historical color set; editing an old version does not make it fresh.

Both AI and manual content must satisfy the versioned internal profile: title at most 200 Unicode code points; exactly five non-empty bullets, each at most 500 code points; 1–50 distinct non-empty search terms whose single-space join is at most 249 UTF-8 bytes; 1–3 distinct recommended allowed colors, each with a non-empty reason at most 300 code points. Recommended codes must match exactly: `black` or `VINTAGE_BLACK` does not substitute for `BLACK`. No silent truncation or dropped fields repair invalid output.

These are internal pilot limits, not universal Amazon acceptance rules. Verify them against the seller's actual category/marketplace template before the pilot or later export.

### 4. Approve and handle stale content

`POST /api/listing-launches/:id/content-versions/:versionId/approve`:

```json
{
  "expectedInputVersion": 2,
  "selectedColorCodes": ["BLACK", "WHITE"]
}
```

Approval accepts 1–30 distinct exact available codes; the selection is not restricted to the 1–3 AI recommendations. The response includes `approvedContent: {versionId,inputVersion,inputHash,selectedColorCodes,approvedBy,approvedAt}`, `approvedContentUsable: true`, and `isStale: false`.

`GET /api/listing-launches/:id` includes content inputs/counters, the current approval pointer, its computed usability, `isStale`, and `latestRun` (run DTO or null). Input PUT and ordinary P1 mutation responses do not include all these derived fields; refresh detail when the UI needs them. The launch list includes only compact flags/counters (`hasContentInputs`, `hasApprovedContent`, `contentInputVersion`, `contentVersionCounter`), not full input/version arrays. `hasApprovedContent` means pointer presence only; use detail's `approvedContentUsable` before treating output as approved.

Saving inputs or PATCHing the brief increments the input version and atomically clears approval. Product selection also increments it. Working-title/reference-ID changes alone do not invalidate text. A save containing the brief or content inputs invalidates even when the submitted text matches the previous value. Regeneration or a manual revision alone does not replace an existing approval.

Current Catalog metadata is included in the fingerprint. Changed/inactive references can leave a historical approval pointer stored but unusable; do not trust pointer presence. Versions stay readable as stale, and approval returns 409. An input edit racing approval cannot leave the old pointer approved after the input save commits.

## Errors

| HTTP | Typical cause |
| --- | --- |
| 400 | Missing/unknown fields, malformed IDs, invalid content/colors; `VALIDATION_ERROR` or `CONTENT_VALIDATION_FAILED` |
| 401 | Missing/invalid application authentication |
| 403 | Missing permission, wrong shop, expired/future scope |
| 404 | Missing launch/run/version or child belonging to another launch |
| 409 | Stale expected version/content, active generation, key conflict, unsupported marketplace, invalid selection state/reference |
| 503 | Generation disabled, missing model/key, or queue readiness unavailable; `CONTENT_GENERATION_UNAVAILABLE` |

An accepted provider failure is a terminal run, so polling still returns **200**, with `status: FAILED`, null `resultVersionId`, sanitized `errorCode`/`errorMessage`, and at most 20 safe `validationErrors`. Example: `CONTENT_VALIDATION_FAILED` with `{field:"recommendedColors[0].code",code:"COLOR_NOT_ALLOWED",message:"Color code must exactly match an allowed color."}`. Other failures include `CONTENT_PROVIDER_REFUSED`, `CONTENT_PROVIDER_INCOMPLETE`, `CONTENT_PROVIDER_INVALID_RESPONSE`, `CONTENT_PROVIDER_UNAUTHORIZED`, `CONTENT_PROVIDER_RATE_LIMITED`, `CONTENT_PROVIDER_UNAVAILABLE`, `CONTENT_PROVIDER_ERROR`, `CONTENT_PROVIDER_TIMEOUT`, `CONTENT_PROVIDER_ABORTED`, `CONTENT_GENERATION_FAILED`, and lease/interruption failures. Never render returned text as HTML.

## Operator setup and recovery

Runtime configuration for **both API and worker**:

| Setting | Meaning |
| --- | --- |
| `LISTING_CONTENT_ENABLED` | Defaults to `false`; gate new generation/provider calls |
| `LISTING_CONTENT_MODEL` | Operator-selected accessible Responses structured-output model; no bundled model alias |
| `OPENAI_API_KEY` | Server-only key, never in client payloads or committed files |
| `MONGODB_URI` | Mongo replica-set connection for multi-document transactions |
| `REDIS_ENABLED` | Must be true for generation |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_DB` | Existing application Redis settings |

The provider timeout is fixed in code at 90 seconds, output cap at 4096 tokens, and worker concurrency at 2. There is no `LISTING_CONTENT_TIMEOUT_MS` or concurrency environment variable. API route import does not start a worker or open Redis.

### Mongo prerequisite and indexes

A Mongo replica set is required; standalone Mongo is insufficient. Confirm the target database from the configured `MONGODB_URI` without logging the URI or credentials. Production uses `autoIndex: false`, so starting the application or calling model `init()` does not install missing indexes. During deployment, with generation still disabled, explicitly create the declared indexes on `ListingLaunch`, `ListingContentRun`, and `ListingContentVersion` before starting/enabling the worker.

From the backend root, an operator can run this in Node with the deployment's server environment loaded, replacing the expected name after verifying the intended target. This **creates indexes**; it is deployment work, not a test command:

```js
const { connectDatabase, disconnectDatabase } = require('./src/config/database');
const Launch = require('./src/modules/listingLaunch/models/listingLaunch.model');
const Run = require('./src/modules/listingLaunch/models/listingContentRun.model');
const Version = require('./src/modules/listingLaunch/models/listingContentVersion.model');
(async () => {
  try {
    const connection = await connectDatabase();
    if (connection.name !== 'REPLACE_WITH_VERIFIED_DATABASE_NAME') throw new Error('Unexpected database');
    for (const model of [Launch, Run, Version]) {
      await model.createIndexes();
      console.log(model.modelName, await model.collection.indexes());
    }
  } finally { await disconnectDatabase(); }
})().catch(() => { console.error('Index setup failed; keep generation disabled and inspect server logs'); process.exitCode = 1; });
```

Verify the unique `(launchId,requestKey)` and partial active-run `(launchId)` indexes on runs; the unique `(launchId,version)` and partial AI `runId` indexes on versions; and the remaining declared listing/recovery indexes. If a build conflicts with existing data/indexes, stop rollout and investigate. Do not delete records or run `syncIndexes()` to force it through. Missing counters on old P1 launches are treated as zero and initialized on write; no bulk data migration is required.

### Worker and shutdown

```powershell
npm run worker:listing-content
```

Queue `listing-launch-content` contains only `{runId}`; job ID is the run ID and `attempts` is 1. Use one worker process for the pilot. BullMQ has a 120-second lock and 60-second stalled interval with normal lock renewal. Mongo independently has a fixed 120-second RUNNING lease. Renewing the Redis lock does not extend that Mongo lease.

Startup and a 30-second recovery tick inspect at most 100 queued runs, redispatch missing/terminal queue jobs under the same ID, and mark expired RUNNING runs `FAILED` with `WORKER_INTERRUPTED`. Expiration is processed in bounded batches too. Recovery does not repeat an uncertain paid call. Late responses cannot publish after losing their lease. A seller can explicitly retry failed work using a new request key.

SIGINT/SIGTERM stops recovery, pauses intake, and grants active processing/recovery up to **120 seconds** to drain before forced BullMQ close/disconnect and queue/Mongo cleanup. Configure the process manager/container termination grace **above 120 seconds**, with additional room for bounded pause/close and connection cleanup; a 120-second hard kill cuts off that cleanup. Forced worker death is handled by lease recovery after restart.

One normal provider attempt per run and Mongo claim protection prevent duplicate processing in the tested paths. They do not guarantee exactly-once external billing after network/process failures. Disabling generation blocks new calls but does not cancel a provider call already in flight. Use a dedicated provider project with operator budget/usage controls; this backend has no application-wide hard spending quota or pricing subsystem.

## Frontend follow-up and live pilot

Build a separate frontend plan consuming **both P1 and P2 APIs**: launch create/select, keyword/confirmed facts/available-colors form, Generate button, run status, version selector, full text editor, stale notices, color selector, and Approve. Neither a P1 form nor the P2 UI is implemented here.

Retain one UUID per generation intent for request replay. Poll every 2 seconds only while the view is visible and status is queued/running; stop on terminal state, cancel requests on unmount, and refresh detail on return. After a 409, reload inputs/detail before retrying. Show dispatch warnings and failed-run field errors; a retry after failure requires an explicit new UUID. Render plain text safely, and use approval usability rather than list pointer presence.

Before enabling paid calls, the operator must choose an accessible model, securely configure its key/budget, and provide one Amazon US apparel group/template, verified garment facts/colors, 5–10 accepted content examples, and the seller's actual import template to confirm limits. Run a 20-launch pilot and record factual errors, edit effort, acceptance rate, latency, usage, and failure reasons. No Amazon credentials or publishing access are needed for P2.

Color recommendations use text only; they do not establish stock, image contrast, print quality, or compatibility with a particular PNG. Schema validation cannot establish factual truth, SEO performance, or Amazon acceptance. Seller review remains required.

## Verification boundary

Automated coverage uses an ephemeral one-member Mongo replica set and real transactions. HTTP lifecycle coverage runs real controllers, services, repositories, Auth shop-scope checks, and the provider adapter, mocking authentication identity, provider fetch, and queue transport. It covers success/revision/approval/staleness, failure polling/new-key retry, access denial, dispatch recovery, and zero Catalog Listing/ListingVariant/DesignTask/MediaAsset writes.

```powershell
node node_modules/jest/bin/jest.js tests/listingLaunch tests/catalog tests/auth tests/architecture/architecture.contract.test.js --runInBand --silent
Get-ChildItem src/modules/listingLaunch -Recurse -Filter *.js | ForEach-Object { node -c $_.FullName }
git diff --check
```

The dedicated Redis integration suite has **two opt-in tests** using `LISTING_CONTENT_TEST_REDIS_URL`. It never falls back to application Redis. Run it only after separately provisioning a dedicated test Redis endpoint; it creates/removes its own jobs under a random prefix and still mocks provider output. These two tests were not run during the mock-backed handoff. Simulated Redis/worker failure tests are not proof of actual Redis outage or process-kill behavior in deployment.

No live provider call, chosen model compatibility check, production DB mutation, paid pilot, frontend delivery, push, or deployment is established by these tests. Keep live readiness distinct from automated contract verification.
