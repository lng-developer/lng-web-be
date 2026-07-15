# Design API

Base path: `/api/design`

## Auth

- Read routes require `DESIGN:READ`.
- Write/action routes require `DESIGN:WRITE`.
- Assigned designer work routes may use `DESIGN:WORK`.
- QC approve/reject may use `DESIGN:REVIEW`.
- Shop-scoped access is enforced from the task/listing `shopId`.

## Design Tasks

## PSD Flow

Normal PSD creation uses `media` + `design`, not direct catalog upload:

1. Production detects `PSD_MISSING` and best-effort creates/gets a `PSD_TEMPLATE` task for the listing.
2. Operators can also create/get a PSD task with `POST /api/design/tasks/from-listings/:listingId/psd-template`.
3. Upload PSD/ZIP/RAR with `POST /api/media/assets`.
4. Assign/start task.
5. Submit the uploaded `mediaAssetId`.
6. Approve the task. Approval updates `Listing.psdTemplateAssetId`, sets `psdStatus=PRESENT`, and best-effort rechecks production tasks blocked by `PSD_MISSING`.

`POST /api/catalog/listings/:id/psd-template` remains admin/backfill only.

### List Tasks

```http
GET /api/design/tasks
```

Query:

- `search`: task id, ASIN, SKU, or title.
- `status`: `REQUESTED`, `OPEN`, `ASSIGNED`, `IN_PROGRESS`, `SUBMITTED`, `APPROVED`, `REJECTED`, `CANCELLED`.
- `taskType`: `PSD_TEMPLATE`, `MOCKUP`, `PNG_ASSET`, `IDEA`, `CLONE`.
- `listingId`
- `sellerId`: alias of `shopId`.
- `shopId`
- `assignedDesignerId`
- `unassigned`: boolean.
- `dateFrom`, `dateTo`: created date range.
- `priority`: `LOW`, `NORMAL`, `HIGH`, `URGENT`.
- `psdStatus`: listing snapshot PSD status, `MISSING` or `PRESENT`.
- `sortBy`: `createdAt`, `updatedAt`, `submittedAt`, `priority`, `status`.
- `sortOrder`: `asc` or `desc`.
- `page`, `limit`: max `100`.

Designers with only `DESIGN:WORK` only receive tasks assigned to their own `accountId`.

Response item fields FE should use:

```json
{
  "id": "taskId",
  "taskType": "PSD_TEMPLATE",
  "status": "REQUESTED",
  "priority": "NORMAL",
  "listingId": "listingId",
  "listingSnapshot": {
    "sku": "SKU-1",
    "asin": "B0...",
    "title": "Listing title",
    "psdStatus": "MISSING"
  },
  "assignedDesigner": {
    "id": "accountId",
    "fullName": "Designer",
    "avatarUrl": null
  },
  "shop": { "id": "shopId", "name": "Shop name" },
  "seller": { "id": "shopId", "name": "Shop name" },
  "asinType": "NORMAL",
  "latestSubmittedAsset": {
    "id": "assetId",
    "originalFilename": "design.psd",
    "mimeType": "image/vnd.adobe.photoshop",
    "size": 123456,
    "createdAt": "2026-07-15T00:00:00.000Z"
  },
  "latestSubmission": {
    "id": "submissionId",
    "version": 1,
    "status": "SUBMITTED"
  },
  "submissionCount": 1,
  "hasActivePsdTask": true
}
```

### Workload Dashboard

```http
GET /api/design/tasks/workload
```

Accepts the same filters as `GET /api/design/tasks`, except `page` and `limit`.

Returns live counts from `DesignTask`: totals by status/type, unassigned count, and per-designer workload by `assignedDesignerId`.

### Assignees

```http
GET /api/design/assignees
```

Query:

- `taskType`: optional, for example `PSD_TEMPLATE`.
- `search`

