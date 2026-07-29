# Media API

Base path: `/api/media`

Media is the shared binary upload module. Feature modules should store only `mediaAssetId` and use `/api/media/assets/:assetId/download` for downloads.

Storage is selected with `MEDIA_STORAGE_PROVIDER` (`local` or `cloudinary`).
Local storage uses `MEDIA_STORAGE_ROOT`; Cloudinary requires
`CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, and `CLOUDINARY_API_SECRET`.

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

## GET `/api/media/assets/:assetId/download`

Downloads the binary asset. FE can use this URL directly for download buttons:

```text
/api/media/assets/660000000000000000000901/download
```

The response is streamed with attachment disposition. A missing database record
or missing physical object returns `404` without exposing its storage path.

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
