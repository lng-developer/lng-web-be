# External Order Import API Guide

The `integration/externalOrderImport` module owns uploaded marketplace report parsing, source file metadata, raw row persistence, import job state, and import issues.

Phase 1 supports manual marketplace report upload:

- source: `MANUAL_EXCEL`
- source type: `FILE`
- accepted files: `.txt`, `.tsv`, `.csv`
- parser keeps source values as strings, including `order-item-id`

## Boundary Rules

External order import owns:

- import jobs
- uploaded source file metadata
- raw source rows
- row hashes
- import issues
- source-specific report parsing and row grouping

External order import must not own:

- normalized order documents
- customization payload documents
- production task creation
- vendor or template selection
- shipment logic

Normalized orders are created through `order.public.importExternalOrder()`. Customization payloads and customization intake automation run through `customization/public.js`.

## Auth And RBAC

All endpoints require:

```text
Authorization: Bearer <accessToken>
```

Rules:

- `POST /api/integration/external-order-imports/manual-excel` requires `ORDERS:WRITE`.
- `POST /api/integration/external-order-imports/etsy-sold-order-items` requires `ORDERS:WRITE`.
- `GET /api/integration/external-order-imports/:jobId` requires `ORDERS:READ`.
- `GET /api/integration/external-order-imports/issues` requires `ORDERS:READ`.
- `GET /api/integration/external-order-imports/:jobId/issues` requires `ORDERS:READ`.
- `GET /api/integration/external-order-imports/:jobId/raw-records` requires `ORDERS:READ`.

## Endpoints

### POST `/api/integration/external-order-imports/manual-excel`

Imports an uploaded Amazon order report. Multiple rows with the same `order-id` are grouped into one external order DTO before calling the order public port.

Multipart form-data:

- `shopId`: required Mongo ObjectId
- `shopConnectionId`: optional Mongo ObjectId
- `marketplaceCode`: required uppercase string, for example `AMAZON_US`
- `externalAccountId`: optional string
- `file`: required `.txt`, `.tsv`, or `.csv` report file

Example with curl:

```bash
curl --request POST "http://localhost:3000/api/integration/external-order-imports/manual-excel" \
  --header "Authorization: Bearer <accessToken>" \
  --form "shopId=660000000000000000000201" \
  --form "marketplaceCode=AMAZON_US" \
  --form "file=@amazon-orders.tsv;type=text/tab-separated-values"
```

The server reads `originalFilename` and `mimeType` from the uploaded file. JSON `fileContent` / `fileBase64` and raw text uploads are still accepted as a local test fallback, but FE upload should use `multipart/form-data`.

Response:

```json
{
  "success": true,
  "data": {
    "jobId": "660000000000000000000601",
    "status": "COMPLETED",
    "totalRecords": 1,
    "importedCount": 1,
    "skippedCount": 0,
    "failedCount": 0,
    "issuesCount": 0
  }
}
```

Status values:

- `COMPLETED`: all valid rows imported and no issues were created.
- `PARTIAL_FAILED`: some rows failed or non-blocking issues were created.
- `FAILED`: job-level failure.

Customization automation:

- If an item row has `customized-url`, `customized-page`, or `item-extensions-data`, the import calls `customization.public.createPendingPayload()` after order import.
- For Amazon `customized-url`, the import then runs customization intake through public ports: parse raw payload, download ZIP, inspect ZIP, extract JPG/PNG images, upload images through media, and parse ZIP JSON customer inputs.
- If ZIP JSON `orderId` or `orderItemId` does not match the imported order/item, the order import still succeeds, the customization payload is marked `NEEDS_REVIEW`, and an issue `CUSTOMIZATION_MISMATCH` is created.
- The importer does not create media, customization, order, or order item documents directly.

### POST `/api/integration/external-order-imports/etsy-sold-order-items`

Imports Etsy Shop Manager **Sold Order Items** CSV files. Multiple rows with the same `Order ID` are grouped into one normalized Etsy order before calling the order public port.

Multipart form-data:

- `shopId`: required Mongo ObjectId
- `shopConnectionId`: optional Mongo ObjectId
- `marketplaceCode`: required uppercase string, for example `ETSY_US`
- `externalAccountId`: optional string
- `file`: required `.csv` file from Etsy Sold Order Items export

Required Etsy CSV columns:

- `Order ID`
- `Transaction ID`

Useful Etsy CSV columns:

- `Sale Date`
- `Date Paid`
- `Item Name`
- `Quantity`
- `Price`
- `Order Shipping`
- `Order Sales Tax`
- `Item Total`
- `Currency`
- `Listing ID`
- `SKU`
- `Ship Name`
- `Ship Address1`
- `Ship Address2`
- `Ship City`
- `Ship State`
- `Ship Zipcode`
- `Ship Country`
- `Variations`

Example with curl:

