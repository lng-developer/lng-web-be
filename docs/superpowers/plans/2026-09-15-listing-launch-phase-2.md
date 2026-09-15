# ListingLaunch Phase 2 Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement the tasks in order. The linked design is the contract; resolve implementation details against it and preserve P1 behavior.

**Goal:** Generate and review Amazon title, exactly five bullets, search terms, and allowed-color recommendations from seller-confirmed facts.

**Architecture:** Extend `listingLaunch` with structured inputs, durable generation runs, immutable content versions, and an approval pointer. Reuse existing Auth/Catalog/Shop public ports and BullMQ connection helpers. Worker and HTTP lifecycles are separate.

**Tech Stack:** CommonJS, Express, Joi, Mongoose transactions, BullMQ/Redis, native fetch, Jest/Supertest, MongoMemoryReplSet.

**Spec:** `docs/superpowers/specs/2026-09-15-listing-launch-phase-2-design.md` (read fully before implementation).

**Scope:** Backend Phase 2. Frontend seller workspace is a separate implementation plan after these APIs; mockup/scale/export remain later phases. Status: All six backend tasks implemented and task-reviewed; expanded gate passed (610 tests). Full-repository verification and whole-branch review in progress. No deployment or paid provider calls.

## Constraints and prerequisites

- Start from a branch containing P1 commit `c1c88193`; preserve `.codex/` and unrelated dirty work.
- Create implementation branch `EC/listing-launch-phase-2`; no main/develop commits or production mutations.
- Existing P1 state enum/endpoints/DTO fields remain compatible. Internal Catalog SKUs may duplicate.
- Reuse CATALOG read/write exact-shop permissions, including active/expired/future scope handling.
- No Catalog/Media/Design writes, PNG reads, auto-scale, marketplace API/Extension, or export.
- OpenAI is a provisional single-provider default; model/key are runtime configuration. Unit/CI tests make no paid requests.
- The internal content profile is not an Amazon acceptance certificate. Profile restrictions, worker behavior, concurrency and error handling must match the spec.
- Mongo transactions require a replica set; production deployment and live-model pilot are separate from implementation completion.
- Every transaction test file must set `jest.setTimeout(30000)` before hooks/tests. Reuse the existing DB test setup where possible with a single-member `MongoMemoryReplSet`; give replica-set startup/teardown hooks an explicit 60000 ms timeout for cold CI. Stop connections and the replica set in teardown, run these suites `--runInBand`, and do not use fake timers during database startup. Do not raise unrelated suites' timeout globally.

## Current code touchpoints

`src/modules/listingLaunch/` already has the model, repository, service, access helper, validators, controller, routes, DTO, public port, and module entry. Extend those, preserving the module boundary test in `tests/listingLaunch/architecture/`. `src/config/queue.js` provides createQueue/createWorker/createQueueConnection. `src/config/index.js` owns configuration; `src/modules/integration/externalOrderImport/workers/run.js` is a lifecycle example, not an import target.

## Task 1 — Structured inputs and input versioning

**Modify:** `src/modules/listingLaunch/models/listingLaunch.model.js`, `repositories/listingLaunch.repository.js`, `services/listingLaunch.service.js`, `validators/listingLaunch.validator.js`, `controllers/listingLaunch.controller.js`, `routes/index.js`, `dtos/listingLaunch.dto.js`.

**Create:** `constants/listingContentProfile.js`, `services/listingContentInput.service.js`, `tests/listingLaunch/services/listingContentInput.service.test.js`.

**Contract:** `saveContentInputs(launchId, payload, auth)` returns a DTO containing contentInputVersion and confirmed inputs. Shared `buildContentSnapshot(launch, catalogContext)` returns a canonical plain object; `hashContentSnapshot(snapshot)` returns SHA-256 hex.

- [x] Write failing tests for selected-only input save, full confirmation, bounded/unique colors, wrong marketplace/profile, forbidden shop and read-only users. Require non-empty material/features; no silent invented defaults.
- [x] Add version/counter/approval fields and exact strict sub-schema from the spec. Existing rows read as version 0; use a predicate supporting missing-or-zero for first write.
- [x] Atomically compare expectedInputVersion, save confirmed inputs/actor/time, increment input version, and clear approvedContent. Brief edits also increment/clear; workingTitle/reference edits do not.
- [x] Add PUT content-inputs controller, Joi contract, and route. No cross-module internal helper imports.
- [x] Test stale writes, P1 documents missing new fields, and simultaneous input saves against MongoMemoryReplSet.

