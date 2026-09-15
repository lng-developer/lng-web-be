# ListingLaunch Phase 2 — AI content and seller review

Status: all six backend tasks implemented and task-reviewed on EC/listing-launch-phase-2. Expanded mock-backed verification passed; whole-branch review and full-repository verification in progress. No live provider calls or deployment. See docs/listingLaunch/PHASE_2_API.md for operational prerequisites and verification boundaries.

## Outcome and scope

Extend the existing backend Phase 1 (`c1c88193`) so a seller can submit a keyword and verified product facts, generate one Amazon content version, edit it into a new version, and approve a version with selected shirt colors. Output is a title, exactly five bullets, search terms, and color recommendations drawn only from the supplied available colors.

This plan delivers backend APIs, worker, tests, and an API walkthrough. Seller UI requires a separate frontend implementation plan against these contracts; P1 also has no UI. No description generation, artwork generation, PNG download, auto-scale, mockup rendering, export, Extension, or Amazon publishing is included. Amazon upload remains manual in the later export phase.

## User flow

1. Create a P1 launch and select its Catalog group/template.
2. Save a keyword (e.g. `Funny Cat Accountant`), product facts, available colors, and language.
3. Generate: API returns a run ID immediately; client polls status.
4. Read a proposed title, five bullets, search terms, and recommended colors.
5. Edit text by creating another immutable version; old AI output remains available.
6. Approve a version and a non-empty selection of allowed colors.
7. Changing the generation inputs clears approval and marks older versions stale. Regenerating alone does not discard an existing approval.

## Product facts and scope of claims

Seller confirmation is the source of truth in this phase. P1 ProductTypeGroup and InternalTemplate do not contain a complete sellable garment specification or vendor color inventory. Save explicit facts on Launch; do not invent vendor mappings or treat a product group as an Amazon product type.

Required generation inputs:

- `keyword`: 1–200 trimmed characters.
- `language`: `en-US` for the first content profile.
- `productFacts`: `brand` (1–120), `productName` (1–200), `material` (1–500), `features` (1–10 strings, 1–300 each); optional `personalization` and `careInstructions` (up to 1000 each).
- `availableColors`: 1–30 objects `{ code, label }`, code 1–60 uppercase alphanumeric/underscore/hyphen, label 1–100; codes must be unique after normalization.
- `factsConfirmed: true`: record authenticated confirmer and confirmation timestamp server-side on each successful save.
- `profileCode: AMAZON_US_APPAREL_CONTENT_V1`; only `AMAZON_US` launch generation is supported initially. Other P1 marketplaces remain readable/editable but generate returns a controlled unsupported-profile error.

The profile defines INTERNAL content draft limits: title 200 Unicode code points; five bullets of up to 500 code points each; 1–50 unique search terms, total joined by a single space at most 249 UTF-8 bytes; 1–3 recommended allowed colors, each with a reason of up to 300 code points. These are pilot defaults, not a declaration of universal/current Amazon acceptance rules. Keep them in one versioned constant; verify against the seller's actual template before live pilot/export. No spreadsheet parser is needed in P2.

Generated benefits must derive from the supplied facts. Prompts forbid inferred certifications, materials, dimensions, shipping guarantees, and promises of search ranking. Treat the brief, keyword, facts, and provider output as untrusted text; they cannot instruct the worker to call tools or change configuration. Store plain text and return it as plain text. Unknown claims cannot be reliably screened by a schema: the seller remains responsible for reviewing accuracy.

Color suggestions are merchandising suggestions based on text only. The worker does not inspect the PNG, guarantee print contrast, or confirm inventory; only `availableColors` membership can be guaranteed here. `referenceAssetIds` remain inert P1 references and are not sent to the provider.

