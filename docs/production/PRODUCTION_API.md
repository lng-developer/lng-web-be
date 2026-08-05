# Production API

Base path: `/api/production`

Production owns the scale/QC workbench. FE should treat `ProductionTask` as the source of truth for scale output, QC, CS handling, vendor readiness, and vendor submission visibility.

## Auth

- Read routes require `PRODUCTION:READ`, `PRODUCTION:WRITE`, `DESIGN:WORK`, or `DESIGN:REVIEW`.
- Scale work routes require `PRODUCTION:WRITE` or `DESIGN:WORK`.
- QC routes require `PRODUCTION:WRITE` or `DESIGN:REVIEW`.
- CS assignment routes require `PRODUCTION:WRITE`.

## List Tasks

```http
GET /api/production/tasks
```

Query:

| Query | Notes |
| --- | --- |
| `status` | Production status. |
| `scaleStatus` | Scale status. |
| `qcStatus` | QC status. |
| `csStatus` | `UNASSIGNED`, `ASSIGNED`, `IN_PROGRESS`, `DONE`. |
| `salesChannelCode` | `AMAZON` or `ETSY`. |
| `blocker` | Filter by blocker code, for example `PSD_MISSING`. |
| `designAssignmentStatus` | `UNASSIGNED`, `ASSIGNED`, `OUTPUT_UPLOADED`. |
| `sellerCode` | Seller code parsed from SKU prefix. |
| `tab` | `ADDRESS_INVALID` or `FAILED`. |
| `view` | Optional `QC`. Returns the QC projection without scale/template or vendor-submission payloads. |
| `search` | Search task/order/listing fields. |
| `assignedDesignUserId` | Scale designer account id. |
| `scaleBy` | Alias-style scale designer filter. |
| `qcBy` | QC reviewer account id. |
| `csAssigneeId` | CS account id. |
| `unassigned` | Boolean design unassigned filter. |
| `csUnassigned` | Boolean CS unassigned filter. |
| `shopId` | Shop id. |
| `dateFrom`, `dateTo` | Created date range. |
| `assignedAtFrom`, `assignedAtTo` | Assignment date range. |
| `readyAtFrom`, `readyAtTo` | Ready date range. |
| `sort` | Comma sort, allowed fields: `createdAt`, `updatedAt`, `assignedAt`, `readyAt`, `sentToVendorAt`, `status`, `scaleStatus`, `qcStatus`. Prefix `-` for desc. |
| `page`, `limit` | Pagination, max `100`. |

Response item fields FE should use:

```json
{
  "id": "productionTaskId",
  "orderItemId": "orderItemId",
  "orderItem": {
    "externalOrderId": "114-...",
    "externalItemId": "163...",
    "asin": "B0...",
    "sku": "J2520-NK-...",
    "title": "Personalized Napkins",
    "status": "NEED_PRODUCTION"
  },
  "customization": {
    "customerInputs": {
      "texts": [{ "label": "Custom Name", "value": "Christie" }],
      "options": [{ "label": "Select Size", "value": "Beverage" }],
      "images": []
    },
    "imageAssets": []
  },
  "vendorProduct": { "id": "...", "code": "...", "name": "Napkins" },
  "vendorCostCenter": { "id": "...", "code": "...", "baseCostAmount": 1328, "currency": "USD" },
  "productionStatus": "BLOCKED",
  "scaleStatus": "NEED_SCALE",
  "qcStatus": "NOT_READY",
  "blockers": ["PSD_MISSING"],
  "scaleContext": {
    "status": "BLOCKED",
    "canScale": false,
    "missingRequirements": [{ "code": "PSD_TEMPLATE", "message": "PSD template asset is missing." }],
    "use": {
      "listing": { "id": "...", "sku": "...", "asin": null, "title": "...", "psdStatus": "MISSING" },
      "template": { "id": "...", "code": "...", "artworkSlots": [] },
      "psdTemplate": { "assetId": null, "assetDownloadUrl": null, "fileCheckId": "...", "status": "MISSING" },
      "scaleSlots": [
        {
          "fileCheckId": "...",
          "slotKey": "FRONT",
          "slotLabel": "Front",
          "inputAssetId": "...",
          "inputAssetDownloadUrl": "/api/media/assets/.../download",
          "inputSourceLabel": "Upload your photo",
          "inputSlotKey": "FRONT",
          "inputImageName": "photo.png",
          "outputAssetId": null,
          "outputStatus": "MISSING"
        }
      ]
    }
  },
  "qcPreviewFileChecks": [
    {
      "id": "fileCheckId",
      "slotKey": "FRONT",
      "slotLabel": "Front",
      "required": true,
      "inputAssetDownloadUrl": "/api/media/assets/input/download",
      "inputSourceLabel": "Customer upload",
      "inputImageName": "photo.png",
      "outputAssetDownloadUrl": "/api/media/assets/output/download",
      "outputStatus": "UPLOADED"
    }
  ],
  "assignedDesigner": { "id": "...", "fullName": "Nguyen Thu Trang", "employeeCode": "J11032026" },
  "qcUser": { "id": "...", "fullName": "Nguyen Manh Hung", "employeeCode": "J2444" },
  "csAssignee": { "id": "...", "fullName": "CS User", "employeeCode": "CS001" },
  "csStatus": "ASSIGNED",
  "vendorSubmission": { "id": "...", "status": "FAILED", "failureReason": "..." }
}
```

