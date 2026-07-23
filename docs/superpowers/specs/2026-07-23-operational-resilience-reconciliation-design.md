# Operational Resilience and Reconciliation Design

## Status

Approved design for planning. Depends on the Operations Exception Center contract.

## Problem

The system has retries and recovery behavior in individual flows, but operators need consistent visibility into attempts, terminal failure, and cross-module mismatches. Vendor submission, shipment, and finance can each be locally valid while collectively representing an incomplete order lifecycle.

## Goal

Make existing retries observable and add deterministic reconciliation checks across vendor submission, shipment, and finance without introducing a generic workflow engine.

## Non-Goals

- Replacing BullMQ or Redis.
- Moving all asynchronous work into queues.
- Building a generic scheduler abstraction.
- Automatically issuing refunds, reprints, or vendor claims.
- Persisting a second copy of module state.

## Architecture

Each module continues to own retry state and mutations. Where a flow already uses BullMQ, the existing queue remains the delivery mechanism. Synchronous flows stay synchronous unless a measured reliability problem requires queueing.

The `report` module exposes reconciliation findings as read models. It calls narrow public-port queries from `vendorSubmission`, `shipment`, `finance`, and `order`. It never writes their state.

Repair actions call the owning module's existing public operation. New repair operations are added only when the mismatch has a deterministic, idempotent correction.

## Retry Visibility Contract

Retry-capable records expose through owner-module DTOs:

- `attemptCount`;
- `lastAttemptAt`;
- `nextRetryAt` when scheduled;
- `lastErrorCode`;
- sanitized `lastErrorMessage`;
- `retryState`: `NOT_SCHEDULED`, `SCHEDULED`, `RETRYING`, `EXHAUSTED`, or `RESOLVED`.

These fields are added only to records that already own retry behavior. No universal retry table is introduced.

## Reconciliation Rules

Initial deterministic findings:

1. `SUBMITTED_WITHOUT_SHIPMENT`
   A vendor submission is confirmed, its grace period has elapsed, and no matching shipment/tracking record exists.
2. `SHIPPED_WITHOUT_FINANCE_SNAPSHOT`
   Shipment has reached the configured shipped boundary and no current finance snapshot exists for the order.
3. `FINANCE_ITEM_LINK_INCOMPLETE`
   A snapshot exists but not all eligible order items are linked to a cost/revenue line.
4. `TERMINAL_VENDOR_FAILURE_WITH_ACTIVE_PRODUCTION`
   Submission retries are exhausted while the production task remains in a state implying active vendor handoff.

Grace periods and terminal-state mappings reuse existing constants/configuration when present. A new configuration value is allowed only when operations must tune a real external timing boundary.

## Repair Rules

- Shipment recheck calls shipment-owned vendor tracking recheck.
- Finance rebuild calls the existing finance snapshot recalculation/upsert boundary.
- Vendor resubmission calls vendorSubmission-owned retry and retains idempotency identity.
- Production correction uses a guarded production transition; reconciliation never writes production repositories directly.

Repair endpoints must reject stale findings by re-reading source state before mutation.

## Authorization and Audit

Read access follows report scope filtering. Repair requires the owner module's write permission and scope access. Every accepted manual repair emits existing audit/timeline evidence without including credentials or raw vendor payloads.

## Error Handling

- Transient external errors remain retryable according to owner-module policy.
- Validation, authorization, and domain conflicts are not retried.
- Exhausted retry state is visible in the Exception Center.
- Reconciliation source failure fails the request; partial success is not reported as complete.

## Testing Strategy

- Owner-module tests for retry-state DTOs and classification.
- Report service tests for all four reconciliation predicates and grace periods.
- Repair tests for stale-check rejection, idempotency, permission, and audit evidence.
- E2E cases for vendor failure recovery and shipment-to-finance repair.
- Full architecture and Jest verification.

## Acceptance Criteria

- Operators can distinguish scheduled retry from exhausted failure.
- All four mismatch types are queryable through report contracts.
- Supported repair actions are idempotent and owner-module guarded.
- Reconciliation never imports internal files across modules.
- No new queue framework, generic scheduler, or universal retry collection is added.

## Exit Gate

This workstream is complete when the golden flow can be observed, reconciled, and safely repaired from each supported injected failure.
