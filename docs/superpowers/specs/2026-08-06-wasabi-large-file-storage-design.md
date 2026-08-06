# Wasabi Large File Storage Design

## Goal

Store large POD source files in private Wasabi object storage while keeping display images in Cloudinary. Designer uploads may be either a direct PSD or a ZIP package containing PSD files, mockups, and supporting assets. Expected package size is 100 MB to 2 GB.

## Scope

The Media module is the only module that integrates with Wasabi. Catalog, Design, Production, and Vendor Submission use Media public ports or HTTP APIs and never import a Wasabi client.

Phase one supports:

- Direct `.psd` and `.zip` uploads up to 2 GB.
- Browser-to-Wasabi presigned multipart upload.
- Separate preview image upload through the existing Cloudinary flow.
- Private, short-lived signed downloads.
- Multipart abort and stale-upload cleanup.

ZIP files remain opaque. The backend does not extract them or select a main PSD. Antivirus scanning, ZIP extraction, and cross-device upload resume are outside this phase.

## Storage Routing

Storage selection is based on asset purpose, not MIME type alone.

| Asset purpose | Provider |
| --- | --- |
| `PSD_TEMPLATE` | Wasabi |
| `DESIGN_PACKAGE` | Wasabi |
| `PRINT_READY` | Wasabi |
| Preview, mockup, thumbnail, avatar | Cloudinary |

A large print-ready PNG belongs in Wasabi even though it is an image. Preview images are uploaded separately and are not extracted from ZIP packages.

## Architecture

```text
Designer selects PSD or ZIP
        |
        v
FE asks Media to initiate multipart upload
        |
        v
Media creates an UPLOADING MediaAsset and Wasabi multipart upload
        |
        v
FE uploads parts directly to Wasabi with short-lived presigned URLs
        |
        v
FE submits part numbers and ETags to Media
        |
        v
Media completes and verifies the object, then marks MediaAsset READY
        |
        v
ListingVariant references the ready template asset
```

The file bytes never pass through the Render web service. MongoDB stores upload state so a Render restart does not lose the session.

## MediaAsset Changes

Reuse `MediaAsset`; do not introduce a separate upload-session collection.

Add:

- `assetPurpose`: semantic routing value such as `PSD_TEMPLATE` or `DESIGN_PACKAGE`.
- `uploadStatus`: `UPLOADING`, `VERIFYING`, `READY`, `FAILED`, or `ABORTED`. The existing DTO `status` remains the separate `ACTIVE`/`DISCARDED` lifecycle.
- `provider: 'wasabi'` for large objects.
- `providerAssetId`: generated Wasabi object key.
- Multipart details under `metadata`: upload ID, expected size, part size, and expiry.

The normal MediaAsset DTO must not expose the Wasabi multipart upload ID or internal object key.

For multipart assets, `sha256` is optional. Integrity is checked using completed part ETags, final object size, and a range-read file signature. Existing streamed uploads may continue storing SHA-256.

Only `READY` assets may be attached to a `ListingVariant` or used by downstream production.

## API Contract

### Initiate

`POST /api/media/multipart/initiate`

```json
{
  "filename": "variant-package.zip",
  "mimeType": "application/zip",
  "size": 1073741824,
  "assetPurpose": "DESIGN_PACKAGE"
}
```

The response contains `assetId`, `partSize`, and `totalParts`. Ownership and shop scope come from authenticated server context rather than trusted client claims.

### Presign parts

`POST /api/media/multipart/:assetId/presign-parts`

```json
{
  "partNumbers": [1, 2, 3, 4]
}
```

The endpoint returns short-lived URLs only for valid parts of the authenticated user's upload.

### Complete

`POST /api/media/multipart/:assetId/complete`

```json
{
  "parts": [
    { "partNumber": 1, "etag": "etag-1" },
    { "partNumber": 2, "etag": "etag-2" }
  ]
}
```

Completion is idempotent. Media completes the Wasabi upload, verifies size and signature, and changes the asset to `READY`.

### Abort

`DELETE /api/media/multipart/:assetId`

Abort is idempotent and changes the asset to `ABORTED` after asking Wasabi to discard the incomplete upload.

### Download

`GET /api/media/assets/:assetId/download`

After authorization, Media redirects to a short-lived signed Wasabi URL. The backend does not proxy large downloads.

## Validation and Security

- Accept only `.psd` and `.zip` for this multipart flow.
- Reject declared sizes above 2 GB or non-positive sizes.
- Generate random object keys; never use the original filename as the storage key.
- Keep the Wasabi bucket private.
- Presigned upload and download URLs expire after 5 to 15 minutes.
- Validate account and shop ownership on initiate, presign, complete, abort, and download.
- Rate-limit initiate, presign, and complete endpoints.
- Verify PSD and ZIP signatures with a small range request; never load the whole object into memory.
- Do not extract ZIP files, eliminating ZIP bomb and path traversal exposure in this phase.
- Restrict Wasabi CORS to approved frontend origins and required methods/headers.

Stable operational error codes:

- `MEDIA_UPLOAD_EXPIRED`
- `MEDIA_UPLOAD_INCOMPLETE`
- `MEDIA_FILE_TOO_LARGE`
- `MEDIA_FILE_TYPE_INVALID`
- `MEDIA_ASSET_NOT_READY`

## Cleanup

- Abort incomplete multipart uploads older than 24 hours in bounded batches.
- Mark completed but unattached assets as orphan candidates after seven days.
- Do not immediately delete a replaced production asset; retain it for a recovery window before normal discard processing.
- Log cleanup outcomes and retry transient Wasabi failures.

## Module Responsibilities

- `media`: Wasabi client, multipart lifecycle, provider routing, validation, signed downloads, and cleanup.
- `catalog`: attach a `READY` template asset to `ListingVariant`.
- `design`: initiate PSD/ZIP upload and upload preview separately through Cloudinary.
- `production`: consume ready asset IDs and request Media download access.
- `vendorSubmission`: request Media download access; it does not know the storage provider.
- `order`, `mapping`, and `workScore`: no direct Wasabi integration.

Preview remains associated through the existing Design Task/media asset flow. This change does not reintroduce `previewAssetId` on `ListingVariant`.

## Verification

Use narrow tests during implementation:

- Initiate validation for extension, purpose, size, ownership, and rate limits.
- Part-number authorization and URL expiry.
- Complete success, missing parts, duplicate completion, size mismatch, and invalid signature.
- Abort success and repeated abort.
- Download authorization and redirect behavior.
- Cleanup of expired uploads without touching active or ready assets.
- Catalog rejection of non-`READY` assets.

Run Media and affected Catalog tests first. Run architecture tests when public ports change, and run the full suite once at the final integration gate rather than after every file.