Canonical output format is `recommendedColors: [{code: "BLACK", reason: "..."}]`: 1–3 distinct objects, never a mixed/string array. Normalize seller input codes by trimming and uppercasing before saving the snapshot; derive `allowedColorCodes` directly from that snapshot's availableColors. Both the provider JSON schema's code enum and the local validator require exact membership. Do not normalize AI output into an allowed semantic alias: `VINTAGE_BLACK`, `black`, or an unknown label fails when only `BLACK`, `NAVY`, `WHITE` are allowed. Manual content revisions obey the same rule.

## Architecture and persistence

Keep all P2 domain behavior in `listingLaunch`, reusing the current routes, controller validation, Auth access helper, DTO pattern, and `src/config/queue.js`. Cross-module calls go through Catalog/Shop/Auth public ports. Never write Listing, ListingVariant, DesignTask, or Media from this feature.

### ListingLaunch additions

- `contentInputs` (strict structured fields above; nullable for P1 documents).
- `contentInputVersion` (integer default 0).
- `contentVersionCounter` (integer default 0, monotonically allocated).
- `approvedContent`: null or `{ versionId, inputVersion, inputHash, selectedColorCodes, approvedBy, approvedAt }`.
- Keep P1 `state` exactly `BRIEF | PRODUCT_SELECTED`; AI lifecycle is separate.

Changing brief, product selection, or content inputs increments `contentInputVersion` and clears `approvedContent` atomically. P1 workingTitle/referenceAssetIds are not text-model inputs, so edits to those alone do not invalidate content. Existing P1 PATCH payloads remain compatible. New input PUT requires `expectedInputVersion` and returns 409 for stale edits. For old documents, missing counters are interpreted as 0 and initialized on first P2 write; no mass data migration is required.

### ListingContentRun (one durable request/job)

Fields: `launchId`, `shopId`, `requestKey` (UUID from client), `requestHash`, `inputVersion`, `inputHash`, immutable `inputSnapshot`, `profileVersion`, `promptVersion`, `provider`, `model`, `status`, `requestedBy`, `createdAt`, `startedAt`, `finishedAt`, `leaseExpiresAt`, `resultVersionId`, `providerRequestId`, `usage`, sanitized `errorCode`/`errorMessage`, `validationErrors` (at most 20 `{field,code,message}` entries with lengths bounded to 200/80/300 characters; empty for non-validation failures).

Statuses: `QUEUED | RUNNING | SUCCEEDED | FAILED`. The snapshot contains normalized keyword/facts/colors, launch brief, marketplace, selected IDs, and the Catalog product/template metadata actually used by the prompt. `requestHash` hashes the validated generation command; `inputHash` hashes the explicit, fixed-order canonical snapshot with SHA-256. Do not hash BSON serialization or whole mutable Catalog documents.

Transition ownership: Task 2 reserves QUEUED; Task 3's adapter/validator returns validated data or throws a typed error without writing run state; Task 4's generation service atomically claims RUNNING and persists SUCCEEDED or FAILED with finishedAt. SUCCEEDED is the only successful terminal enum, not an additional COMPLETED alias. Validation errors persist `errorCode: CONTENT_VALIDATION_FAILED` and safe field errors (e.g. `{field: "recommendedColors[0].code", code: "COLOR_NOT_ALLOWED", message: "Color code must exactly match an allowed color."}`), with no content version. Run detail DTO exposes these errors for seller correction/new-key retry; never expose raw provider output, prompts, credentials, or stack traces. If failure persistence is interrupted, lease recovery eventually marks the run FAILED.

Indexes: unique `{launchId, requestKey}`; partial unique `{launchId}` where status is QUEUED/RUNNING; `{launchId,createdAt:-1,_id:-1}`; `{status,createdAt:1}` for bounded recovery.

Same requestKey and same command returns the existing run (including its prior result/failure), even if the launch inputs subsequently change. Reusing that key with a different command returns 409. A new generation after failure must use a new key. A different key while another run is active returns 409. One provider call per run is the normal path; do not promise exactly-once external billing after process/network failures.

### ListingContentVersion (immutable AI or seller result)