Response:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "accountId",
        "fullName": "Designer",
        "avatarUrl": null,
        "activeTaskCount": 4
      }
    ]
  }
}
```

Use `id` as `assignedDesignerId` when assigning a task.

### PSD Template Candidates

```http
GET /api/design/tasks/psd-template/candidates
```

Query:

- `search`
- `sellerId` or `shopId`
- `salesChannelCode`
- `marketplaceCode`
- `productTypeGroupId`
- `page`, `limit`

Returns listings with `psdStatus=MISSING` and no active `PSD_TEMPLATE` task.

### Get Task

```http
GET /api/design/tasks/:taskId
```

Detail response includes list fields plus:

- `submissions`
- `latestSubmission`
- `approvedSubmission`

Each submission includes asset metadata for `assetIds`.

### List Submissions

```http
GET /api/design/tasks/:taskId/submissions
```

Use this for a history drawer without reloading the full task detail.

### Create Task

```http
POST /api/design/tasks
```

Body:

```json
{
  "listingId": "...",
  "taskType": "PSD_TEMPLATE",
  "priority": "NORMAL",
  "note": "Need PSD master"
}
```

`taskType`: `PSD_TEMPLATE`, `MOCKUP`, `PNG_ASSET`, `IDEA`, `CLONE`.

IDEA body:

```json
{
  "listingId": "...",
  "taskType": "IDEA",
  "brief": "Create a new graduation shirt concept",
  "referenceAssetIds": ["..."],
  "expectedOutputs": ["MOCKUP", "PNG_ASSET"],
  "note": "Use the attached references"
}
```

CLONE body:

```json
{
  "listingId": "...",
  "taskType": "CLONE",
  "sourceListingId": "...",
  "sourceInternalTemplateId": null,
  "brief": "Clone source design for this target listing",
  "referenceAssetIds": ["..."],
  "expectedOutputs": ["PSD_TEMPLATE"],
  "note": "Keep layout, adjust product text"
}
```

`listingId` is the target listing. `IDEA` requires `brief`. `CLONE` requires either `sourceListingId` or `sourceInternalTemplateId`.

### Create PSD Task From Listing

```http
POST /api/design/tasks/from-listings/:listingId/psd-template
```

Body:

```json
{
  "note": "Need PSD master"
}
```

Requires the listing to have `psdStatus=MISSING`. If an active PSD task already exists for the listing, the existing task is returned.

### Bulk Create PSD Tasks From Listings

```http
POST /api/design/tasks/bulk-create-psd-from-listings
```

By explicit listing IDs:

```json
{
  "listingIds": ["..."],
  "note": "Need PSD master"
}
```

Or by listing filters:

```json
{
  "filters": {
    "shopId": "...",
    "salesChannelCode": "AMAZON",
    "marketplaceCode": "AMAZON_US",
    "productTypeGroupId": "..."
  },
  "limit": 100,
  "note": "Need PSD master"
}
```

The endpoint is idempotent. Existing active PSD tasks return `EXISTING`; listings with PSD already present return `SKIPPED`.

### Assign Task

```http
PATCH /api/design/tasks/:taskId/assign
```

Body:

```json
{
  "assignedDesignerId": "...",
  "note": "Assign to designer"
}
```

### Start Task

```http
PATCH /api/design/tasks/:taskId/start
```

Body:

```json
{
  "note": "Started work"
}
```

`DESIGN:WORK` can start only tasks assigned to the current `auth.accountId`.

### Submit Task

```http
PATCH /api/design/tasks/:taskId/submit
```

Body:

```json
{
  "submittedAssetIds": ["..."],
  "note": "Submitted PSD"
}
```

Files must be uploaded through `media` first. Design submits only `mediaAssetId` references.
`DESIGN:WORK` can submit only tasks assigned to the current `auth.accountId`.
Each submit creates a new submission version and sets task status to `SUBMITTED`.

### Approve Task

```http
PATCH /api/design/tasks/:taskId/approve
```

Body:

```json
{
  "approvedAssetId": "...",
  "submissionId": "..."
}
```

Use either `submissionId` or `version`, not both. If neither is provided, the latest `SUBMITTED` submission is approved.
For `PSD_TEMPLATE`, approval updates the catalog listing PSD reference.
For `CLONE`, approval updates the target listing PSD reference only when `expectedOutputs` includes `PSD_TEMPLATE`.
For `IDEA`, `MOCKUP`, and `PNG_ASSET`, approval only closes the design task in V1.
If related production tasks were blocked by `PSD_MISSING`, approval rechecks them best-effort. Recheck failures are returned in `warnings` and do not roll back approval.
Requires `DESIGN:WRITE` or `DESIGN:REVIEW`.

### Reject Task

```http
PATCH /api/design/tasks/:taskId/reject
```

Body:

```json
{
  "rejectReason": "Wrong template",
  "version": 2
}
```

Use either `submissionId` or `version`, not both. If neither is provided, the latest `SUBMITTED` submission is rejected.

### Cancel Task

```http
PATCH /api/design/tasks/:taskId/cancel
```

Body:

```json
{
  "cancelReason": "No longer needed"
}
```

### Remove Submission

```http
DELETE /api/design/tasks/:taskId/submissions/:submissionId
```

Only non-approved submissions can be removed. The record is marked `REMOVED` for audit; it is not hard-deleted.
