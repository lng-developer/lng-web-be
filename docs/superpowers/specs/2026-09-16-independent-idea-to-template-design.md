# Independent Idea to Internal Template Design

## Goal

Make an `IDEA` task a global Design-workspace item that can become an operational Catalog `InternalTemplate` after review, without inventing a Listing or Shop before one exists.

## Scope

This changes only `IDEA`. `PSD_TEMPLATE`, `MOCKUP`, `PNG_ASSET`, and `CLONE` remain Listing- and Shop-scoped exactly as they are today.

## Idea record

An IDEA has no `listingId`, `listingVariantId`, or `shopId`. It stores:

```text
title                    required, 1..200 characters
description              optional, up to 2,000 characters
productTypeGroupId       required active Catalog ProductTypeGroup
productImageUrl          optional HTTPS URL
productUrl               optional HTTPS URL
referenceAssetIds        optional Media asset references
assignedDesignerId, priority, submission history, approval history
conversion               null or one completed conversion record
```

`description` replaces the semantic use of `brief` for new IDEA records. Existing listing-bound IDEA records retain their stored fields and remain readable as legacy records; this change does not rewrite historical tasks.

## Lifecycle and access

The existing lifecycle remains: `REQUESTED -> ASSIGNED -> IN_PROGRESS -> SUBMITTED -> APPROVED`, with `REJECTED` for another submission and `CANCELLED` for closure.

Pure IDEAs are visible only to a caller with global Design permission or a Design team scope. Shop-only permission never grants access to a pure IDEA. `DESIGN:WORK` still permits work only on the task assigned to the caller. Existing Listing/Shop access rules remain unchanged for every non-IDEA task.

## Operational handoff

Approval preserves the selected Media asset and creates the normal IDEA work score; it does not create a Listing, template, PSD, Production task, or Vendor submission.

An approved, unconverted IDEA exposes a single explicit action: convert to an `InternalTemplate`.

```text
Approved IDEA + selected submission asset
  -> Catalog operator supplies template code and technical template fields
  -> Catalog creates one InternalTemplate with the approved asset in designAssets
  -> IDEA records the resulting template and conversion actor/time
  -> a later Catalog workflow attaches that reusable template to one or more Shop Listings
```

Conversion requires global `CATALOG:WRITE` in addition to Design review/write authority. It is idempotent: a second request returns the already-linked template instead of creating another. `InternalTemplate.sourceIdeaTaskId` and `DesignTask.conversion.internalTemplateId` provide the two-way trace. Neither module imports the other's model; Design calls a narrow Catalog public port.

The conversion request deliberately requires the Catalog-owned template definition (`code`, `name`, optional description, required fields, artwork slots, asset role, `requiresPsd`). An image/mockup alone is insufficient to infer production slots safely.

## HTTP contract

`POST /api/design/tasks` becomes conditional:

- `taskType=IDEA`: accepts the Idea record fields above and rejects Listing/Shop/source fields.
- all other current task types: retain required `listingId` and their current validation.

The normal task list/detail DTO adds Idea-specific fields and a nullable `conversion` object. Existing consumers continue to receive null for those fields on non-IDEAs.

`POST /api/design/tasks/:taskId/convert-to-internal-template` accepts a Catalog template definition plus `approvedAssetType` and returns both the updated IDEA DTO and the created/reused template DTO. It returns validation errors for a non-IDEA, non-approved task, missing approved asset, inactive product type, or invalid template definition.

## Non-goals

- No automatic Listing creation, marketplace publishing, mapping, Production, or Vendor submission.
- No new generic "idea library" aggregate; `DesignTask` remains the workflow record.
- No migration that removes historical Listing/Shop links from old IDEA tasks.
- No frontend redesign in this backend plan; FE work consumes the documented API after this contract is verified.

## Verification

Focused Design and Catalog service/model/route tests must cover access isolation, conditional validation, conversion idempotency, public-port-only integration, and legacy task compatibility. Finish with the architecture contract and API contract checks.