Fields: `launchId`, `shopId`, `version`, `source: AI | MANUAL`, `runId` (AI only), `parentVersionId` (manual only), `inputVersion`, `inputHash`, `profileVersion`, `content: {title,bullets,searchTerms,recommendedColors}`, `createdBy`, timestamps. Unique `{launchId,version}` and partial unique `{runId}` for AI versions. User edits insert a new document and never change an older version. Manual versions inherit the original input fingerprint/profile and cannot become fresh simply by editing stale text.

Approval is a pointer on Launch, not an additional content lifecycle enum. There is one current approved pointer; historical versions remain readable. Approve accepts 1–30 distinct selected color codes from available colors, not necessarily all AI recommendations; only AI recommendations are capped at three. This supports seller judgment while rejecting unavailable colors.

## Correctness under concurrent operations

Use Mongo transactions for operations spanning Launch, Run, and Version. Replica-set Mongo is an explicit runtime prerequisite; tests use `MongoMemoryReplSet`. Repository code owns sessions/queries, services own decisions. No Mongoose queries in service/controller.

Transaction test files set `jest.setTimeout(30000)` before hooks/tests. Reuse DB setup with one replica-set member and explicit 60000 ms startup/teardown hook timeouts for cold CI, close all resources, and run `--runInBand`. Keep unrelated suites unchanged; fake timers must not interfere with Mongo initialization.

- Generate transaction checks input version/selection, reserves the active run, allocates result version ID, and touches the Launch with a version predicate so concurrent input edits conflict. Revalidate active Shop/Catalog references before snapshot capture.
- Worker claims `QUEUED -> RUNNING` atomically and sets a 120-second lease; call timeout is 90 seconds. Duplicate deliveries seeing RUNNING/terminal state do not call the provider.
- Worker completion conditionally checks its RUNNING lease and inserts the result/version counter update plus SUCCEEDED status in one transaction. A result whose launch inputs changed may still be stored as historical; it must not become approved automatically.
- Approve uses a transaction and an input-version predicate on Launch. Recompute the fingerprint using current relevant Catalog metadata and stored facts; reject stale/mismatched versions with 409. PATCH inputs and approve cannot both leave a stale approved pointer.
- Detail returns `isStale` and `approvedContentUsable` derived from current input version/fingerprint. External Catalog changes may leave a pointer stored but unusable; future consumers must perform the same validity check, never trust pointer presence alone.

## Provider and worker

Planning default: implement ONE OpenAI adapter using Responses API structured output. This is a reversible provider choice, not a quality ranking over Gemini. Model is supplied through `LISTING_CONTENT_MODEL`; do not bake in an unverified model alias. If Gemini is chosen before implementation, substitute the adapter and contract tests, keeping domain/API schemas unchanged. Do not implement fallback/multiple providers in the first increment.

Use built-in `fetch`, an explicit request JSON schema with `additionalProperties:false`, and local post-validation for exactly five bullets, length/UTF-8 constraints, distinct terms, and allowed color membership. Refusal, incomplete response, malformed output, excessive length, unsupported color, or non-success HTTP response produces a controlled run failure; do not truncate text, extract JSON with regex, or silently drop a bullet/color to force success.

Readiness configuration: `LISTING_CONTENT_ENABLED=false` by default, `OPENAI_API_KEY`, `LISTING_CONTENT_MODEL`, timeout 90000 ms, worker concurrency 2. No provider key/model override in HTTP payload. Missing config/Redis yields 503 before accepting new billable jobs. Importing routes must not open Redis connections or start a worker.

Worker options are `{ concurrency: 2, lockDuration: 120000, stalledInterval: 60000 }`; keep BullMQ automatic lock renewal enabled with its default renewal timing. Configure job `attempts: 1` separately. An asynchronous 60–80 second HTTP wait alone does not exhaust BullMQ's lock: the worker renews it periodically. The larger lock gives more tolerance to interruptions, but delays stalled detection; it does not guarantee exactly-once billing. Redis lock renewal is independent of the fixed 120-second Mongo lease, and duplicate-call protection still depends on the Mongo atomic claim. Completion must meet the Mongo lease deadline even if the Redis lock has renewed.

