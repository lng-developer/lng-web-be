# Wasabi Large File Storage BE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add private Wasabi multipart upload and signed download support for 100 MB to 2 GB PSD/ZIP assets without sending file bytes through the web server.

**Architecture:** The Media module owns the S3-compatible Wasabi client and stores upload lifecycle state in the existing `MediaAsset` document. Catalog and Design consume Media public ports; no business module imports the Wasabi client. Preview images continue through the existing Cloudinary upload path.

**Tech Stack:** Node.js 24, Express 5, MongoDB/Mongoose, Joi, Jest, `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`.

## Global Constraints

- Accept direct `.psd` and `.zip` files only; maximum declared size is 2 GB.
- Store source packages in a private Wasabi bucket and previews in Cloudinary.
- Never proxy large upload or download bytes through Render.
- Select storage by `assetPurpose`, not MIME type alone.
- Do not extract ZIP packages in this phase.
- Only `READY` assets may be attached to ListingVariant or approved by Design.
- Keep cross-module calls behind each module's `public.js`.
- Run narrow Jest files after each task; run the full suite only at the final integration gate.

---

## File Map

- `src/modules/media/services/wasabiStorage.service.js`: isolated Wasabi commands, presigning, range reads, and signed downloads.
- `src/modules/media/services/multipartUpload.service.js`: upload lifecycle, authorization, validation, and idempotency.
- Existing Media model/repository/controller/validator/routes/DTO: persistence and HTTP surface.
- `src/modules/catalog/services/listingVariant.service.js`: reject non-ready template assets.
- `src/modules/design/services/designTask.service.js`: reject non-ready submitted and approved assets.
- `src/modules/media/scripts/cleanupMultipartUploads.js`: bounded idempotent stale-upload cleanup.

### Task 1: Wasabi configuration and storage adapter

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `.env.example`
- Modify: `src/config/index.js`
- Create: `src/modules/media/services/wasabiStorage.service.js`
- Test: `src/test/media/services/wasabiStorage.service.test.js`

**Interfaces:**
- Produces: `createMultipartUpload({ key, contentType })`, `presignUploadPart({ key, uploadId, partNumber, expiresIn })`, `completeMultipartUpload({ key, uploadId, parts })`, `abortMultipartUpload({ key, uploadId })`, `headObject({ key })`, `readObjectRange({ key, start, end })`, `presignDownload({ key, filename, expiresIn })`.

- [ ] **Step 1: Install the existing ecosystem's standard S3 client**

Run:

```powershell
npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
```

- [ ] **Step 2: Write failing adapter tests with a mocked `S3Client.send` and presigner**

Cover command input for create, upload-part signing, sorted completion parts, abort, range `bytes=0-7`, and attachment filename on download. Assert that no function accepts a stream or Buffer containing the full asset.

- [ ] **Step 3: Run the focused test and confirm failure**

Run: `npx jest src/test/media/services/wasabiStorage.service.test.js --runInBand`

Expected: FAIL because `wasabiStorage.service.js` does not exist.

- [ ] **Step 4: Add validated environment configuration**

Add these required-when-enabled variables to `.env.example` and `src/config/index.js`:

```text
WASABI_ENDPOINT=https://s3.<region>.wasabisys.com
WASABI_REGION=<region>
WASABI_BUCKET=<private-bucket>
WASABI_ACCESS_KEY_ID=
WASABI_SECRET_ACCESS_KEY=
WASABI_UPLOAD_URL_TTL_SECONDS=900
WASABI_DOWNLOAD_URL_TTL_SECONDS=600
WASABI_MULTIPART_PART_BYTES=67108864
WASABI_MAX_ASSET_BYTES=2147483648
```

Expose values under `config.media.wasabi`; never log access keys.

- [ ] **Step 5: Implement the thin adapter**

Instantiate one `S3Client` with `endpoint`, `region`, credentials, and `forcePathStyle: true`. Each exported function constructs exactly one AWS command. Normalize completion input with:

```js
const completedParts = parts
  .map(({ partNumber, etag }) => ({ PartNumber: partNumber, ETag: etag }))
  .sort((a, b) => a.PartNumber - b.PartNumber);
```

- [ ] **Step 6: Run focused tests and commit**

Run: `npx jest src/test/media/services/wasabiStorage.service.test.js --runInBand`

Expected: PASS.

Commit:

```powershell
git add package.json package-lock.json .env.example src/config/index.js src/modules/media/services/wasabiStorage.service.js src/test/media/services/wasabiStorage.service.test.js
git commit -m "feat(media): add Wasabi storage adapter"
```

### Task 2: Persist and initiate multipart uploads