`qcPreviewFileChecks` is the compact QC Preview payload and contains every
persisted file check, including non-customer-image checks. Its stable `id`
identifies each input/output pair. `inputAssetDownloadUrl` and
`outputAssetDownloadUrl` are the only supported browser preview/download URLs.

`scaleContext.use.scaleSlots` is scale context only: it represents
customer-image scale slots and does not include every persisted file check.

### QC list projection

Use `GET /api/production/tasks?view=QC` for the QC queue. It retains the queue
columns, customer customization and image URLs, vendor/notes, and
`qcPreviewFileChecks`; it omits `scaleContext`, template/listing snapshots,
vendor submissions, and unrelated assignment metadata. In this projection,
`qcPreviewFileChecks[].outputRequired` determines whether an output must exist
for QC pass. A template check can be input-required while its output is not
required.

Do not render duplicate legacy aliases as separate people. Prefer:

- `assignedDesigner` for scale designer.
- `qcUser` for QC reviewer.
- `csAssignee` for CS handler.

## Summary

```http
GET /api/production/tasks/summary
```

Accepts the same filters as list except pagination. Response includes operational counts, including CS counts:

```json
{
  "success": true,
  "data": {
    "total": 10,
    "blocked": 3,
    "needScale": 4,
    "qcPending": 2,
    "readyToSendVendor": 1,
    "sentToVendor": 0,
    "addressInvalid": 1,
    "failed": 1,
    "csUnassigned": 6,
    "csAssigned": 4,
    "byCsStatus": { "UNASSIGNED": 6, "ASSIGNED": 3, "IN_PROGRESS": 1, "DONE": 0 }
  }
}
```

## Assignees

Production has two separate assignment lanes on the same task:

| Endpoint | Purpose | Eligibility | Used by |
| --- | --- | --- | --- |
| `GET /api/production/tasks/scale-assignees` | Pick the designer/scale user who will create or upload scale output files. | Account must be assignable with `DESIGN:WORK`. | `PATCH /api/production/tasks/:taskId/assign` |
| `GET /api/production/tasks/cs-assignees` | Pick the CS/operator who follows up production issues for the task. | Account must be assignable with `PRODUCTION:WRITE`. | `PATCH /api/production/tasks/:taskId/assign-cs` |

One production task can have both a scale assignee and a CS assignee. They are
not duplicates:

- `assignedDesigner` / `assignedDesignUserId`: owns scale/design output work.
- `csAssignee` / `csAssigneeId`: owns CS follow-up, notes, and CS status.

### GET `/api/production/tasks/scale-assignees`

Query:

- `search`
- `limit`

Returns accounts eligible for scale design assignment:

```json
{
  "success": true,
  "data": {
    "items": [{ "id": "accountId", "fullName": "Designer", "employeeCode": "J1001" }]
  }
}
```

### GET `/api/production/tasks/cs-assignees`

Query:

- `search`
- `limit`

Returns accounts eligible for CS assignment:

```json
{
  "success": true,
  "data": {
    "items": [{ "id": "accountId", "fullName": "CS User", "employeeCode": "CS001" }]
  }
}
```

## Assignment And CS

### PATCH `/api/production/tasks/:taskId/assign`

Body:

```json
{
  "assignedDesignUserId": "accountId",
  "designNote": "Scale this file"
}
```

