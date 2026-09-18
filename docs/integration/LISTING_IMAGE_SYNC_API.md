# Listing image synchronization

Base: `/api/integration/listing-image-sync`. Success envelope: `{success:true,data:...}`.

New manual and scheduled jobs include only ASINs with all-time `quantitySold > 0` in LNG's existing Order sales summary. Zero or absent sales are excluded before creating job items or extension commands, including explicit manual ASIN selections. Sales lookup failures fail discovery rather than being treated as zero. Existing job snapshots are not rewritten by this filter.

Expired running commands are reclaimed even when their agent is offline; the parent returns to QUEUED until the agent reconnects. Only pending items resume automatically, never already successful or failed items. Explicitly paused jobs remain paused. EXT 0.3.6 reopens a missing worker tab once per batch and retries the unacknowledged item; a second tab loss pauses the job for manual attention.

Amazon US existing Catalog Listings only. Daily schedules select valid 10-character ASINs ordered by oldest `createdAt`, then `_id`. Both age and last successful check use an inclusive seven-day cutoff. Manual Request now bypasses both time gates. Explicit manual images are protected, including a cleared image; unknown historical images are protected unless they use a recognized Amazon image CDN URL. Imported images may refresh. No marketplace credentials or cookies are sent to this API.

Legacy images under `https://m.media-amazon.com/images/S/gestalt-seller-images-prod-us-east-1/` are also recognized as refreshable imported images unless explicitly marked MANUAL. Historical image ownership recognition is separate from upload URL validation; the existing eligibility and manual-image protections are unchanged.

## Management

JWT authentication and scoped `CATALOG:READ` or `CATALOG:WRITE` for reads; scoped `CATALOG:WRITE` for mutations. Extension tokens cannot use these management endpoints.

| Method | Path | Input | `data` |
| --- | --- | --- | --- |
| GET | `/schedules` | none | `{items: Schedule[]}` |
| PUT | `/schedules/:agentId` | JSON `{enabled:boolean}` | `Schedule` |
| GET | `/jobs` | query `shopId?`, `page=1`, `limit=20` (max 100) | `{items: Job[],total,page,limit}` |
| POST | `/jobs` | JSON `{shopId,agentId,asins?}` | `Job` (HTTP 201) |
| POST | `/jobs/:jobId/pause` | none | `Job` |
| POST | `/jobs/:jobId/resume` | none | `Job` |
| POST | `/jobs/:jobId/retry` | none | `Job` |

`Schedule = {id,shopId,agentId,enabled,nextRunAt,lastError}`. Enabling is due on the next existing scheduler tick (up to one minute); later discoveries run every 24 hours. Disabling stops future discoveries and preserves the existing job. No job is created when automatic discovery has no eligible listings. Offline/unsupported/active-job errors appear in `lastError`; the next discovery is the next daily tick.

`Job = {id,shopId,agentId,status,total,processed,updated,unchanged,skipped,failed,createdAt,updatedAt,errorMessage}`. Status is `QUEUED | RUNNING | PAUSED | COMPLETED | COMPLETED_WITH_ERRORS`. Counts derive from persisted item checkpoints, not the extension command summary. `processed = updated + unchanged + skipped + failed`.

Only one active job (including paused) is allowed per shop. Request now requires an online capable agent; empty manual eligibility returns HTTP 409 `NO_ELIGIBLE_LISTINGS`. More than 10,000 eligible listings returns HTTP 409 `JOB_TOO_LARGE`; no rows are silently truncated. Retry is allowed on paused or completed-with-errors jobs and resets failed items only. Succeeded/unchanged/skipped checkpoints remain intact. Resume is for paused jobs. Pause stops the next item/batch; an in-flight result may finish safely.

Optional `asins` limits a manual job to that exact list within the authorized shop. It accepts 1–100 unique uppercase ten-character ASINs. An explicit empty/invalid list is rejected, never expanded to all listings. Omission retains the existing whole-shop behavior. Manual-image protection still applies; schedules do not use this selection.

## Extension protocol

The existing `/api/integration/extension-commands` heartbeat accepts optional top-level `listingImageSync:boolean` (default false). Agent and management-agent DTOs return it. Image commands are gated both on dispatch and claim. Existing scoped extension tokens continue to work without added Catalog permissions. Requesting `SYNC_LISTING_IMAGES` through the generic command-create API is rejected; use the parent jobs API.