```bash
curl --request POST "http://localhost:3000/api/integration/external-order-imports/etsy-sold-order-items" \
  --header "Authorization: Bearer <accessToken>" \
  --form "shopId=660000000000000000000201" \
  --form "marketplaceCode=ETSY_US" \
  --form "file=@EtsySoldOrderItems2026-6.csv;type=text/csv"
```

Customization handoff:

- If `Variations` contains `Custom:` or `Personalization:`, or if `Personalization` / `customization_url` exists, the import calls `customization.public.createPendingPayload()` after order import.
- Size/color-only variations stay on `variantRaw` and do not force customization review.
- Etsy rows do not currently have Amazon ZIP JSON, so these payloads may remain `NEEDS_REVIEW` until an Etsy-specific parser is added.

### GET `/api/integration/external-order-imports/:jobId`

Returns import job status and counters.

Response:

```json
{
  "success": true,
  "data": {
    "id": "660000000000000000000601",
    "source": "MANUAL_EXCEL",
    "sourceType": "FILE",
    "shopId": "660000000000000000000201",
    "shopConnectionId": null,
    "salesChannelCode": "AMAZON",
    "marketplaceCode": "AMAZON_US",
    "externalAccountId": null,
    "sourceFileId": "660000000000000000000701",
    "status": "COMPLETED",
    "totalRecords": 1,
    "parsedCount": 1,
    "importedCount": 1,
    "skippedCount": 0,
    "failedCount": 0,
    "startedAt": "2026-06-26T00:00:00.000Z",
    "finishedAt": "2026-06-26T00:00:01.000Z",
    "triggeredBy": "660000000000000000000801",
    "errorCode": null,
    "errorMessage": null,
    "createdAt": "2026-06-26T00:00:00.000Z",
    "updatedAt": "2026-06-26T00:00:01.000Z"
  }
}
```

### GET `/api/integration/external-order-imports/:jobId/issues`

Query:

- `page`: default repository behavior
- `limit`: max `100`

Response:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "660000000000000000000901",
        "importJobId": "660000000000000000000601",
        "rawRecordId": "660000000000000000000501",
        "source": "MANUAL_EXCEL",
        "externalOrderId": "113-1",
        "externalItemId": "000000000000000001",
        "rowNumber": 1,
        "issueType": "CUSTOMIZATION_CREATE_FAILED",
        "severity": "ERROR",
        "status": "OPEN",
        "errorCode": null,
        "errorMessage": "customization failed",
        "details": {},
        "resolvedBy": null,
        "resolvedAt": null,
        "createdAt": "2026-06-26T00:00:00.000Z",
        "updatedAt": "2026-06-26T00:00:00.000Z"
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

Issue types:

- `NORMALIZE_FAILED`
- `SHOP_RESOLVE_FAILED`
- `ADDRESS_VALIDATION_FAILED`
- `ORDER_IMPORT_FAILED`
- `CUSTOMIZATION_CREATE_FAILED`
- `CUSTOMIZATION_MISMATCH`
- `DUPLICATE_RECORD`
- `MISSING_REQUIRED_FIELD`
- `INVALID_FILE_FORMAT`
- `UNSUPPORTED_FILE_TYPE`

### GET `/api/integration/external-order-imports/issues`

Returns the import issue work queue across import jobs.

Query:

- `page`
- `limit`
- `importJobId`
- `source`
- `status`: `OPEN`, `RESOLVED`, `IGNORED`
- `issueType`
- `severity`
- `externalOrderId`
- `externalItemId`

Use this endpoint for operational queues such as address validation failures, customization mismatches, and import failures.
`OPEN` issues block order item readiness. Customization mismatches must be fixed at import/parser level, not manually ignored.

### GET `/api/integration/external-order-imports/:jobId/raw-records`

Query:

- `page`: default repository behavior
- `limit`: max `100`

Response:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "660000000000000000000501",
        "importJobId": "660000000000000000000601",
        "source": "MANUAL_EXCEL",
        "rowNumber": 1,
        "externalOrderId": "113-1",
        "externalItemId": "000000000000000001",
        "asin": null,
        "sku": "SKU-1",
        "normalizeStatus": "NORMALIZED",
        "importStatus": "IMPORTED",
        "orderId": "660000000000000000000301",
        "orderItemId": "660000000000000000000401",
        "errorCode": null,
        "errorMessage": null,
        "createdAt": "2026-06-26T00:00:00.000Z",
        "updatedAt": "2026-06-26T00:00:00.000Z"
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

## Common Test Flow

1. Login and copy `accessToken`.
2. Create or choose a valid `shopId`.
3. POST a small TSV report to `/api/integration/external-order-imports/manual-excel`.
4. Copy `data.jobId`.
5. GET the job.
6. GET issues.
7. GET raw records.
8. Check `/api/orders?shopId=<shopId>` for normalized order output.
9. For customized items, call `/api/customizations/order-items/:orderItemId` and check `review`, `customerInputs`, and `extractedImages`.

## Deferred

- `.xlsx` parsing.
- Extension agent import flow.
- Etsy-specific structured customization parser.
- Production task creation, mapping, vendor submission, and shipment.