The user must be eligible for scale design tasks. If FE gets `Assigned user is not eligible for scale design tasks`, refresh options from `/tasks/scale-assignees`.

### PATCH `/api/production/tasks/bulk-assign`

Body:

```json
{
  "taskIds": ["productionTaskId"],
  "assignedDesignUserId": "accountId",
  "designNote": "Batch assign"
}
```

### PATCH `/api/production/tasks/:taskId/claim`

Current authenticated scale designer claims the task.

### PATCH `/api/production/tasks/:taskId/design-note`

Body:

```json
{
  "designNote": "Customer wants grey text"
}
```

### PATCH `/api/production/tasks/:taskId/assign-cs`

Assign or unassign CS.

```json
{
  "csAssigneeId": "accountId",
  "csNote": "Need address follow-up"
}
```

Use `csAssigneeId: null` to unassign.

### PATCH `/api/production/tasks/:taskId/cs-note`

```json
{
  "csNote": "Customer confirmed address"
}
```

### PATCH `/api/production/tasks/:taskId/cs-status`

```json
{
  "csStatus": "IN_PROGRESS"
}
```

Allowed values: `UNASSIGNED`, `ASSIGNED`, `IN_PROGRESS`, `DONE`.

## Scale Output Upload Flow

Production does not own binary files. All uploaded files are stored by `media`.
Production stores only media asset references:

- `inputAssetId`: source file used by the designer, if any.
- `outputAssetId`: scaled/designed output uploaded by the designer.

Scaled output uploads require the configured media provider to match
`PRODUCTION_SCALED_OUTPUT_STORAGE_PROVIDER`, default `cloudinary`. If the
backend process is running with `MEDIA_STORAGE_PROVIDER=local`, upload returns a
conflict instead of silently creating a local-only `MediaAsset`.

Production API responses expose backend download links such as:

```text
/api/media/assets/:assetId/download
```

Do not expect production task APIs to return Cloudinary URLs, local paths, or
raw provider paths. FE should download/preview files through the backend
download URL with the normal auth token.

### Which Endpoint Should FE Use?

| Use case | Endpoint | Body type | Recommended for |
| --- | --- | --- | --- |
| User chooses a manual position and uploads the output in one action | `POST /api/production/tasks/:taskId/file-checks/manual/scaled-output-file?slotKey=FRONT&slotLabel=Front&sourceType=CUSTOMER_IMAGE&compact=true` | `multipart/form-data` with `file` | Main FE manual scale upload flow |
| Slot already exists and FE has `fileCheckId` | `POST /api/production/tasks/:taskId/file-checks/:fileCheckId/scaled-output-file` | `multipart/form-data` with `file` | Template-driven scale slot flow |
| Create a manual slot only, without uploading output yet | `POST /api/production/tasks/:taskId/file-checks/manual` | JSON | Admin/backfill/manual setup |
| Attach an already uploaded media asset | `PATCH /api/production/tasks/:taskId/file-checks/:fileCheckId/scaled-output` | JSON | Debug/retry/backfill |
| Upload media only, without attaching to production | `POST /api/media/assets` | `multipart/form-data` with `file` | Media primitive/debug only |

### Manual file check

Use this when an order needs a manual scale position that was not generated from
the listing template, for example `FRONT`.

```http
POST /api/production/tasks/:taskId/file-checks/manual
```

Body:

```json
{
  "slotKey": "FRONT",
  "slotLabel": "Front",
  "sourceType": "CUSTOMER_IMAGE",
  "inputAssetId": "660000000000000000000902"
}
```

Allowed `sourceType`: `CUSTOMER_IMAGE`, `PSD_TEMPLATE`.

If `inputAssetId` is present, production validates the media asset and creates a
file check with `scaleStatus=NEED_SCALE`, `qcStatus=NOT_READY`, and blocker
`SCALED_OUTPUT_MISSING`. After that, upload the scaled output through either
one-step or two-step upload below.

If the same `slotKey` already exists on the task, this endpoint returns
`409 CONFLICT_ERROR`. Use the manual one-step upload endpoint below when FE wants
to reuse an existing slot or create it if missing.

### Manual one-step upload

This is the preferred FE path when the user chooses a position and uploads the
scaled output in the same action.

```http
POST /api/production/tasks/:taskId/file-checks/manual/scaled-output-file?slotKey=FRONT&slotLabel=Front&sourceType=CUSTOMER_IMAGE&compact=true
```

Multipart file field:

