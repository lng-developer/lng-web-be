# Safe Shipment And Tracking Workflow Design

Date: 2026-08-01

## Objective

Make shipment creation, vendor tracking polling, and vendor webhooks safe across multiple vendors and providers. The workflow must preserve vendor credential isolation, reject forged or mismatched updates, apply forward shipment transitions idempotently, and expose an operator workbench only after the backend contract is stable.

## Scope

This design covers:

- Shipment creation after a successful Vendor Submission.
- Vendor-scoped tracking credentials and provider adapters.
- Webhook authentication and provider/submission binding.
- One canonical path for applying webhook, polling, and manual tracking updates.
- Shipment and Order side-effect recovery.
- Date filtering and Printway request correctness.
- Webhook-log privacy and retention.
- A Shipment/Tracking workbench in the existing frontend.

It does not introduce multi-package shipments, purchase labels, carrier-rate shopping, returns merchandise authorization, invoicing, or Finance calculations.

## Current Risks

The current tracking adapters call the old vendor credential contract and can fall back to shared environment credentials. Recheck requests allow the caller to choose provider and external order ID instead of deriving them from the persisted Vendor Submission. Webhooks can resolve a submission by ID without verifying that its provider matches the route. A delivered update without a repeated tracking number can be discarded. Printway search sends a JSON body through a helper that always uses GET. Date-only upper bounds resolve to the start of the day. Webhook logs retain sanitized but otherwise broad raw payloads for 60 days.

## Ownership And Boundaries

- `vendorSubmission` owns the immutable handoff snapshot, selected vendor, provider, provider external order ID, and successful submission state.
- `vendor` owns provider connection configuration and encrypted credentials for one vendor.
- `shipment` owns tracking state, carrier data, webhook processing, polling, and shipment-to-order side effects.
- `order` remains the source of truth for Order and Order Item workflow status. Shipment communicates only through the Order public port.
- The frontend consumes Shipment DTOs and never selects credentials, provider, or vendor external order IDs for polling.

No module may import another module's model or repository. Cross-module access must use public ports.

## Canonical Identity And Credential Resolution

For an operation linked to a Vendor Submission, Shipment loads the submission first and derives:

- `vendorId` from `payloadSnapshot.vendorProduct.vendor.id`.
- `provider` from the snapshotted vendor provider key.
- `vendorExternalOrderId` from the submitted record.
- `shopId`, `orderId`, and `orderItemId` from the submission.

Caller-supplied provider or external order ID cannot override these values. Existing request fields may be accepted temporarily for compatibility only when they match the persisted values exactly; mismatches return `VALIDATION_ERROR` before any vendor request.

Shipment resolves credentials through `vendor.public.getVendorIntegrationCredential(vendorId, provider)`. Tracking adapters receive the resolved credential as an argument and do not access Vendor public APIs or provider credential environment variables. No shared credential fallback is allowed in live tracking paths.

## Shipment Creation

A successful Vendor Submission creates or repairs one active Shipment in `TRACKING_PENDING`. Creation is idempotent by `vendorSubmissionId` and tolerates duplicate-key races.

The integration remains recoverable: if Shipment creation fails after Vendor Submission is already `SUBMITTED`, a repeated submit/handoff or a bounded repair operation creates the missing Shipment without reposting the vendor order.

Shipment creation transitions the linked Order Item to `TRACKING_PENDING` through the Order public port. Repeated creation repairs this side effect without duplicating timeline events.

## Canonical Tracking Application

Webhook, polling, and authorized manual tracking updates use one service operation, `applyTrackingUpdate`. Its normalized input contains:

- Shipment or Vendor Submission identity.
- Provider.
- Optional carrier, tracking number, and tracking URL.
- Optional normalized shipment status.
- Source and source event identity.
- Trusted system or account auth context.

The operation applies these rules atomically where the Shipment document is concerned:

1. A new valid tracking number moves `TRACKING_PENDING` to `SHIPPED`.
2. A repeated identical tracking update is idempotent and repairs missing Order/timeline side effects.
3. A different tracking number cannot replace tracking on terminal shipments.
4. `DELIVERED`, `EXCEPTION`, `RETURNED`, or `CANCELLED` may be applied to an existing shipment without the provider repeating its tracking number, provided the transition is valid.
5. Missing or invalid tracking never creates a false `SHIPPED` transition.
6. Terminal states cannot move backward.
7. Concurrent webhook and polling updates use conditional repository transitions; a loser reloads current state and returns the compatible persisted result or a conflict.

The valid state graph is:

```text
TRACKING_PENDING -> SHIPPED | CANCELLED
SHIPPED -> DELIVERED | EXCEPTION | RETURNED | CANCELLED
EXCEPTION -> RETURNED | CANCELLED
DELIVERED, RETURNED, CANCELLED -> terminal
```

Order timeline and status updates use stable idempotency keys derived from Shipment ID, normalized event type, and tracking/status identity.

## Webhook Authentication

Each supported provider has a webhook verifier behind the tracking adapter registry.

- Use the provider's native HMAC or signature contract when available.
- Otherwise require a provider-specific secret header.
- Query-string tokens are rejected.
- The global shared webhook secret is removed from the live path.
- Static secret comparisons use constant-time comparison.
- Missing provider-specific configuration fails closed.

After authentication, the normalized provider from the route must equal the provider stored on the resolved Vendor Submission. A mismatch is rejected before Shipment lookup or mutation.

