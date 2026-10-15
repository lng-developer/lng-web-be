# Etsy Extension Order Import Implementation Plan

> Updated 2026-10-14. Local code implementation and focused automated verification are complete on the existing provider branches; runtime acceptance gates remain open below. No staging/production rollout is claimed.

## Implementation handoff (2026-10-14)

- BE branch: `codex/etsy-extension-provider`; extension: `codex/etsy-lng-web-be`. Existing dirty `data/capture-spool/` preserved. No develop integration or push.
- Implemented: collector CSV repair; real job counts/polling; manual preview/confirm/resume UI; scoped session token; original IPF download after confirmation; sequential bounded retries; Media ownership/hash/type/size validation and dedupe index; manifest transaction matching; Etsy-ID-first Catalog resolution; pending expectations and asset-aware customization/Workbench.
- Readiness fixes from independent review: prefer normalized variation object over raw JSON; do not upload thumbnails as originals; preserve assets while merging changed expectations; verified images resolve Photo upload placeholders; failed mapping enqueue stays retryable.
- Ruling: expectations use two extra CSV columns, reusing existing source/raw-record persistence instead of a second multipart JSON state. Upload route lives under the import job and calls Media through its public port; ordinary Media permissions are unchanged. Files transfer one at a time, within the approved maximum of three.
- Ruling: honor the request to use existing branches, not the older Task 6 develop-integration step. Shared/develop compatibility remains a separate integration gate.
- Local checks include extension tests, real paired CSV parser/mapper round-trip, BE targeted suites and architecture tests. The full BE suite is limited by missing test dependencies; see the test handoff rather than assuming all-suite green.
- Remaining gates: authenticated browser original downloads/CORS; browser worker restart E2E; Mongo index deployment/concurrent retry verification; staging order/customization/Media readback. These are NOT complete.
- Operator instructions: `docs/integration/etsy-extension-manual-test.md` and extension `docs/etsy-manual-import.md`.

The original checklist below remains the acceptance checklist; unchecked runtime items must not be inferred as completed from code/tests alone.

**Goal:** Deliver the approved manual Etsy order import with correct Catalog identity and customer images, reusing existing provider integration.

**Architecture:** Reuse the extension's HTTP client and CSV uploader plus BE token-scoped import and job idempotency. Complete the missing customization readiness, scoped Media upload and asset manifest. Retain the shared Order/Mapping/Customization pipeline.

**Stack:** Chrome MV3 JavaScript, CommonJS Express/Joi/Mongoose/BullMQ, existing Media storage, node:test and Jest.

**Spec:** `docs/superpowers/specs/2026-10-12-etsy-extension-order-import-design.md` on `EC/etsy-extension-order-import` (last recorded spec commit `5b1630cd`). The old implementation-plan file is absent from the inspected checkout and design branch; this document reconstructs and supersedes that plan using the approved conversation and current audit.

## Audited baseline

- Extension: `C:/lng_system/lng-web/extension_esty`, `codex/etsy-lng-web-be`, `0cf0808ad7adcb7155e641c70d453a6e65ae8b4e`; clean working tree.
- Backend: `origin/codex/etsy-extension-provider`, `6d57de5665688788e09a4f0ed04a3eb7c1186dc2`; three provider commits, 63 commits behind current origin/develop at audit time.
- Documentation revision is on `EC/etsy-import-plan-audit`; no implementation or merge is authorized by this audit.
- Keep unrelated `data/capture-spool/` untouched. Recheck branches and dirty files before later implementation; do not replace active checkouts speculatively.

## Audit findings and evidence

