# Returns, Claims, and RMA Conditional Design

## Status

Approved for product discovery and implementation planning only after the product gate below passes. This document does not authorize implementation.

## Problem

The current POD lifecycle covers fulfillment through shipment and finance, but it does not define ownership for post-delivery defects, reprints, refunds, or vendor claims. Adding isolated flags to order, shipment, or finance would scatter one lifecycle across multiple sources of truth.

## Product Gate

Implementation planning may begin only when the product owner approves all of:

- supported intake actors and channels;
- eligible reason codes and evidence requirements;
- reprint, refund, reject, and vendor-claim decision policy;
- approval roles and monetary thresholds;
- vendor claim submission and response process;
- finance treatment for refunds, reprint cost, recovered vendor credit, and write-off;
- terminal states and retention/audit requirements.

If any item is unapproved, the work remains discovery-only.

## Goal

When the product gate passes, introduce one bounded `returnsClaims` module that owns the post-delivery case lifecycle while using public ports for order, media, vendor submission, shipment, finance, auth, and audit interactions.

## Non-Goals

- Marketplace return-label logistics unless separately approved.
- Warehouse inventory returns for POD goods.
- Automated adjudication or AI image grading.
- Editing historical shipment or finance records to hide adjustments.
- A generic ticketing platform.

## Proposed Ownership

The module owns:

- case identity and lifecycle;
- affected order items and claimed quantities;
- reason code and customer/operator description;
- evidence asset references;
- decision and approval evidence;
- requested and executed remedies;
- vendor claim references and outcome;
- links to finance adjustment records;
- case timeline.

It does not own:

- canonical order/item data;
- media binary storage;
- original vendor submission;
- shipment/tracking truth;
- finance ledger or snapshots;
- authentication and scoped access.

## Proposed State Machine

`OPEN -> EVIDENCE_PENDING -> UNDER_REVIEW -> APPROVED | REJECTED`

Approved cases proceed through one or more explicit remedy tracks:

- `REPRINT_REQUESTED -> REPRINT_IN_PROGRESS -> REPRINT_SHIPPED -> RESOLVED`
- `REFUND_APPROVED -> REFUND_RECORDED -> RESOLVED`
- `VENDOR_CLAIM_OPEN -> VENDOR_CLAIM_ACCEPTED | VENDOR_CLAIM_REJECTED`

`CANCELLED` is allowed only before a financial or production remedy is executed. State transitions are guarded and append immutable case timeline evidence.

## Identity and Idempotency

Case creation requires a stable intake identity consisting of source channel and external request identifier. Repeated intake returns the existing case. Remedy commands use case/version plus remedy type as their idempotency identity.

One order may have multiple cases only when intake identities differ. The service prevents overlapping active claims for the same order item, quantity, and reason unless an authorized override is recorded.

## Cross-Module Flow

- `order.public` validates order/item identity and shop scope.
- `media.public` stores and resolves evidence assets.
- Reprint creates work through the existing production/vendor submission boundaries rather than cloning order documents.
- `shipment.public` links replacement shipment state.
- `finance.public` records explicit adjustments; original snapshots remain historically truthful.
- Auth scoped RBAC controls read, review, approve, and financial actions.
- Audit captures material lifecycle and override events.

## API Shape

The eventual public API includes:

- create and retrieve case;
- paginated case list with scoped filters;
- attach/remove evidence before review;
- submit for review;
- approve/reject with guarded reason;
- request reprint or record refund;
- open/update vendor claim;
- cancel when eligible;
- retrieve timeline.

Exact routes, DTOs, validators, models, and public-port signatures belong in the implementation plan after product-gate approval.

## Error Handling

- Invalid or inaccessible order/item references fail before case creation.
- Remedy failure preserves the approved case and records retryable execution status.
- Finance or reprint partial failure cannot mark the case resolved.
- Sensitive customer data, asset internals, and vendor credentials are excluded from DTOs and logs.

## Testing Strategy

- Model/repository tests for identity and active-overlap constraints.
- State-transition tests for every allowed and rejected edge.
- Service tests for scoped authorization, idempotency, partial failure, and owner-module calls.
- Route/validator/DTO tests.
- Architecture tests for public-port-only dependencies.
- E2E tests for reprint, refund, and vendor-credit outcomes after the product gate defines them.

## Acceptance Criteria for Design Readiness

- Every product-gate item has an approved, written answer.
- State and remedy ownership has no overlap with order, shipment, vendorSubmission, or finance.
- Finance adjustments preserve original transaction history.
- Reprint uses existing fulfillment boundaries.
- The proposed module has at least one confirmed production workflow; otherwise it is not created.

## Roadmap Position

RMA planning follows CI baseline, golden flow, Exception Center, and operational resilience. It must not block those workstreams.
