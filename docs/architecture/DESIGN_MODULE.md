# Design Module

`design` owns designer work tasks for master listing/template assets. It is for PSD template, mockup, PNG asset, idea, and clone work before those assets become trusted catalog references.

## Ownership

- `design` owns `DesignTask` workflow state and QC approval.
- `catalog` owns `Listing`, `ProductTypeGroup`, and `InternalTemplate` metadata.
- `media` owns binary file storage and `MediaAsset` metadata.

## Boundaries

- `design` may call only `catalog/public.js`, `media/public.js`, `production/public.js`, and `auth/public.js`.
- `design` must not import catalog or media models, repositories, services, validators, DTOs, or routes.
- `design` stores only media asset IDs; it does not store binary data, local paths, provider paths, or credentials.
- An approved `PSD_TEMPLATE` task writes back to catalog through `catalog.public.setListingPsdTemplateAsset(...)`.
- An approved `CLONE` task writes back to catalog only when its `expectedOutputs` includes `PSD_TEMPLATE`.
- `IDEA`, `MOCKUP`, and `PNG_ASSET` tasks stop at design approval in V1.
- After a PSD writeback, `design` may ask `production` to recheck tasks blocked by `PSD_MISSING`; this is best-effort and must not roll back catalog PSD approval.

## Workflow

```text
OPEN -> ASSIGNED -> IN_PROGRESS -> SUBMITTED -> APPROVED
                                      |
                                      -> REJECTED -> SUBMITTED

Any non-approved active task may be CANCELLED.
```

## Permissions

- `DESIGN:READ` reads design tasks.
- `DESIGN:WRITE` creates tasks and performs assign/start/submit/approve/reject/cancel actions.
- `DESIGN:WORK` lets a designer list/read/start/submit only tasks assigned to their own `accountId`.
- `DESIGN:REVIEW` lets QC/lead approve or reject tasks without broad write access.
- Tasks with `shopId` are protected by shop-scoped RBAC.

## PSD Flow

```text
media upload -> PSD_TEMPLATE design task -> submit mediaAssetId -> approve
  -> catalog Listing.psdTemplateAssetId + psdStatus=PRESENT
  -> best-effort production recheck for PSD_MISSING
```

Direct catalog PSD upload is reserved for admin/backfill. Normal operator work should go through DesignTask approval.

Operators can create PSD tasks one listing at a time or in batches. Bulk creation is idempotent: existing active PSD tasks are reused and listings with PSD already present are skipped.

## IDEA / CLONE

- `IDEA` is for a new design concept from a brief and optional reference assets. It requires `brief`.
- `CLONE` is for deriving a target listing/template asset from an existing listing or internal template. It requires `sourceListingId` or `sourceInternalTemplateId`.
- `listingId` remains the target listing for all task types.
- `referenceAssetIds`, `submittedAssetIds`, and `approvedAssetId` are media asset references only.
