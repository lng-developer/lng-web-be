# Media API

Base path: `/api/media`

Media is the shared binary upload module. Feature modules should store only `mediaAssetId` and use `/api/media/assets/:assetId/download` for downloads.

Storage is selected with `MEDIA_STORAGE_PROVIDER` (`local` or `cloudinary`).
Local storage uses `MEDIA_STORAGE_ROOT`; Cloudinary requires
`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`.
Large PSD/ZIP packages use private Wasabi storage through the multipart endpoints below.

## Auth

- Upload requires `MEDIA:WRITE`.
- Read/download requires `MEDIA:READ`.

## POST `/api/media/assets`

Uploads one file.

Content type: `multipart/form-data`

Form fields:

| Field | Required | Notes |
| --- | --- | --- |
| `file` | yes | Binary file. |

Limits:

- Max size: `MEDIA_UPLOAD_MAX_BYTES`, default `200MB`.
- Allowed image extensions: `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif` with `image/*` MIME.
- Allowed document extensions: `.psd`, `.pdf`, `.zip`, `.rar` with supported document MIME.

Example:

```bash
curl -X POST "http://localhost:3000/api/media/assets" \
  -H "Authorization: Bearer <accessToken>" \
  -F "file=@design.psd;type=image/vnd.adobe.photoshop"
```

Response:

```json
{
  "success": true,
  "data": {
    "id": "660000000000000000000901",
    "originalFilename": "design.psd",
    "mimeType": "image/vnd.adobe.photoshop",
    "size": 123456,
    "sha256": "...",
    "provider": "cloudinary",
    "resourceType": "raw",
    "secureUrl": "https://res.cloudinary.com/...",
    "createdAt": "2026-07-15T00:00:00.000Z"
  }
}
```

`storageFilename`, `relativeStoragePath`, `providerAssetId`, source URL fields,
arbitrary metadata, and discard fields are never returned by the HTTP DTO.

## GET `/api/media/assets/:assetId`

Returns asset metadata.

## Large PSD/ZIP multipart upload

Large package bytes go directly from the browser to Wasabi. All control endpoints require `MEDIA:WRITE`.

### POST `/api/media/multipart/initiate`

```json
{
  "filename": "variant-package.zip",
  "mimeType": "application/zip",
  "size": 1073741824,
  "assetPurpose": "DESIGN_PACKAGE"
}
```

Allowed extensions are `.psd` and `.zip`; maximum size is `2147483648` bytes. Purposes are `PSD_TEMPLATE`, `DESIGN_PACKAGE`, and `PRINT_READY`.

### POST `/api/media/multipart/:assetId/presign-parts`

```json
{ "partNumbers": [1, 2, 3] }
```

Returns short-lived Wasabi PUT URLs for at most 20 parts per request. The browser must retain each response ETag.

### POST `/api/media/multipart/:assetId/complete`

```json
{
  "parts": [
    { "partNumber": 1, "etag": "etag-1" },
    { "partNumber": 2, "etag": "etag-2" }
  ]
}
```

Completion is idempotent. Media verifies final size and PSD/ZIP signature using a small Wasabi range request. Only an asset with `uploadStatus: READY` may be attached downstream.

### DELETE `/api/media/multipart/:assetId`

Aborts an incomplete upload. Run `npm run cleanup:media:multipart` daily to abort uploads expired for 24 hours.

Stable errors include `MEDIA_UPLOAD_EXPIRED`, `MEDIA_UPLOAD_INCOMPLETE`, `MEDIA_FILE_TOO_LARGE`, `MEDIA_FILE_TYPE_INVALID`, and `MEDIA_ASSET_NOT_READY`.

## GET `/api/media/assets/:assetId/download`

Downloads the binary asset. FE can use this URL directly for download buttons:

```text
/api/media/assets/660000000000000000000901/download
```

Local and Cloudinary files keep the existing response behavior. Ready Wasabi assets redirect to a short-lived signed private URL, so Render never proxies the large object.

Wasabi CORS must allow the production FE origin, `PUT`, and expose the `ETag` response header. The bucket must remain private.

## Current Lifecycle Limits

- There is no list, update, or delete HTTP endpoint.
- Assets are not shop-scoped and have no owner ACL; HTTP access uses global
  `MEDIA:READ` or `MEDIA:WRITE`.
- Internal guarded discard leaves a Mongo tombstone and is only for unattached
  uploads; it is not a general deletion API.
- Internal `storeAsset()` defaults to `10MB` unless the caller supplies
  `maxBytes`; the multipart endpoint uses `MEDIA_UPLOAD_MAX_BYTES`.

## FE Usage Rules

- Design task submission does not upload files directly. Upload to media first, then call design submit with `submittedAssetIds`.
- Production scaled output can use either the one-step production upload endpoint or upload here first and attach by `mediaAssetId`.
- Catalog direct PSD upload is admin/backfill only; normal PSD files should go through design task approval.