1. **P1 — CSV serializer does not consume actual collector shape.** `content-etsy.js:toBackendOrder/toBackendItem` returns `order.shipping`, `item.unitPrice`, object `item.variations`, and `item.customizations.textFields`. `lng-web-be-import-csv.mjs:toEtsySoldOrderItemsCsv` instead reads flattened ship fields, `item.price`, stringifies the object, and reads `item.personalization`. A synthetic collector-shaped probe produced blank address/personalization/Price and `[object Object]` variations. Existing serializer test uses hand-built flattened input and misses this. Quantity >1 also needs unit/line-total semantics verified against the BE mapper's Price fallback.
2. **P1 — Command completion measures upload acceptance, not import completion.** `service-worker.js:runLngWebBeAgentOnce` returns fetched order count with zero failures after `uploadCsv`; `lng-web-be-agent.mjs` immediately calls complete. BE returns 202/PENDING. No job-result polling occurs in that client. Correction to the earlier audit: this injected upload path does NOT write the legacy processed-order cache (`if (!pushOrders)` guards it); the confirmed defect is early command success/counts.
3. **P1 — Files are captured but omitted by the new transport.** `customFiles` never enters the CSV. There is no Media upload, manifest, or durable file-transfer checkpoint in the new agent modules. `etsy-custom-file-mapping.mjs` maps multiple files to items by array position when counts match: equal counts alone do not prove the correct customer/item association.
4. **P2 — Day window is implemented as a count heuristic.** The command maps `numDays * 50`, capped at 200, to maxTotalOrders. This is not a date cutoff and can miss recent orders for busy shops or collect older ones for quiet shops. Make manual v1 explicitly bounded by count unless implementing a real date window with pagination and visible truncation.
5. **P2 — Existing UX differs from approved manual flow.** Token configuration starts one-minute command polling, Orders/Ads legacy popup messages are rejected, token is stored in chrome.storage.local, and Socket tracking remains enabled. Reuse the working components but add an explicit manual order mode with Preview/Import, no background command claim or tracking in that mode. Preserve other modes without silently changing their behavior.
6. **P2 — Capture retains legacy logging destination.** The common capture calls logServiceEvent. `extension-logger.js:getStoredLoggerConfig` derives destination from legacy backendUrl and posts `/api/ext/logs`. New API base selection does not redirect this logger. Ensure new manual mode does not send customer metadata to that legacy destination.
7. **Missing BE pieces:** provider commits add token-shop binding and Idempotency-Key jobs, but do not add exact Etsy-ID Catalog lookup, pending file expectations, owned Media uploads, or asset-ID customization parsing/attachment.

## Reuse instead of duplicate implementation

| Existing component | Decision |
| --- | --- |
| lng-web-be-command-client.mjs | Extend with GET progress and asset/manifest operations; reuse Bearer and multipart handling |
| lng-web-be-import-csv.mjs | Fix serializer in place; do not create a competing exporter |
| lng-web-be-agent.mjs | Correct terminal results; share importer with manual mode |
| Existing Etsy collector/detail scanning | Reuse capture; separate its logging/push effects and verify item/file association |
| BE token shop binding and idempotency | Reuse after integrating on current develop and checking retry recovery |
| Existing command polling/Ads/tracking | Outside manual v1; retain only in existing modes |

## Global constraints and review focus

- Preserve duplicate SKU support; Etsy ID lookup precedes unambiguous legacy SKU fallback and cannot attach a different nonempty Etsy ID.
- Use existing Extension Token (`lng_ext_`) with shop-scoped authorization, rather than inventing a second ordinary-user-token workflow. Manual mode keeps token in trusted session storage. Verify ORDERS/MEDIA permissions for this token before wiring uploads; do not assume generic Media routes accept it.
- No Etsy cookies/CSRF to BE; no base64 in manifest. Blob transport between MV3 contexts requires a browser probe; do not assume runtime messaging transfers Blob objects.
- At most three file transfers concurrently; configured size/type limits are enforced on server as well as client. Preserve originals and separate customer artwork from listing previews and PSD templates.
- Failed transfers leave customization pending/review and never erase imported orders or successful assets. Readiness must be established before mapping can trigger production.
- Test five specific boundaries: actual collector shape, asynchronous job failures, restart/lost responses, cross-shop/job asset access, ambiguous multi-item image mapping.

## Task 1 — Repair collector-to-CSV contract