**Files:**
- Modify: `src/modules/media/models/mediaAsset.model.js`
- Modify: `src/modules/media/repositories/mediaAsset.repository.js`
- Create: `src/modules/media/constants/mediaAsset.constants.js`
- Create: `src/modules/media/services/multipartUpload.service.js`
- Modify: `src/modules/media/validators/mediaAsset.validator.js`
- Modify: `src/modules/media/controllers/mediaAsset.controller.js`
- Modify: `src/modules/media/routes/index.js`
- Modify: `src/modules/media/dtos/mediaAsset.dto.js`
- Create: `src/modules/media/middlewares/multipartRateLimit.js`
- Test: `src/test/media/services/multipartUpload.service.test.js`
- Test: `src/test/media/routes/index.test.js`

**Interfaces:**
- Consumes: Task 1 Wasabi adapter.
- Produces: `initiateUpload(input, auth)`, `presignParts(assetId, partNumbers, auth)`, and DTO fields `assetPurpose`, `uploadStatus`; internal upload ID and object key remain hidden.

- [ ] **Step 1: Write failing service tests**

Test `.psd` and `.zip` acceptance, extension spoof rejection, zero/over-2-GB size rejection, allowed purposes, generated object key, ownership persistence, total-part calculation, invalid part numbers, expired upload, and another user's access.

Use a 64 MB part size; assert `100 MB` produces two parts and `2 GB` produces 32 parts.

- [ ] **Step 2: Write failing route tests**

Add authenticated contract cases for:

```text
POST /api/media/multipart/initiate
POST /api/media/multipart/:assetId/presign-parts
```

Assert validation errors return 400, unauthorized requests return 401/403, and the response never contains `multipartUploadId`, access keys, or `providerAssetId`.

- [ ] **Step 3: Run the focused tests and confirm failure**

Run: `npx jest src/test/media/services/multipartUpload.service.test.js src/test/media/routes/index.test.js --runInBand`

- [ ] **Step 4: Extend MediaAsset without breaking legacy assets**

Add enums:

```js
assetPurpose: ['PSD_TEMPLATE', 'DESIGN_PACKAGE', 'PRINT_READY', 'PREVIEW', 'OTHER']
uploadStatus: ['UPLOADING', 'VERIFYING', 'READY', 'FAILED', 'ABORTED']
```

Legacy documents default `uploadStatus` to `READY`; the existing DTO `status` remains `ACTIVE`/`DISCARDED`. Make `sha256` optional only at schema level; streamed `storeAsset()` must continue writing it. Store multipart internals in metadata and add an index on `{ provider: 1, uploadStatus: 1, 'metadata.expiresAt': 1 }`.

- [ ] **Step 5: Implement initiate and batched part signing**

Use a random key shaped as `media/<shop-or-global>/<yyyy>/<mm>/<uuid>.<ext>`. Compute:

```js
const totalParts = Math.ceil(size / config.media.wasabi.partBytes);
```

Allow at most 20 requested part numbers per presign call. Derive account/shop ownership from `auth`; do not accept ownership from the request body.

- [ ] **Step 6: Add controller, Joi schemas, routes, and safe DTO fields**

Reuse the Media route's existing authentication and permission middleware. Return `201` for initiate and `200` for presign. Do not expose provider internals.

Add a small per-account in-memory limiter for initiate, presign, and complete. Mark its per-process ceiling with a `ponytail:` comment; replace it with a Redis-backed limiter only when multiple web instances make the limit ineffective.

- [ ] **Step 7: Run focused tests and commit**

Run: `npx jest src/test/media/services/multipartUpload.service.test.js src/test/media/routes/index.test.js --runInBand`

Commit: `feat(media): initiate multipart uploads`

### Task 3: Complete, abort, verify, and download

**Files:**
- Modify: `src/modules/media/services/multipartUpload.service.js`
- Modify: `src/modules/media/repositories/mediaAsset.repository.js`
- Modify: `src/modules/media/validators/mediaAsset.validator.js`
- Modify: `src/modules/media/controllers/mediaAsset.controller.js`
- Modify: `src/modules/media/routes/index.js`
- Modify: `src/modules/media/services/mediaAsset.service.js`
- Modify: `src/shared/constants/errorCodes.js`
- Test: `src/test/media/services/multipartUpload.service.test.js`
- Test: `src/test/media/routes/index.test.js`

**Interfaces:**
- Produces: `completeUpload(assetId, parts, auth)`, `abortUpload(assetId, auth)`, `assertMediaAssetReady(assetId)`, and Wasabi-aware authorized download redirect data.

- [ ] **Step 1: Add failing completion and abort tests**

Cover sorted unique parts, missing part, malformed ETag, `UPLOADING -> VERIFYING -> READY`, Wasabi completion failure to `FAILED`, final size mismatch, PSD signature `38 42 50 53`, ZIP signatures `50 4B 03 04`, `50 4B 05 06`, or `50 4B 07 08`, duplicate complete returning the same READY asset, and repeated abort succeeding.

- [ ] **Step 2: Add failing download tests**

Assert Wasabi `READY` returns a short-lived redirect, non-ready returns `MEDIA_ASSET_NOT_READY`, unauthorized access is rejected, and existing local/Cloudinary behavior remains unchanged.

- [ ] **Step 3: Run focused tests and confirm failure**

