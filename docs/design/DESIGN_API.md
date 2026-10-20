# Design API

Base path: `/api/design`

## Auth

- Read routes accept `DESIGN:READ`, `DESIGN:WRITE`, `DESIGN:WORK`, or
  `DESIGN:REVIEW`; services then enforce Shop scope and assigned-designer limits.
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

### Task Summary

```http
GET /api/design/tasks/summary
```

Accepts the same filters as `GET /api/design/tasks`, except `page` and `limit`.

Returns compact counts for tab badges/dashboard:

```json
{
  "total": 100,
  "requested": 5,
  "open": 20,
  "assigned": 15,
  "inProgress": 10,
  "submitted": 8,
  "approved": 30,
  "rejected": 5,
  "cancelled": 7,
  "unassigned": 12,
  "active": 63,
  "byStatus": {},
  "byTaskType": {},
  "byDesigner": []
}
```

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
For `CLONE`, approval updates the target listing PSD reference when
`expectedOutputs` includes `PSD_TEMPLATE` or the approved asset filename/MIME is
recognized as PSD, ZIP, or RAR.
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

### Delete Task

```http
DELETE /api/design/tasks/:taskId
```

Requires `DESIGN:WRITE` for the task Shop. This permanently removes only a task
that has never had an approved PSD submission. It does not delete uploaded media
assets. Use cancel for an approved task that is no longer needed.

### Remove Submission

```http
DELETE /api/design/tasks/:taskId/submissions/:submissionId
```

Only non-approved submissions can be removed. The record is marked `REMOVED` for history; it is not hard-deleted.

Removal does not currently recalculate task status or clear the task-level latest
submitted asset fields.

## PSD File Workspace

```http
GET /api/design/psd-files
```

Query:

- `search`: asset filename prefix, task id, SKU, ASIN, or title.
- `role`: `REFERENCE`, `SUBMISSION`, or `APPROVED`.
- `designerId`, `taskStatus`, `dateFrom`, `dateTo`.
- `page`, `limit`, `sortBy=createdAt|submittedAt`, `sortOrder`.

Returns flattened Media links with their task, Listing, designer, submission, and
link role. Normal task Shop/assigned-designer read rules apply.

## Submission Scores

Approval creates one idempotent score for the approved
`taskId + submissionId + assetId`.

Default points and priority multipliers:

```text
PSD_TEMPLATE=3, IDEA=2, MOCKUP=1, PNG_ASSET=1, CLONE=1
LOW=1, NORMAL=1, HIGH=1.25, URGENT=1.5
```

### List PSD Scores

```http
GET /api/design/submission-scores
```

Query supports `search`, `designerId`, `scoreLevel`,
`scoreStatus=ACTIVE|VOIDED|ALL`, date range, pagination, and sorting by
`scoredAt`, `finalPoints`, or `updatedAt`. Task Shop and assigned-designer read
rules apply.

### Score Summary

```http
GET /api/design/score-summary
```

Filters: `designerId`, `teamId`, `departmentId`, `taskType`, `dateFrom`, and
`dateTo`. Returns active-score totals plus breakdowns by designer and task type.

Current limitation: this endpoint does not apply task Shop scope and has no
`shopId` filter. Although route authentication accepts the normal design read
permissions, the aggregation is global across matching active scores.

### Override Score

```http
PATCH /api/design/submission-scores/:scoreId/override
```

```json
{
  "points": 4.5,
  "scoreLevel": "HARD",
  "overrideReason": "Adjusted after review"
}
```

Requires `DESIGN:REVIEW` or `DESIGN:WRITE` globally or for the score task's
Shop. Points must be non-negative; `scoreLevel` is optional.

### Void One Asset Score

```http
PATCH /api/design/tasks/:taskId/submissions/:submissionId/assets/:assetId/score/void
```

```json
{
  "voidReason": "Duplicate approved file"
}
```

Void targets one active asset score, preserves its point history, and changes
status to `VOIDED`. It uses the same reviewer and task-Shop authorization as
override.