Claim/start/renew/complete use the existing command protocol. `SYNC_LISTING_IMAGES` commands expose `imageSyncJobId`. Each command has a fixed internal set of at most 25 item IDs and shares the existing active-import lock with order/finance imports.

| Method | Path | Input | `data` |
| --- | --- | --- | --- |
| POST | `/agent/commands/:commandId/items/query` | JSON `{clientId,leaseToken}` | `{jobId,status,items:[{id,listingId,asin,marketplaceCode}]}` |
| POST | `/agent/commands/:commandId/items/:itemId/result` | multipart `clientId`, `leaseToken`, `asin`, `sourceUrl`, file **`file`** | `{status}` |
| POST | `/agent/commands/:commandId/items/:itemId/result` | JSON `{clientId,leaseToken,asin,errorCode,errorMessage?}` | `{status}` |
| POST | `/agent/commands/:commandId/pause` | JSON `{clientId,leaseToken,errorMessage?}` | `Job` |

The items query is read-only despite using POST: lease secrets must not be put in URLs/access logs. It omits acknowledged items and returns an empty item list while the parent is paused. It never assigns a new batch. Query again before each item so a user pause takes effect. Extension fatal Amazon CAPTCHA/auth/rate-limit responses should pause the parent, then finish the current command. A command completion drains the next batch; lease expiry resumes only pending items on a later scheduler tick.

Result status: `SUCCEEDED | UNCHANGED | SKIPPED | FAILED`. Every query/result/pause requires an authenticated extension token, its exact registered client/agent and shop, a RUNNING command, matching unexpired lease token, matching job, command-owned item and ASIN. A repeated acknowledged item returns its saved status while that lease is valid. Concurrent duplicate processing returns HTTP 409; it cannot upload twice. Lost or foreign leases return 409; invalid token/scope returns 403.

Image uploads accept JPEG, PNG and WebP signatures, at most 10 MiB; HTML/SVG are rejected. Source URLs require HTTPS, no credentials or nondefault port, and exact hostname `m.media-amazon.com`, `images-na.ssl-images-amazon.com`, or `images.amazon.com`. Paths are opaque: both `/images/I/...` and Amazon's `/images/W/.../images/I/...` are accepted without rewriting or hardcoding experiment identifiers. BE never downloads `sourceUrl`. MIME and SHA-256 are determined from the actual bytes. EXT currently downloads from `m.media-amazon.com` only, rejects redirects, omits cookies, and enforces the same size limit.

Bad image bytes/source or a Cloudinary upload rejection/network failure record a durable `FAILED` checkpoint. There is one upload attempt per explicit run; Retry is the recovery action, with no infinite automatic per-item retry. Missing Cloudinary configuration pauses the parent and leaves the item pending. Database persistence failures and lease loss leave pending checkpoints recoverable. Item failure messages are retained up to 300 characters (request messages up to 1,000) to bound embedded document size.

Unchanged hashes refresh the successful-check timestamp without an upload. Changed images use Cloudinary content-derived public IDs `listing-images/{shopId}/{listingId}/{sha256}` with `overwrite:false`; owner/hash-scoped MediaAsset reuse recovers database/checkpoint failures. Image writes compare the listing identity, previous URL, timestamp and manual source before updating. A concurrent user edit wins. Media assets are retained; no old image is deleted. There is no local-storage fallback.

## Persistence and rollout

Jobs store bounded embedded per-listing checkpoints atomically (10,000 maximum), a unique active-shop key, dispatch lease and current batch ID. Commands persist immutable batch item IDs. Catalog stores delivery URL in `productImageUrl`, and source/hash/mediaAssetId/sourceUrl/lastCheckedAt plus recovery marker in `imageSync`. Successful checks alone advance the seven-day cadence.

Production disables automatic indexes. Before enabling this feature in a future authorized rollout, create the job/schedule/command indexes using:

```powershell
node src/modules/integration/listingImageSync/scripts/ensureListingImageSyncIndexes.js
```

The command prints the target database name and only creates declared indexes. It was not run against a live database during implementation. Configure `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`; the image-sync uploader always uses Cloudinary even when generic media storage uses another provider.

Local tests use an isolated MongoMemoryServer and mock only the Cloudinary network transport. Live Amazon extraction, Cloudinary delivery and deployed scheduler behavior require a separate authorized end-to-end smoke check.
