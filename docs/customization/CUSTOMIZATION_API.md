# Customization API Guide

The `customization` module owns raw customization payloads, parsed customization data, asset references, retry state, and manual review status. It is the handoff boundary between import and downstream mapping/production work.

## Boundary Rules

Customization owns:

- raw customization payload persistence
- raw customization hash/idempotency
- customization asset references
- parsed customization data
- parse/retry/manual-review status

Customization must not own:

- order or order item persistence
- source file parsing
- vendor selection
- production task creation
- shipment state

Import pipelines call `customization.public.createPendingPayload()` when source data contains customization. Amazon manual imports also run the V1 intake automation through customization public ports: parse raw customization, download ZIP, inspect ZIP, extract JPG/PNG images, and parse ZIP JSON customer inputs.

## Auth And RBAC

All non-health endpoints require:

```text
Authorization: Bearer <accessToken>
```

Rules:

- Read endpoints require `ORDERS:READ`.
- Write/state-transition endpoints require `ORDERS:WRITE`.
- Detail and mutation services enforce the loaded payload's exact shop scope.
- Lists are filtered to shops carrying scoped `ORDERS:READ`; an unauthorized shop filter returns an empty page.

## Statuses

- `PENDING`
- `DOWNLOADING`
- `DOWNLOADED`
- `EXTRACTING`
- `PARSED`
- `NEEDS_REVIEW`
- `FAILED`

## Endpoints

### GET `/api/customizations/health`

No auth required.

Response:

```json
{
  "module": "customization",
  "status": "ok"
}
```

### GET `/api/customizations`

Query:

- `shopId`: Mongo ObjectId
- `orderItemId`: Mongo ObjectId
- `status`: one customization status
- `page`: default `1`
- `limit`: max `100`

