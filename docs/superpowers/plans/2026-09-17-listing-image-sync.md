# Listing image synchronization implementation plan

> Execute with superpowers:subagent-driven-development; each task uses test-first checks and review.

## Approved design and global constraints

Amazon US only in v1, matching the installed extension's marketplace support. Synchronize existing Catalog Listings only. Automatic discovery runs daily per enabled shop/agent; eligibility is createdAt <= now minus 7 days and no successful check in the previous 7 days. Existing imported images can be refreshed; manually edited images must be protected. Request now explicitly bypasses age/cadence but not manual protection. No SP-API, no cookie transmission, no live DB mutation/deployment during implementation. Reuse extension command claim/lease and media Cloudinary storage. No new dependencies.

Persistent parent job and per-listing checkpoints survive EXT reload. One active job per shop; one active import command per agent. Each extension command processes at most 25 pending items sequentially with one owned background Amazon tab. Expired commands allow pending/unacknowledged items to resume. Failure of one listing is recorded; CAPTCHA/auth/rate-limit pauses the parent job instead of hammering Amazon. Retry failed items is explicit. Disabling schedule stops future automatic job creation; pause stops next item/batch, in-flight result may finish safely.

## Task 1: Backend persistence, catalog/media boundary, routes and scheduling

Worktree: C:/lng_system/lng-web/_worktrees/EC-transaction-schedule (branch EC/listing-image-sync).
Create integration/listingImageSync models/repository/service/DTO/validators/controller/routes/public entry; extend extensionCommand type/model/DTO/service for SYNC_LISTING_IMAGES and imageSyncJobId. Catalog owns eligibility query and image update through public ports. Media owns Cloudinary upload. Manual listing productImageUrl changes mark source MANUAL; legacy unknown images are conservatively protected unless recognized imported Amazon CDN URLs. Existing import/enrichment paths mark imported image origin. CAS prevents concurrent manual edits being overwritten.

Canonical API base: /api/integration/listing-image-sync
- GET /schedules => data.items [{id,shopId,agentId,enabled,nextRunAt,lastError}]
- PUT /schedules/:agentId body {enabled} => data schedule (daily interval fixed)
- GET /jobs?shopId=&page=&limit= => data {items,total,page,limit}; jobs {id,shopId,agentId,status,total,processed,updated,unchanged,skipped,failed,createdAt,updatedAt,errorMessage}; statuses QUEUED/RUNNING/PAUSED/COMPLETED/COMPLETED_WITH_ERRORS.
- POST /jobs body {shopId,agentId} => data job, manual Request now (all valid ASIN listings in scope, bypass time gates, protects manual images).
- POST /jobs/:jobId/pause, /resume, /retry => data job. Retry resets failed items only and resumes same job; never rescan succeeded items.
- POST /agent/commands/:commandId/items/query JSON {clientId,leaseToken} => data {jobId,status,items:[{id,listingId,asin,marketplaceCode}]}, at most 25 immutable command-owned items, omit acknowledged ones. This is read-only; batch assignment happens at command dispatch. Use request body to keep lease tokens out of URL/access logs.
- POST /agent/commands/:commandId/items/:itemId/result multipart fields clientId,leaseToken,asin,sourceUrl; file image <=10 MiB. For failure use JSON {clientId,leaseToken,asin,errorCode,errorMessage}. Return data {status}. Item statuses SUCCEEDED/UNCHANGED/SKIPPED/FAILED. Require valid RUNNING unexpired lease + exact agent/token/shop/item/ASIN binding. Duplicate acknowledgment idempotent. Do not fetch arbitrary sourceUrl on BE.
- POST /agent/commands/:commandId/pause JSON {clientId,leaseToken,errorMessage} => data job; validates same ownership/lease.

Management CATALOG:READ/WRITE scoped permissions; extension route authentication through scoped extension token and claimed command authority. Extend command management visibility/action permission safely without broadening unrelated order/finance writes. Include extension permission allowlist only if needed, no legacy token breakage.

Binary validate JPEG/PNG/WebP signatures (no SVG/HTML), bounded size, trusted Amazon image source URL and matching ASIN. Hash bytes server-side. Unchanged hash avoids upload. Media cloud upload uses stable content-derived identity and existing metadata/owner scope for retry recovery without duplicate upload after DB failure; fail explicitly if Cloudinary unavailable, do not silently store local. Store mediaAssetId/hash/sourceUrl/lastCheckedAt on listing sync metadata, keep productImageUrl as delivery URL. No deleting old media.

