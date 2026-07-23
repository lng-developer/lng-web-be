# Operations Exception Center Design

## Status

Approved design for planning. Depends on stable failure states demonstrated by the POD Golden Flow.

## Problem

Operational failures are owned by several modules and require operators to search separate endpoints. The system lacks a single read contract that answers:

- what is blocked;
- where it is blocked;
- why it is blocked;
- how long it has been blocked;
- which supported action can move it forward.

Creating another source-of-truth workflow would duplicate state and drift from the owning modules.

## Goal

Expose a report-owned, read-only exception feed that aggregates current module state and points clients to existing module-owned recovery actions.

## Non-Goals

- Creating an `exception` module or exception collection.
- Moving retry/recheck business rules into `report`.
- A generic rules engine.
- Automatic remediation in the first version.
- Building the frontend in this backend workstream.

## Architecture

`report` owns the aggregation contract and DTO. Source modules expose narrow read methods through their `public.js` ports when an existing public method cannot supply the required state. The report service does not import another module's model, repository, service, or controller.

Recovery remains with the owner:

- mapping issues are resolved or replayed through integration/mapping contracts;
- customization review stays in customization;
- PSD and QC blocks stay in design/production;
- vendor submission retry stays in vendorSubmission;
- tracking recheck stays in shipment;
- snapshot rebuild/recalculation stays in finance.

Version one computes the feed on request with bounded queries and pagination. No materialized exception collection or background projection is added until measurements show the read path is inadequate.

## Read Contract

The initial API is a report route under `/api/reports`. It returns paginated items with:

- `id`: stable compound identity derived from source module, entity, and exception code;
- `sourceModule`;
- `exceptionCode`;
- `severity`: `WARNING` or `BLOCKED`;
- `entityType`;
- `entityId`;
- `shopId` when applicable;
- `orderId` and `orderItemId` when applicable;
- `summary`;
- `firstObservedAt`;
- `lastObservedAt`;
- `ageSeconds`;
- `allowedActions`: action identifiers only;
- `context`: a bounded, non-sensitive DTO specific to the exception code.

Filters include `sourceModule`, `exceptionCode`, `severity`, `shopId`, `ageFromSeconds`, `page`, and `limit`. `limit` follows the repository's existing pagination maximum.

## Initial Exception Codes

- `MAPPING_MISSING`
- `CUSTOMIZATION_REVIEW_REQUIRED`
- `PSD_MISSING`
- `PRODUCTION_QC_BLOCKED`
- `VENDOR_SUBMISSION_FAILED`
- `TRACKING_PENDING`
- `FINANCE_SNAPSHOT_INCOMPLETE`

An exception code is included only when the source module has a deterministic persisted predicate and a supported operator action or documented manual resolution.

## Authorization

The report route requires report read permission plus scope filtering. Results must be restricted using Auth scoped RBAC. The service must not accept client-supplied account or scope claims as trusted authorization.

`allowedActions` reflects both current domain state and the caller's permission. It does not execute the action.

## Consistency and Pagination

The feed is eventually consistent across module reads. Every query uses a single request timestamp for age calculation. Results sort by severity, oldest observation, source module, and stable identity.

Version one may use bounded fan-out across public ports. Each source result must be limited before merge so the route cannot load unbounded collections.

## Error Handling

Failure of one source port must fail the request rather than silently presenting an incomplete operational picture. The error is logged with source-module context and flows through global middleware. Sensitive source payloads are not logged or returned.

## Testing Strategy

- DTO tests for field allow-listing and sensitive-data exclusion.
- Service tests for aggregation, filtering, ordering, action authorization, and one-source failure.
- Route tests for validation and permission boundaries.
- Architecture contract proving public-port-only dependencies.
- E2E assertion that a golden-flow injected failure appears and disappears after recovery.

## Acceptance Criteria

- One endpoint returns the seven initial deterministic exception classes.
- No duplicated exception state is persisted.
- Every returned action maps to an existing owner-module operation.
- Scope/RBAC filters prevent cross-shop leakage.
- Pagination is bounded and deterministic.
- Recovery of a source entity removes it from the subsequent feed.

## Exit Gate

Operational Resilience and Reconciliation may start after operators can identify the current failure owner and supported action through this contract.