Response:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "660000000000000000000601",
        "orderItemId": "660000000000000000000401",
        "orderId": "660000000000000000000301",
        "shopId": "660000000000000000000201",
        "source": "AMAZON_EXTENSION_REPORT",
        "rawRecordId": "660000000000000000000701",
        "status": "PENDING",
        "assets": [],
        "parsedData": {},
        "errorCode": null,
        "errorMessage": null,
        "retryCount": 0,
        "lastTriedAt": null,
        "reviewedBy": null,
        "reviewedAt": null,
        "createdAt": "2026-06-01T00:00:00.000Z",
        "updatedAt": "2026-06-01T00:00:00.000Z"
      }
    ],
    "pagination": {
      "total": 1,
      "page": 1,
      "limit": 20
    }
  }
}
```

The API does not return `rawCustomization` or `rawCustomizationHash`.

Response DTO also includes frontend-friendly derived fields when available:

- `downloadedZip`: source ZIP asset summary.
- `zipInspection`: ZIP manifest summary.
- `extractedImages`: Cloudinary image assets extracted from ZIP entries.
- `failedImages`: image extraction failures.
- `customerInputs`: parsed customer text/options/image references from ZIP JSON.
- `review`: compact review object for FE screens.

### GET `/api/customizations/:payloadId`

Returns one customization payload.

### GET `/api/customizations/order-items/:orderItemId`

Returns the customization payload for one order item.

Example review fields:

```json
{
  "success": true,
  "data": {
    "id": "660000000000000000000601",
    "orderItemId": "660000000000000000000401",
    "status": "NEEDS_REVIEW",
    "downloadedZip": {
      "assetId": "660000000000000000000901",
      "status": "DOWNLOADED",
      "mimeType": "application/zip",
      "size": 2586485,
      "classification": "zip"
    },
    "zipInspection": {
      "status": "INSPECTED",
      "fileCount": 5,
      "warnings": ["ZIP_ENTRY_UNKNOWN_EXTENSION"],
      "errors": []
    },
    "extractedImages": [
      {
        "assetId": "660000000000000000000902",
        "filename": "customer-photo.png",
        "secureUrl": "https://res.cloudinary.com/example/image/upload/customer-photo.png",
        "mimeType": "image/png",
        "size": 2683714
      }
    ],
    "customerInputs": {
      "sourceJsonPath": "163042336165721.json",
      "orderId": "113-0534904-9313817",
      "orderItemId": "163042336165721",
      "texts": [
        { "label": "Custom Text", "value": "Dr. Kauri Porter" }
      ],
      "options": [
        { "label": "Choose Size", "value": "9.8 x 11.8 Inches (Very Small)" }
      ],
      "images": [
        {
          "label": "Upload Your Photo",
          "imageName": "customer-photo.png",
          "secureUrl": "https://res.cloudinary.com/example/image/upload/customer-photo.png"
        }
      ]
    },
    "review": {
      "status": "NEEDS_REVIEW",
      "needsReview": true,
      "errorCode": "MANUAL_REVIEW_REQUIRED",
      "errorMessage": "Customization JSON mismatch: orderId expected ...",
      "customerInputs": {
        "texts": [
          { "label": "Custom Text", "value": "Dr. Kauri Porter" }
        ]
      },
      "extractedImages": [
        {
          "assetId": "660000000000000000000902",
          "secureUrl": "https://res.cloudinary.com/example/image/upload/customer-photo.png"
        }
      ],
      "failedImages": []
    }
  }
}
```

### POST `/api/customizations/order-items/:orderItemId/download-assets`

Downloads pending `CUSTOMIZED_URL` assets through the safe remote-fetch boundary and stores them through the Media public port. Already downloaded assets are skipped. Failed assets are retried only when requested.

Body:

```json
{
  "retryFailed": true
}
```

The response includes `downloadedCount`, `failedCount`, `skippedCount`, updated `assets`, and the updated payload DTO.

### POST `/api/customizations/order-items/:orderItemId/inspect-zip`

Inspects a downloaded ZIP Media asset without extracting it.

Optional body:

```json
{
  "maxEntries": 50,
  "maxTotalUncompressedBytes": 52428800,
  "maxSingleEntryUncompressedBytes": 20971520
}
```

The response includes the inspection status, entry counts, total uncompressed bytes, manifest entries, warnings, errors, and updated payload DTO. Inspection status is `INSPECTED`, `NEEDS_REVIEW`, or `FAILED` and is stored in asset metadata.

### POST `/api/customizations/order-items/:orderItemId/extract-zip-images`

Safely extracts `.jpg`, `.jpeg`, and `.png` entries to Media and parses customization `.json` entries. It links image references into `parsedData.amazonCustomization.customerInputs` and records successful and failed images in asset metadata.

The optional body uses the same ZIP limits as `inspect-zip`. The response includes `extractedCount`, `skippedCount`, `failedCount`, extracted image summaries, and the updated payload DTO.

### POST `/api/customizations/pending`

Creates a pending payload. If another payload already exists for the same `orderItemId` and computed raw customization hash, the endpoint returns the existing payload with `created: false`.

Body:

```json
{
  "orderItemId": "660000000000000000000401",
  "orderId": "660000000000000000000301",
  "shopId": "660000000000000000000201",
  "source": "AMAZON_EXTENSION_REPORT",
  "rawRecordId": "660000000000000000000701",
  "rawCustomization": {
    "name": "Jane",
    "imageUrl": "https://example.test/design.png"
  },
  "assets": [
    {
      "sourceUrl": "https://example.test/design.png",
      "type": "IMAGE",
      "status": "PENDING",
      "metadata": {}
    }
  ]
}
```

Response:

```json
{
  "success": true,
  "data": {
    "payload": {
      "id": "660000000000000000000601",
      "orderItemId": "660000000000000000000401",
      "orderId": "660000000000000000000301",
      "shopId": "660000000000000000000201",
      "source": "AMAZON_EXTENSION_REPORT",
      "rawRecordId": "660000000000000000000701",
      "status": "PENDING",
      "assets": [],
      "parsedData": {}
    },
    "created": true
  }
}
```

### PATCH `/api/customizations/:payloadId/needs-review`

Body:

```json
{
  "reason": "Missing personalization image"
}
```

Sets:

- `status = NEEDS_REVIEW`
- `errorCode = MANUAL_REVIEW_REQUIRED`
- `errorMessage = reason`

### PATCH `/api/customizations/:payloadId/failed`

Body:

```json
{
  "errorCode": "INVALID_RAW_CUSTOMIZATION",
  "errorMessage": "Image URL is missing"
}
```

Sets:

- `status = FAILED`
- `lastTriedAt = now`

### PATCH `/api/customizations/:payloadId/parsed`

Body:

```json
{
  "parsedData": {
    "text": "Jane",
    "imageCount": 1
  }
}
```

Sets:

- `status = PARSED`
- `parsedData = body.parsedData`
- clears `errorCode` and `errorMessage`
- `lastTriedAt = now`

## Public Port

Other modules must import only:

```js
const customizationPublic = require('../customization/public');
```

Available functions:

- `createPendingPayload(payload)`
- `cloneLatestPayloadForReplacement(payload)`
- `getByOrderItem(orderItemId)`
- `getByOrderItemDto(orderItemId, authContext)`
- `getOrderItemCustomizationView(orderItemId, authContext)`
- `listOrderItemCustomizationViews(orderItemIds, authContext)`
- `markNeedsReview(payloadId, reason)`
- `parseForOrderItem(orderItemId)`
- `downloadAssetsForOrderItem(orderItemId, options)`
- `inspectDownloadedZipForOrderItem(orderItemId, options)`
- `inspectDownloadedZipForPayload(payloadId, options)`
- `extractZipImagesForOrderItem(orderItemId, options)`
- `extractZipImagesForPayload(payloadId, options)`
- `assertCustomizationReady(orderItemId)`

`assertCustomizationReady()` returns the payload only when status is `PARSED`; otherwise it throws conflict.

## Postman

Use:

```text
docs/order/postman/LNG_Web_BE_Order_Customization.postman_collection.json
```

Run `Auth - Login` first, then run customization requests.