**Modify:** extension `lng-web-be-import-csv.mjs`, `tests/lng-web-be-import-csv.test.mjs`; BE Etsy mapper tests only if a genuine mapper defect is demonstrated.
**Interface:** preserve `toEtsySoldOrderItemsCsv(orders) -> string`.

- [ ] Add synthetic fixtures shaped exactly like toBackendOrder/toBackendItem: nested shipping, unitPrice, quantity two, zero prices, totals, object variations, multiple text fields, missing identifiers and quoted multiline text.
- [ ] Run `npm test` in the extension and confirm failing assertions for the documented defects.
- [ ] Map shipping fields explicitly; render variation pairs and customization text deterministically. Use nullish semantics for numeric zero. Verify tax/shipping allocation for multi-item orders and avoid duplicating order totals on each item. Reject incomplete identity rather than generating ambiguous rows.
- [ ] Feed exported fixtures into the BE CSV parser/mapper; assert exact address, text, IDs, quantities and minor-unit money. Run focused Jest mapper tests and extension tests. Review diff and commit the focused fix.

## Task 2 — Correct job lifecycle and manual orchestration

**Modify:** extension `lng-web-be-command-client.mjs`, `lng-web-be-agent.mjs`, `service-worker.js`, `popup.js`, `popup.html`, `manifest.json`; add `etsy-import-runner.mjs` and its tests. Reuse existing HTTP client rather than adding lng-import-client.mjs.
**Interfaces:** client `getImportProgress(jobId)`; runner `startImport(captureId)` and `resumeImport(runId)`; terminal result includes actual backend imported/failed counts and job ID.

- [ ] Test 202 followed by partial/failed import, auth expiry, lost upload response, closed popup, worker restart, and zero backend writes before Import.
- [ ] Add explicit manual mode: Pull -> Preview -> Import -> progress. Capture and preview may read Etsy, but file-byte downloads start after confirmation. Manual mode does not claim commands or execute socket tracking. Scope checkpoints by backend origin/shop/run, persist stable idempotency key/job ID, and keep credentials out of checkpoints.
- [ ] Poll actual import results with bounded backoff; distinguish order count from raw-record/item count. Report partial failure truthfully. Resume persisted jobs rather than recollecting a different payload with the same key. Show collection count/truncation; do not label count limits as date windows.
- [ ] Route new-mode logs locally with sanitized identifiers. Maintain base URL/host permission consistency. Disable legacy logger network writes in the new capture path.
- [ ] Test existing command and legacy-mode behavior remains isolated; run `npm test` and syntax checks; commit.

## Task 3 — Etsy Listing identity and early customization expectations

**Modify BE:** `catalog/repositories/listing.repository.js`, `catalog/services/listing.service.js`, `mapping/services/fulfillmentPlan.service.js`; externalOrderImport controller/validator/manualExcel service and Etsy customization parser. Paths are under `src/modules/`.
**Interfaces:** repository `findByEtsyListingId({salesChannelCode,marketplaceCode,etsyListingId,includeInactive})`; optional Etsy-import `customizationExpectations` JSON keyed by externalOrderId/externalItemId with expectedFileCount and needsReview.

- [ ] Tests: exact Etsy ID wins; duplicate SKU/different Etsy ID stays separate; inactive/draft QC respected; Amazon unaffected; image-only items block before manifest; plain CSV remains compatible.
- [ ] Pass externalListingId to Catalog public lookup/create. Align with existing unique-index scope, retain shop access controls, permit SKU fallback only when compatible and unique. Create DRAFT with Etsy ID if absent.
- [ ] Persist expectations in import source/raw records before post-import mapping is enqueued. Preserve them on retry; CSV replay must not supersede a richer completed customization payload.
- [ ] Run catalog/import/customization focused suites and `npm run test:architecture -- --runInBand`; review and commit.

## Task 4 — Owned Media upload and manifest attachment

