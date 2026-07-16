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
  "assignedDesigner": { "id": "...", "fullName": "Nguyen Thu Trang", "employeeCode": "J11032026" },
  "qcUser": { "id": "...", "fullName": "Nguyen Manh Hung", "employeeCode": "J2444" },
  "csAssignee": { "id": "...", "fullName": "CS User", "employeeCode": "CS001" },
  "csStatus": "ASSIGNED",
  "vendorSubmission": { "id": "...", "status": "FAILED", "failureReason": "..." }
}
```

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

Returns accounts eligible for CS assignment.

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

Files are uploaded through `media` first. Production stores only `mediaAssetId`.

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

### Manual one-step upload

Use this preferred FE path when the slot does not exist yet and the user is
uploading the scaled output in the same action.

```http
POST /api/production/tasks/:taskId/file-checks/manual/scaled-output-file
```

Multipart fields:

```text
slotKey=FRONT
slotLabel=Front
sourceType=CUSTOMER_IMAGE
file=@/path/to/front.png
```

If `slotKey` already exists on the task, production reuses that file check.
Otherwise it creates the manual file check first, streams the file through
`media.public.storeAsset()`, and stores only the returned `outputAssetId`.

### One-step upload

```http
POST /api/production/tasks/:taskId/file-checks/:fileCheckId/scaled-output-file
```

Multipart field:

```text
file=@/path/to/scaled-output.png
```

The wrapper streams the file into `media.public.storeAsset()`, stores the returned `mediaAssetId` on the file check, and returns the updated production task.

### Two-step upload

Use this when debugging media separately.

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

Response includes the updated production task. The file check receives `outputAssetId`; production then derives the next task status for QC.

## QC And Vendor

### PATCH `/api/production/tasks/:taskId/qc`

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