```text
file=@/path/to/front.png
```

If `slotKey` already exists on the task, production reuses that file check.
Otherwise it creates the manual file check first, streams the file through
`media.public.storeAsset()`, and stores only the returned `outputAssetId`.

Use `compact=true` for the FE upload action to return only task/file-check
summary fields instead of the full production task DTO.

Compact response shape:

```json
{
  "taskId": "660000000000000000000001",
  "taskStatus": "QC_PENDING",
  "scaleStatus": "SCALED",
  "qcStatus": "PENDING",
  "fileCheckId": "660000000000000000000002",
  "slotKey": "FRONT",
  "slotLabel": "Front",
  "outputAssetId": "660000000000000000000003",
  "outputAssetDownloadUrl": "/api/media/assets/660000000000000000000003/download",
  "outputStatus": "UPLOADED",
  "fileCheckScaleStatus": "SCALED",
  "fileCheckQcStatus": "PENDING"
}
```

Bruno/Postman note: for this endpoint, prefer `slotKey`, `slotLabel`, and
`sourceType` in the query string and send only `file` in `multipart/form-data`.
Do not set `Content-Type: application/json` for multipart uploads.

### One-step upload

Use this when the file check already exists and FE already knows the
`fileCheckId` from `GET /api/production/tasks` or task detail.

```http
POST /api/production/tasks/:taskId/file-checks/:fileCheckId/scaled-output-file
```

Multipart field:

```text
file=@/path/to/scaled-output.png
```

The wrapper streams the file into `media.public.storeAsset()`, stores the
returned media asset as `outputAssetId` on the file check, and returns the
updated production task.

### Two-step upload

Use this only when debugging media separately, retrying attachment, or doing an
admin/backfill script.

1. Upload the scaled file:

```http
POST /api/media/assets
```

Multipart field:

```text
file=@/path/to/scaled-output.png
```

2. Attach the uploaded media asset to a production file check:

```http
PATCH /api/production/tasks/:taskId/file-checks/:fileCheckId/scaled-output
```

Body:

```json
{
  "mediaAssetId": "660000000000000000000902"
}
```

Response includes the updated production task. The file check receives
`outputAssetId`; production then derives the next task status for QC.

### Download / Preview Contract

Production task DTOs return metadata and safe backend links only:

```json
{
  "outputAssetId": "660000000000000000000003",
  "outputAssetDownloadUrl": "/api/media/assets/660000000000000000000003/download"
}
```

FE should use `outputAssetDownloadUrl` for preview/download. This works whether
the asset is stored locally or in a cloud provider, because the media module owns
the storage provider details. Production APIs must not expose `localPath`,
provider secrets, or raw storage paths.

## QC And Vendor

### PATCH `/api/production/tasks/:taskId/qc`

The request may use the legacy whole-task `{ "decision", "note" }` payload or
`{ "fileDecisions": [{ "fileCheckId", "decision", "note" }] }`. Per-file mode
requires a decision for every scaled output, and every rejected file requires a
reason. Any rejection returns the task to Scale; all required files must pass
before the existing idempotent vendor handoff starts.

Body:

```json
{
  "decision": "PASSED",
  "note": "Looks good"
}
```

`decision`: `PASSED` or `REJECTED`.

### PATCH `/api/production/tasks/:taskId/sent-to-vendor`

Body:

```json
{
  "vendorSubmissionId": "vendorSubmissionId"
}
```

### POST `/api/production/tasks/bulk-push-vendor`

Body:

```json
{
  "taskIds": ["productionTaskId"],
  "vendorSubmissionIdsByTaskId": {
    "productionTaskId": "vendorSubmissionId"
  }
}
```

### GET `/api/production/tasks/qc/export`

Returns an Excel-compatible `.xls` file for QC export. It accepts the same list filters.

## Recheck

### GET `/api/production/order-items/:orderItemId/task`

Returns the production task for an order item.

### POST `/api/production/order-items/:orderItemId/recheck`

Rebuilds/rechecks production task state from current mapping/listing/customization data.

### POST `/api/production/tasks/recheck-psd-blocked`

Body:

```json
{
  "shopId": "optionalShopId",
  "limit": 50
}
```

Rechecks tasks blocked by `PSD_MISSING`, typically after PSD template approval.

Bruno requests:

- `Media / 01 Upload Asset`
- `Production / 07 Upload Scaled Output`
- `Production / 07a Upload Scaled Output File`