```js
const results = await Promise.allSettled([
  saveContentInputs(id, { ...input, expectedInputVersion: 0 }, writer),
  saveContentInputs(id, { ...input, expectedInputVersion: 0 }, writer),
]);
expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
expect(results.find(r => r.status === 'rejected').reason.statusCode).toBe(409);
```

Run `node node_modules/jest/bin/jest.js tests/listingLaunch --runInBand`; commit only after relevant tests pass.

## Task 2 — Run/version persistence and generation acceptance

**Create:** `models/listingContentRun.model.js`, `models/listingContentVersion.model.js`, `repositories/listingContent.repository.js`, `services/listingContent.service.js`, `dtos/listingContent.dto.js`; matching tests under `tests/listingLaunch/models/`, `repositories/`, `services/`.

**Modify:** Launch repository for transaction orchestration/version allocation; content generation controller/routes/validators.

**Contract:** `requestGeneration(launchId, {requestKey, expectedInputVersion}, auth)` returns `{run, replayed}`; repository `reserveGeneration(...)` owns transaction writes and unique-key handling. `getGeneration(launchId,runId,auth)` returns a redacted DTO.

- [x] Test idempotent same-key replay, changed command same key ->409, new-key busy ->409, another launch's run ->404, and inaccessible launch ->403.
- [x] Implement strict models/indexes from spec; use separate collections, no embedded histories.
- [x] Use one run enum throughout: `QUEUED -> RUNNING -> SUCCEEDED | FAILED` (no PENDING/COMPLETED aliases). Task 2 reserves QUEUED; Task 3 only returns data or throws typed errors; Task 4 owns RUNNING and terminal persistence. Run DTO exposes sanitized `errorCode`, `errorMessage`, and `validationErrors` for failed output.
- [x] Capture normalized immutable inputs plus Catalog metadata via public ports. Validate template's populated group ID via `_id || value` and normalize IDs.
- [x] Reserve a run in a Mongo transaction with a Launch input-version predicate; handle unique-key conflicts by reading back the winner. Same-key replay is checked before current input version so a completed request remains replayable.
- [x] Return provider/model/prompt/profile/usage metadata but exclude secrets and raw provider bodies. List DTOs do not expose full input snapshots.

```js
const a = await requestGeneration(id, command, writer);
const b = await requestGeneration(id, command, writer);
expect(b.run.id).toBe(a.run.id);
expect(await Run.countDocuments({ launchId: id })).toBe(1);
```

Run focused model/repository/service tests with replica-set Mongo; verify uniqueness races and legacy launch initialization before commit.

## Task 3 — Single AI adapter and output validation

**Create:** `adapters/openaiContent.adapter.js`, `services/listingContentValidation.js`, `prompts/amazonContent.v1.js`, `tests/listingLaunch/adapters/openaiContent.adapter.test.js`, `tests/listingLaunch/services/listingContentValidation.test.js`.

**Modify:** `src/config/index.js`, `.env.example` only if present (otherwise document env names in API guide).

**Contract:** `generateContent({snapshot,model,signal}) -> {content,usage,providerRequestId}`; `validateContent(content, snapshot, profile)` returns validated plain data or a controlled error. Native fetch is mocked in tests.

- [x] Write tests for refusal, incomplete response, HTTP 401/429/5xx, abort timeout, malformed JSON, extra fields, missing/extra bullets, unsupported color, duplicate terms and UTF-8 overflow.
- [x] Build fixed system prompt and strict JSON schema: title, 5 bullets, searchTerms, recommendedColors only. Delimit untrusted seller text as data. No tools, browsing, image inputs, SDK retry, or fallback calls.
- [x] Call Responses API with configured model, bounded output token setting, 90-second abort, and strict structured output. Parse completed output explicitly; never regex-extract/truncate malformed content into success.
- [x] Apply local validator after AI generation and after seller edits. Count Unicode code points for text and Buffer.byteLength for joined search terms. `recommendedColors` must be 1–3 distinct `{code,reason}` objects, not strings. Derive `allowedColorCodes` from snapshot.availableColors and use that exact enum in the output schema and local validator; reject unknown codes, case drift, or semantic aliases without silently mapping them. Return `CONTENT_VALIDATION_FAILED` with field-level errors.
- [x] Store reported usage as nullable fields and request ID. Do not estimate dollars using invented rates or log keys/provider bodies.