Queue name `listing-launch-content`, jobId is the run ID, payload `{runId}` only. Reuse `createQueue`/`createWorker`; start a separate worker through `npm run worker:listing-content`. Persist run before enqueue; an enqueue failure remains visibly QUEUED with sanitized dispatch error and same requestKey available for retry. API returns the accepted durable run; UI shows it as queued, never as generated.

Worker startup and a 30-second in-process recovery tick inspect at most 100 oldest QUEUED runs and re-enqueue missing jobs with the same jobId. Mark expired RUNNING runs FAILED (`WORKER_INTERRUPTED`); never automatically repeat an uncertain paid call. Use one provider attempt per run, no hidden SDK retry/fallback. Explicit new-key regenerate is the recovery route. Redis/BullMQ delivery retry never bypasses the Mongo claim. Late provider responses cannot publish after a failed/expired lease.

Persist provider-reported token usage and request ID when available. Missing usage is null, not zero. Cost in currency is unknown unless a verified pricing configuration exists; token counts are not an invoice. For pilot, use a dedicated provider project with an operator-set budget/usage controls and one worker process, concurrency 2. This is not a hard application-wide spend cap; measure usage before adding a billing/quota subsystem.

## API additions

Base `/api/listing-launches/:id`; same exact-shop CATALOG:READ/WRITE policy as P1, including active scope dates. Access to a run/version additionally requires that it belongs to the path's launch. Never accept shopId/actor/state/snapshot from the request.

| Method | Suffix | Request | Response |
| --- | --- | --- | --- |
| PUT | `/content-inputs` | expectedInputVersion + input fields | 200 launch/content summary |
| POST | `/content-generations` | requestKey + expectedInputVersion | 202 run DTO (200 existing terminal replay) |
| GET | `/content-generations/:runId` | none | 200 run DTO |
| GET | `/content-versions` | page/limit, maximum 100 | 200 paginated versions |
| POST | `/content-versions/:versionId/revisions` | complete validated content | 201 new immutable manual version |
| POST | `/content-versions/:versionId/approve` | expectedInputVersion + selectedColorCodes | 200 approved content summary |

GET existing launch detail includes input version, current approval usability, and latest run summary; launch list returns only compact status fields, never full snapshots/version arrays. `runId`/`versionId` must be validated 24-hex lowercase IDs. Strict required Joi objects reject missing bodies, unknown fields, malformed IDs, null entries, and unauthorized overrides. No array of versions grows inside a Launch document.

## Pilot inputs and rollout

Coding/testing can proceed with provider mocks. Before enabling real calls: choose accessible model/provider, supply key securely server-side, select one Amazon US apparel group/template, and provide real materials/features/colors plus 5–10 accepted copy samples. Confirm internal profile limits against that seller's current template. No account credentials are required for Amazon.

Pilot: 20 launches. Record content accuracy issues, seller edit effort, percentage accepted, latency, usage, and failure causes. Rollout remains disabled until the end-to-end smoke test passes with seller-owned pilot inputs. Passing schema checks is not proof of SEO performance or Amazon acceptance.

## Sources consulted

- [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs): schema-constrained generation and handling refusal/incomplete output.
- [OpenAI production guidance](https://developers.openai.com/api/docs/guides/production-best-practices): server-side configuration and usage operations.
- [BullMQ stalled jobs](https://docs.bullmq.io/guide/jobs/stalled): automatic lock renewal and stalled-job recovery; installed BullMQ worker options/source also checked for renewal defaults.
- Local P1 implementation and shared queue helpers inspected on 2026-09-15. Catalog group/template are read through public ports; templates return a populated productTypeGroupId.
