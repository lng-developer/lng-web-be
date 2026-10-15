# Etsy order representative image

Approved scope: capture one larger image matching the order thumbnail's image ID; retain thumbnail fallback. Import orders independently from background image persistence. Reuse Media, keep shop isolation, never change Catalog/customer artwork/readiness.

## Tasks
1. Extension: select observed URLs only, one listing-detail lookup per unique listing per capture, failure leaves thumbnail. Test ID matching, dedupe, failure and CSV handoff.
2. Backend: bounded Etsy CDN fetch into Media with source dedupe; queue after successful import with retries; guarded item attachment and Workbench update through public ports. Test invalid URLs/bytes, retries, stale jobs and scope.
3. Frontend: prefer stored image after Catalog image, fallback source URL, preserve existing layout. Verify tests/build and review.

## Execution ledger
- Existing feature branches retained; unrelated dirty files preserved. No commit/push or database mutations authorized by this implementation.
- Pre-flight: CSV already carries LNG Listing Image into externalData.etsy.listingImageUrl; Workbench currently exposes only the source URL.
- Ruling: use existing listing-detail response shapes defensively; live large-image API field is not yet verified. Unknown/missing fields retain thumbnail, never synthesize URL sizes. Cost: some listings remain small until live response is checked.
- Tasks 1-3 implemented. Final verification: extension 55/55; BE 19 targeted suites / 170 tests including architecture pass; FE targeted UI 3/3, unit 258/258, build passes. Syntax and diff checks pass. No commit/push.
- Fresh review: fixed same-source reimport asset loss by keeping an independent `OrderItem.listingImage` reference (not in the replaceable import snapshot); a changed source hides the old asset until a replacement is attached. RED/GREEN payload-to-DTO regression.
- Fresh review: fixed serial capture delay with a 15-second total enrichment budget; thumbnails retained when exhausted. RED/GREEN extension test.
- Fixed stale projection image attachment with expected-source array filter; RED/GREEN repository test.
- Fixed source-backed Workbench reads dropping saved image/source fields; select only image fields, not full external snapshots. RED/GREEN repository test.
- Ruling: dedicated order image reference instead of merging raw snapshots. Cost: one optional schema field, no backfill needed. This preserves saved images even if Redis is unavailable on reimport.
- Final: minor (deferred): Cloudinary cleanup failure may mask a duplicate-key write error; next retry still finds the winning cached asset. This inherited cleanup behavior is not expanded here.
- Final: Ruling: live Etsy fields, Redis retries, Cloudinary, installed unique index and concurrent Mongo behavior remain runtime checks, not inferred from unit tests. No DB changes/restart/push performed.

## Before VM validation
1. Deploy the specific Media unique index declared for `(shopId, ownerType, sourceUrlHash)` with partial filter `ownerType: ETSY_LISTING_IMAGE, uploadStatus: READY, discardedAt: null`. Do not run broad syncIndexes. This has NOT been installed by this task; without it concurrent downloads may produce duplicate assets.
2. Restart BE/worker only after verifying target database and index. Update extension in VM and reload extension/page. FE uses existing authenticated Media download route.
3. Capture/import one known order. Confirm CSV source and thumbnail, then OrderItem listingImage reference and authorized Media download; refresh Workbench. Retry the same source and verify reference reuse. Do not count listing-image failures as order/customization failures.
4. A failed queue job has three exponential retries; another actual import can retry it. An idempotently reused import job does not replay ingestion. Redis enqueue failure is logged as `etsy_listing_image_enqueue_failed`; source thumbnail remains available.

## Verification limits
Full BE suite was stopped after MongoMemoryServer connection failures (`Missing required sub-document 'driver' in the client metadata document`) and cascading timeouts in: teamMembership.migration, staffProvisioning.persistence, orderProductionAudit.persistence, leave.lifecycle, payroll.lifecycle, payrollEmail.worker, authScopeSource.audit.persistence. No claim of full-suite success.
Full FE UI suite stalled without results and its owned workers were stopped; targeted OrderItemPanel UI test passes. Lint: zero errors, six existing hook warnings.

## Local VM test preparation (2026-10-14, user approved)
- Installed and read back only `mediaassets.shopId_1_ownerType_1_sourceUrlHash_1` on verified `lng_web_be`. No broad index synchronization or order-data writes.
- Extension commit `bffb878bc939d1264c33ec8e46b024ed831f558b` pushed and remote SHA verified on `codex/etsy-lng-web-be`; extension checkout clean, 55 tests pass.
- Restarted port 3000 with a session-scoped manual bootstrap: autoIndex/autoCreate false; API + four external-order workers, mapping side-effect worker and internal finance snapshot worker. No background schedulers or finance-import worker. Existing relevant queues had no active/waiting/delayed jobs before start.
- This session-scoped bootstrap is NOT the normal `npm start` behavior. Normal server startup enables its configured schedulers; do not treat it as equivalent safe-test mode.
- Verified LAN auth endpoint returns 401 without token, frontend localhost:5173 returns 200, image queue has one worker and zero pending/failed jobs. Cloudinary is the configured image store. No test order submitted by the agent.
- VM operator: check clean checkout, fetch/switch/pull --ff-only `codex/etsy-lng-web-be`, reload extension AND Etsy tab, capture one known order then confirm import once. Reimport updates the actual `lng_web_be` order, so use a designated test order. Backend/FE remain local dirty feature work; neither pushed by this preparation.