Run: `npx jest src/test/media/services/multipartUpload.service.test.js src/test/media/routes/index.test.js src/test/media/services/mediaAsset.service.test.js --runInBand`

- [ ] **Step 4: Implement compare-and-set transitions**

Repository updates must include the expected current `uploadStatus` in the filter so two complete requests cannot race. If `uploadStatus` is already `READY`, return it. If it is `ABORTED` or `FAILED`, reject with a stable operational error.

- [ ] **Step 5: Verify the completed object without downloading it**

Call `headObject()` for content length and `readObjectRange({ start: 0, end: 7 })` for magic bytes. On mismatch, mark `FAILED`; do not attach the asset.

- [ ] **Step 6: Add stable errors and HTTP handlers**

Add `MEDIA_UPLOAD_EXPIRED`, `MEDIA_UPLOAD_INCOMPLETE`, `MEDIA_FILE_TOO_LARGE`, `MEDIA_FILE_TYPE_INVALID`, and `MEDIA_ASSET_NOT_READY`. Route complete and abort through global error middleware.

- [ ] **Step 7: Run focused tests and commit**

Run the command from Step 3; expected PASS.

Commit: `feat(media): complete and secure multipart assets`

### Task 4: Enforce READY assets at Catalog and Design boundaries

**Files:**
- Modify: `src/modules/media/public.js`
- Modify: `src/modules/catalog/services/listingVariant.service.js`
- Modify: `src/modules/design/services/designTask.service.js`
- Test: `src/test/catalog/services/listingVariant.service.test.js`
- Test: `src/test/design/services/designTask.service.test.js`
- Test: `src/test/architecture.contract.test.js`

**Interfaces:**
- Consumes: `media.public.assertMediaAssetReady(assetId)` from Task 3.
- Produces: Catalog and Design never attach an upload that is incomplete or failed.

- [ ] **Step 1: Add failing boundary tests**

Assert `setListingVariantPsdTemplateAsset`, Design submission, and Design approval reject an `UPLOADING` asset and accept a `READY` asset. Preserve the current task lifecycle and approval behavior.

- [ ] **Step 2: Run targeted tests and confirm failure**

Run: `npx jest src/test/catalog/services/listingVariant.service.test.js src/test/design/services/designTask.service.test.js --runInBand`

- [ ] **Step 3: Export and use the readiness guard**

Replace attachment-time calls to `assertMediaAssetExists()` with `assertMediaAssetReady()` only where the asset becomes a PSD/design output. Leave ordinary reference-image behavior unchanged.

- [ ] **Step 4: Run targeted and architecture tests**

Run:

```powershell
npx jest src/test/catalog/services/listingVariant.service.test.js src/test/design/services/designTask.service.test.js --runInBand
npm run test:architecture -- --runInBand
```

- [ ] **Step 5: Commit**

Commit: `fix(catalog): require ready design assets`

### Task 5: Stale-upload cleanup and final BE verification

**Files:**
- Create: `src/modules/media/scripts/cleanupMultipartUploads.js`
- Modify: `src/modules/media/repositories/mediaAsset.repository.js`
- Modify: `package.json`
- Test: `src/test/media/scripts/cleanupMultipartUploads.test.js`
- Modify: `docs/media/MEDIA_API.md`
- Modify: `docs/api/postman/media.postman_collection.json`
- Modify: `docs/api/LNG_Web_BE_All.postman_collection.json`

**Interfaces:**
- Consumes: Wasabi abort adapter and expired `UPLOADING` MediaAssets.
- Produces: `npm run cleanup:media:multipart -- --limit=100` as an idempotent scheduled command.

- [ ] **Step 1: Add failing cleanup tests**

Test a bounded batch, expired-only selection, successful abort to `ABORTED`, transient failure remaining retryable, and no mutation of `READY` or active uploads.

- [ ] **Step 2: Implement the cleanup command**

Default to `--limit=100`, reject values outside `1..500`, and print only counts (`selected`, `aborted`, `failed`) without object keys or credentials. Do not add a permanent BullMQ worker in this phase; schedule the command externally once per day.

- [ ] **Step 3: Update API documentation**

Document all four multipart endpoints, request/response bodies, errors, 2-GB limit, and the requirement that Wasabi CORS allow the production FE origin, `PUT`, and ETag response exposure.

- [ ] **Step 4: Run narrow verification**

```powershell
npx jest src/test/media src/test/catalog/services/listingVariant.service.test.js src/test/design/services/designTask.service.test.js --runInBand
npm run test:architecture -- --runInBand
node -c src/modules/media/services/wasabiStorage.service.js
node -c src/modules/media/services/multipartUpload.service.js
node -c src/modules/media/scripts/cleanupMultipartUploads.js
```

- [ ] **Step 5: Run the final integration gate once**

Run: `npm test -- --runInBand`

Expected: all suites pass. Record duration; do not rerun solely because it is slow when no code changed.

- [ ] **Step 6: Commit**

Commit: `chore(media): clean stale multipart uploads`