Webhook acknowledgements distinguish accepted updates from safely skipped updates without exposing internal errors or vendor credentials. Duplicate authenticated deliveries return success after confirming or repairing the existing state.

## Polling And Provider Adapters

Tracking adapters expose provider normalization and fetch behavior but receive credentials from Shipment service.

- Merchize and Lenful use their documented GET contracts.
- Printway uses the documented method for order-list search and does not depend on a GET request body.
- Provider responses are normalized before domain logic.
- Date-only `dateFrom` is the start of the requested UTC day.
- Date-only `dateTo` is the end of the requested UTC day.
- Batch polling remains bounded to 100 submissions and skips terminal shipments.
- The scheduler keeps its in-process overlap guard. A distributed lock is deferred until multiple scheduler instances demonstrably run concurrently.

Polling errors are returned as bounded diagnostic codes. Tokens, raw authorization headers, and complete vendor responses are not surfaced to clients.

## Webhook Logs And Privacy

Webhook logs retain only operational fields:

- Provider and outcome.
- HTTP status and bounded diagnostic message.
- Shop, Vendor Submission, Order Item, and Shipment identifiers when resolved.
- Carrier, tracking number, normalized vendor status, and processing result.
- Request method, path without query parameters, bounded IP, and bounded user agent.
- A deterministic payload hash for duplicate investigation.

The system does not persist the complete webhook body, recipient details, address data, headers, credentials, tokens, or authorization material. Retention is 30 days. Existing raw logs are allowed to expire under their prior TTL; no destructive historical-data migration is required.

Webhook-log reads continue to enforce exact Shop scope. Unresolved logs with no Shop are visible only to callers with global Shipment read/write permission.

## API Contract

Existing Shipment read and lifecycle routes remain stable where possible.

Changes:

- Recheck by Vendor Submission derives provider and external order ID from the submission.
- Compatibility fields are match-only and cannot override persisted identity.
- Webhook endpoints accept only provider-verifier authentication.
- Date-only list, summary, webhook-log, and recheck filters use full-day semantics.
- A repair-capable internal public port creates Shipment after Vendor Submission success.

The frontend does not receive credential configuration or raw webhook payloads.

## Frontend Workbench

After backend gates pass, add `/portal/shipments` behind `SHIPMENTS:READ`.

The workbench includes:

- A dense Shipment queue with Order, product, vendor/provider, carrier, tracking, status, and last update.
- Filters for external order ID, vendor order ID, tracking number, carrier, status, Shop, and date range.
- Consistent status colors for `TRACKING_PENDING`, `SHIPPED`, `DELIVERED`, `EXCEPTION`, `RETURNED`, and `CANCELLED`.
- A detail drawer with shipment fields and status/timeline history available from safe DTOs.
- An exception queue and scoped webhook-log diagnostics.
- Recheck actions available only with `SHIPMENTS:WRITE`.

The operator cannot choose provider or vendor external order ID. Recheck actions operate on a selected Shipment/Vendor Submission identity.

## Error Handling And Recovery

- Authentication or signature failures return `403` and perform no domain lookup or mutation.
- Provider/submission mismatch returns `400` and performs no vendor request.
- Invalid tracking is safely skipped and recorded without moving Order state.
- Provider transport errors do not alter Shipment state.
- Conditional-update conflicts reload current Shipment state and resolve idempotently when compatible.
- Failure after a Shipment commit does not roll back the Shipment; repeated application repairs Order/timeline side effects.
- Audit and Notification remain best effort and never expose sensitive vendor payloads.

## Testing And Release Gates

Required backend tests:

- Two vendors using the same provider resolve different credentials.
- Missing vendor credentials fail without shared env fallback.
- Recheck rejects provider and external-order mismatch.
- Webhook rejects missing, invalid, query-string, and wrong-provider authentication.
- Duplicate webhook delivery is idempotent.
- Concurrent webhook and polling do not duplicate Shipment or timeline events.
- `DELIVERED` without a repeated tracking number updates an existing `SHIPPED` shipment.
- Invalid, placeholder, or object-like tracking does not move Shipment or Order to `SHIPPED`.
- Printway uses the expected HTTP method and date filters.
- Date-only `dateTo` includes the full day.
- Terminal transitions cannot move backward.
- Webhook logs contain no raw PII or secrets and expire after 30 days.
- Missing Shipment after successful Vendor Submission is repaired without reposting the order.

Required frontend tests:

- Route and RBAC boundary.
- API contract does not send provider or external order ID for recheck.
- Status color mapping.
- Filters and pagination.
- Loading, empty, error, read-only, and write-action states.
- Exception and webhook diagnostics remain Shop scoped.

Release gates:

- Shipment, Vendor Submission, Order integration, route, and architecture tests pass.
- Frontend lint, typecheck/build, focused tests, and full regression pass.
- Production provider-specific webhook secrets/signatures are configured before removing the legacy global secret.
- Scheduler is enabled only after vendor credentials and polling probes pass for each configured vendor.

## Deliberate Deferrals

- Distributed scheduler locking until deployment topology requires it.
- Multi-package and partial-item shipment modeling.
- Automatic carrier webhooks independent of vendor webhooks.
- Label purchasing, return labels, and Finance settlement.
- Historical raw webhook-log cleanup beyond the existing TTL.