```js
expect(() => validateContent({ ...valid, bullets: valid.bullets.slice(0, 4) }, snapshot, profile)).toThrow();
expect(() => validateContent({ ...valid, recommendedColors: [{code:'UNAVAILABLE',reason:'test'}] }, snapshot, profile)).toThrow();
expect(Buffer.byteLength(valid.searchTerms.join(' '), 'utf8')).toBeLessThanOrEqual(249);
```

Run adapter/validator tests without credentials/network. No live provider call during this task.

## Task 4 — Durable queue and worker recovery

**Create:** `queues/listingContent.queue.js`, `workers/listingContent.worker.js`, `workers/run.js`, `services/listingContentGeneration.service.js`, `tests/listingLaunch/workers/listingContent.worker.test.js`.

**Modify:** content service/repository, `package.json` (worker script only).

**Contract:** `enqueueGeneration(runId)` uses jobId=runId; `processGeneration(runId)` claims/executes/persists; `recoverGenerationRuns()` handles bounded QUEUED dispatch and expired RUNNING failures. No queue connection opens at module import.

- [x] Test duplicate delivery makes one provider call; Mongo accepted/Redis failed remains discoverable; startup recovery dispatches same runId; expired RUNNING becomes FAILED; late response cannot overwrite it.
- [x] Reuse queue factory with Worker options `{ concurrency: 2, lockDuration: 120000, stalledInterval: 60000 }`, retaining automatic lock renewal. Set `attempts: 1` on jobs, not Worker options; job data contains runId only. Resolve snapshot from Mongo. Claim QUEUED and set the independent 120-second Mongo lease atomically before calling AI.
- [x] In one transaction, allocate immutable content version, store usage and SUCCEEDED only if lease/status still owned. Catch adapter/validation errors and conditionally persist FAILED plus finishedAt and sanitized error details before propagating the failure to BullMQ; validation failure inserts no content version. If persistence fails, expired-run recovery remains the fallback, never an automatic paid retry.
- [x] Test unsupported `VINTAGE_BLACK` against allowed `BLACK/NAVY/WHITE`: run becomes FAILED with `CONTENT_VALIDATION_FAILED` and `validationErrors` identifying `recommendedColors[0].code`; polling exposes the safe error, no version is inserted, and a new requestKey can reserve another run. Test Worker option wiring and a simulated 80-second async provider wait without real-time sleeps; Mongo claim must still prevent duplicate calls.
- [x] Poll up to 100 queued runs on startup and each 30 seconds; enqueue missing jobs. Terminal queue jobs for still-QUEUED rows must be removed/re-added only when not active; active/completed Mongo rows must never be re-generated.
- [x] Expired RUNNING ->FAILED; no automatic repeat paid call after uncertain timeout/crash. Explicit new request key is required. Clear timers and close worker/queues/DB on SIGTERM/SIGINT.
- [x] Check disabled provider/missing credentials/model/Redis before accepting a new generation; use 503. Enqueue race after Mongo commit returns durable QUEUED and a dispatch warning rather than claiming success.
- [x] Add opt-in real Redis + MongoMemoryReplSet integration test for delivery/recovery; ordinary CI uses queue mocks and real Mongo CAS tests. Report when real Redis integration is not run.

```js
await Promise.all([processGeneration(run.id), processGeneration(run.id)]);
expect(generateContent).toHaveBeenCalledTimes(1);
expect(await Version.countDocuments({ runId: run.id })).toBe(1);
```

Verify Redis outage, worker restart, and duplicate delivery using controlled test services before enabling a paid pilot.

## Task 5 — Immutable editing, approval and stale detection

**Create:** `services/listingContentReview.service.js`, `tests/listingLaunch/services/listingContentReview.service.test.js`, `tests/listingLaunch/integration/listingContentReview.integration.test.js`.

**Modify:** content repository/DTO, Launch detail service/DTO, routes/controller/validators.

**Contract:** `createContentRevision(launchId,parentVersionId,content,auth)` inserts manual version; `approveContent(launchId,versionId,{expectedInputVersion,selectedColorCodes},auth)` sets one valid approval; `listContentVersions(launchId,query,auth)` paginates. `getContentValidity(launch,version,catalogContext)` returns stale/usability flags.