Reuse existing scheduler tick to dispatch enabled due schedules and drain active jobs after each batch; no command creation for a listing arrival. Queue oldest eligible first, deterministic IDs/order, concurrency-safe dispatch. No empty recurring jobs. Unsupported agents must not be dispatched this command; introduce heartbeat capability listingImageSync (optional boolean default false) and gate on it rather than guessing manifest version.

- [ ] Write failing tests: 7-day exact boundary, successful check cadence, manual protection/CAS, unchanged hashing, upload validation, scoped ownership/expired lease, idempotent ack, resume after lease loss, pause/retry, concurrent dispatch, empty eligibility, capability gating.
- [ ] Run focused Jest with direct node jest --runInBand (avoid script maxWorkers conflict), implement and rerun.
- [ ] Run architecture and extension/catalog/media related suites. Document full exact API as implemented in docs/integration/LISTING_IMAGE_SYNC_API.md. Report any contract changes immediately to controller.

## Task 2: Extension sequential worker

Worktree C:/lng_system/lng-web/Amazon-Extension branch EC/listing-image-sync. Add amazonListingImage.js and tests/listing-image.test.mjs. Extend host permissions for www.amazon.com and m.media-amazon.com; heartbeat capability and dispatcher new command.
- [ ] Test extraction using real-like DOM fixture: main landing image hi-res preference, fallback largest dynamic image, missing/incorrect ASIN and challenge detection, trusted URL, file caps.
- [ ] Implement one owned inactive tab navigating https://www.amazon.com/dp/{asin}, wait for loaded MAIN image and exact ASIN; do not interact with gallery, purchase, login or CAPTCHA. Read data-old-hires first then max dynamic then src. Download via EXT with 60s timeout, 10 MiB streaming cap and trusted no-redirect source URL, upload multipart through existing backend auth. Never transmit Amazon cookies.
- [ ] Test command runner checkpoints, per-item errors, fatal pause, heartbeat renewal during slow navigation/upload, tab cleanup, expired lease abort. Query items before each next item so pause takes effect. Existing dispatcher completes only a batch; BE persists true parent progress.
- [ ] Run node --test tests/*.test.mjs and syntax checks; no actual 3000-listing run.

## Task 3: Frontend Automation controls

Worktree C:/lng_system/lng-web/_worktrees/EC-transaction-schedule-fe branch EC/listing-image-sync. Reuse Integration Automation tab and shared API/TanStack/i18n/feedback components, add focused ListingImageSyncPanel and tests. Read AGENTS.md/CONVENTIONS.md. No dependencies.
- [ ] Test schedule enable, Request now, pause/resume/retry and real backend job progress mapping; scoped CATALOG permission, unsupported/offline agent restrictions.
- [ ] Implement typed API and hooks for Task 1 contract, daily schedule toggle with 7-day explanation, explicit manual bypass confirmation, list recent parent jobs with counts; no false success from batch command status. Controls do not change finance/order schedules.
- [ ] Run focused UI/unit tests, lint/build and browser check actual page using local fixtures if live auth unavailable.

## Review and release

Review each repository diff for spec and quality; verify all runnable tests, permissions and cross-repo field names. No commit/merge/deploy unless user requests. Report local proof separately from live Cloudinary/import proof. Preserve .codegraph and unrelated work.

## Implementation outcome

Implemented across BE/EXT/FE on EC/listing-image-sync. BE related and architecture suites:291 tests passed; EXT full suite:118 passed; FE integration UI:59 passed plus26 navigation unit checks, build/typecheck/scoped lint passed. Local Chrome fixture verified the actual panel and manual-bypass confirmation without API writes. BE and cross-repository review approved after fixes for permanent upload retry loops, closed worker tabs, multipart field naming and empty-string CAS.

Verification limits: Cloudinary transport was mocked; no live bulk3,000-listing run or deployment. Extraction checks use selector stubs informed by observed Amazon DOM, not a saved full DOM fixture. Extension reload may leave its prior worker tab open, though server checkpoints recover work. Future rollout must create the documented indexes, configure Cloudinary and reload EXT; schedules remain opt-in. See docs/integration/LISTING_IMAGE_SYNC_API.md.