**Modify BE:** Media controller/validator/service/repository/public; externalOrderImport routes/controller/validator/public/DTO; Customization public/service/parser/DTO. Create `externalOrderImport/services/etsyCustomizationManifest.service.js` and focused service/API tests.
**Interfaces:** extend Media multipart upload with importJobId and sha256 after token-access verification; `POST /api/integration/external-order-imports/:jobId/etsy-customization-manifest`; manifest contains spec entries with Media IDs. Integration public resolves trusted job/shop; Media public validates ownership/readiness; Customization public merges inputs and assets.

- [ ] Test wrong shop/job/asset, spoofed hash, invalid file bytes, repeated/concurrent upload, reordered manifest, partial retry, unmatched transaction, missing expected files, and parser preservation of READY assets.
- [ ] Server computes file hash and stores trusted ownership. Reuse only authorized same-job assets with an atomic retry identity. Existing generic uploads keep their contract. Never trust client-supplied owner/shop/hash alone.
- [ ] Resolve manifest items from this import's successful raw records. Apply bounded entries with per-item accepted/unchanged/needsReview/failed results; reuse existing customization and mapping jobs. No new standalone manifest scheduling system.
- [ ] Canonicalize and merge asset IDs without dropping prior successful uploads. Only Customization decides readiness; recheck mapping after attachment. Order import success stays separate from complete asset transfer.
- [ ] Run focused Media, Integration and Customization tests plus architecture tests; commit.

## Task 5 — Browser files, resume and truthful final status

**Modify extension:** `content-etsy.js`, `etsy-custom-file-mapping.mjs`, `etsy-import-runner.mjs`, existing client and popup; add runner/asset mapping tests.
**Interfaces:** client `uploadImportAsset(jobId,file,sha256)` and `attachManifest(jobId,entries)` reuse Task 4 contracts.

- [ ] Test matching by transaction evidence, multiple files on one item, reordered DOM, equal counts with ambiguous ownership, failed/reused files and restart after upload before manifest.
- [ ] Reuse captured references, but unresolved multi-item associations enter review instead of pairing by array position. During a controlled browser probe validate byte download and messaging in the correct extension/Etsy context; do not pass backend Bearer into page-world code.
- [ ] Download only confirmed selected files; validate file response, calculate hash, upload at concurrency <=3 and retry transient errors at most three times. Persist asset IDs and per-item state; revalidate existing assets on resume. Stop at auth expiry and let the operator refresh credentials.
- [ ] Submit complete/partial manifest truthfully; failed/missing files preserve readiness blockers. UI separates collected orders, imported items, uploaded/reused files and remaining failures. Mark completion only after actual backend import and attachment results.
- [ ] Run all extension tests and syntax checks; commit.

## Task 6 — Combined verification and rollout

- [ ] Integrate selected provider commits on current develop in an isolated checkout, preserving any active work. Resolve import-service overlap without copying the outdated branch wholesale. Run branch's existing BE contract tests again.
- [ ] Check idempotency recovery: crash after job creation but before source storage, same key/different content, concurrent upload, and requeue of an already terminal job. Existing provider test proves repeated lookup only, not these cases.
- [ ] Synthetic end-to-end import with multiple items/files verifies Catalog link, pending readiness, Media ownership, manifest DTO and retries without duplication.
- [ ] Run targeted BE suites, architecture suite, extension suite and diff checks. Real Etsy/staging evidence requires an authorized authenticated session; record that separately and do not trigger vendor submissions/tracking as a test.
- [ ] Update README with manual setup, token scopes, supported origins, limits and recovery. Supply branches, results and remaining runtime limitations before deployment.

## Verification performed during this audit

- Extension `npm test`: 29/29 passed at 0cf0808; synthetic serializer probe reproduces data loss described above. Existing green tests do not cover actual collector-to-BE compatibility.
- Previous turn's BE provider targeted tests: 3 suites, 34/34 passed at 6d57de56. No live Etsy/backend requests performed during this audit.
- No runtime source changed. This plan preserves approved order+image scope and avoids duplicating the existing client/export modules.