- [x] Test preserving original output after edits, five-bullet/color/length rules on edits, parent/child launch mismatch, and monotonically unique versions under concurrent inserts.
- [x] Require WRITE and exact shop for revisions/approval; derive actor and inherited snapshot fingerprints on server. Editing a stale version does not make it current.
- [x] Approve only fresh validated content and 1–30 distinct selectedColorCodes from availableColors (the 1–3 cap is for AI recommendations only). Recheck active Shop/Catalog references and compare current snapshot hash.
- [x] Input update clears approval. Approval and input update use a transaction + Launch predicate so an old version cannot remain approved after a successful input edit.
- [x] Detail identifies external Catalog metadata changes as stale. Preserve historic versions and pointer evidence while reporting `approvedContentUsable=false`.
- [x] Generating/editing another version does not silently switch the approved pointer. Approval switches it explicitly; old version content remains immutable.

```js
await approveContent(id, version.id, { expectedInputVersion: 1, selectedColorCodes: ['BLACK'] }, writer);
await saveContentInputs(id, { ...updatedInput, expectedInputVersion: 1 }, writer);
expect((await getListingLaunch(id, writer)).approvedContent).toBeNull();
await expect(approveContent(id, version.id, { expectedInputVersion: 2, selectedColorCodes: ['BLACK'] }, writer))
  .rejects.toMatchObject({ statusCode: 409 });
```

Run real transaction race tests, not only service mocks. Confirm historic output remains readable after failed/stale runs.

## Task 6 — HTTP integration, documentation and pilot handoff

**Modify:** `tests/listingLaunch/routes/index.test.js`, `tests/listingLaunch/architecture/listingLaunch.architecture.test.js` (update five-route assertion to P1+P2 routes), `docs/listingLaunch/PHASE_1_API.md` (link forward only), `docs/architecture/MODULE_BOUNDARIES.md` (P2 responsibilities).

**Create:** `docs/listingLaunch/PHASE_2_API.md`, `tests/listingLaunch/integration/listingContentLifecycle.integration.test.js`.

- [x] Exercise input save ->202 generation ->poll ->version ->manual revision ->approval ->input edit ->stale rejection, with actual service/repository/transaction code and mocked provider transport.
- [x] Verify all routes' mount/auth/permission metadata; check parent binding, missing bodies, lowercase ObjectIds, empty arrays, unknown fields, and 400/401/403/404/409/503 behavior.
- [x] Assert zero Catalog Listing/ListingVariant/Design/Media writes and zero external provider calls when generation is disabled or authorization fails.
- [x] Document six new routes, input/output examples, env names, worker command, Mongo replica prerequisite, explicit retry semantics, null usage/cost, and server-only secrets.
- [x] Document frontend handoff: build a seller workspace consuming P1 APIs, add keyword/facts/colors form, Generate button, poll every 2 seconds while visible with request cancellation on unmount, version selector, text editor, stale notices, color selector and Approve. Do not claim this UI is implemented by the backend plan.
- [x] Run focused checks below; inspect diff and commit backend implementation. No push/deploy or paid smoke run implied by unit-test completion.

```powershell
node node_modules/jest/bin/jest.js tests/listingLaunch tests/catalog tests/auth tests/architecture/architecture.contract.test.js --runInBand --silent
Get-ChildItem src/modules/listingLaunch -Recurse -Filter *.js | ForEach-Object { node -c $_.FullName }
git diff --check
```

## Definition of done

- [x] Seller-confirmed keyword/facts and supported colors produce a schema-valid candidate through the worker.
- [x] Exactly five bullets; recommendations are a subset of availableColors; profile violations fail explicitly.
- [x] Same-key replay/active-run exclusivity and Mongo transaction races are verified.
- [x] Redis interruption and worker death leave recoverable/visible status without silent paid-call retries.
- [x] Seller edits preserve history; approval is scoped and stale inputs cannot be treated as approved output.
- [x] P1 regression and architecture tests pass; real Redis/live-provider checks are reported separately.
- [x] A frontend plan and 20-launch live pilot remain explicit follow-ups, not hidden completion claims.

## Inputs needed for the live pilot (not for mock-backed development)

Provider/model available to the company, server-side API key, provider budget controls, one Amazon US apparel product group/template, verified product facts/color list, 5–10 content examples, and the seller's actual template to confirm the pilot limits. Never paste credentials into task history. No Amazon login or publishing access is needed.
