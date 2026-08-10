# POD Golden Flow Design

## Status

Approved design for planning. Depends on the CI and Test Baseline exit gate.

## Problem

The backend has the required domain modules, but correctness is mostly demonstrated within individual module suites. The system needs one canonical contract proving that an imported order can traverse the supported POD lifecycle without violating module boundaries or duplicating state.

## Goal

Provide a deterministic E2E contract for:

`externalOrderImport -> order -> mapping -> customization -> production -> vendorSubmission -> shipment -> finance`

The contract must prove the happy path, replay idempotency, and recovery after a mid-flow failure.

## Non-Goals

- Adding Amazon SP-API or another import source.
- Creating a workflow/orchestrator module.
- Running live vendor requests in Jest.
- Replacing focused module tests.
- Encoding frontend behavior.

## Architecture

Each module remains the source of truth for its own lifecycle. Cross-module calls use the target module's `public.js`. The E2E test coordinates existing public contracts and mocks only external I/O boundaries such as vendor HTTP calls, storage, Redis, or queue delivery.

The supported input begins as either `AMAZON_EXTENSION_REPORT` or `MANUAL_EXCEL`. Integration maps it to `ExternalOrderDTO` and calls `order.public.importExternalOrder()`. Customization payload creation continues through `customization.public.createPendingPayload()`.

No central transaction spans modules. Recovery relies on stable external identities, idempotent upserts, guarded state transitions, and replayable post-import work.

## Canonical Scenario

The fixture represents one shop, one imported order, and one order item with:

- stable external order and item identifiers;
- a SKU resolvable by existing mapping rules;
- customization data sufficient to reach readiness;
- catalog/design assets required by production;
- a configured test vendor adapter response;
- a tracking event that can create or update shipment state;
- monetary inputs sufficient for a finance snapshot.

The final assertions cover:

- exactly one normalized order and one order item;
- mapping result linked to the order item;
- customization readiness recorded by the customization module;
- production task reaches the vendor-ready boundary;
- exactly one active vendor submission;
- shipment/tracking state linked to the correct order item;
- finance snapshot linked to the same order and item;
- lifecycle timeline/audit evidence uses stable event identity where supported.

## Replay Contract

Reprocessing the same source identity must not create a second:

- order;
- order item;
- active production task for the same work;
- vendor submission for the same idempotency identity;
- shipment for the same tracking identity;
- finance snapshot for the same snapshot identity.

Replay may update mutable fields when the owning module permits it.

## Recovery Contract

The E2E contract injects one transient failure after normalized order creation but before the flow completes. A subsequent supported replay/recovery entrypoint must complete the lifecycle without manual database edits and without duplicating prior successful writes.

The test must assert the stored failure/retry evidence already owned by the relevant module. It must not introduce a generic workflow-status collection.

## Error Handling

- Expected domain conflicts remain `AppError` instances with stable codes.
- External/transient errors retain enough context for retry but exclude secrets and sensitive payloads.
- A failed downstream step must not roll back a valid imported order.
- Recovery must resume from persisted source-of-truth state rather than a process-local flag.

## Testing Strategy

- Extend `tests/e2e/orderFulfillmentFlow.e2e.test.js` when the scenario fits its current responsibility.
- Keep parser and module rules in their existing focused suites.
- Use the smallest contract-faithful repository/public-port mocks.
- Run architecture, focused E2E, related module suites, and the full Jest suite.

## Acceptance Criteria

- Happy path reaches a linked finance snapshot.
- Identical replay produces no duplicate domain records.
- A transient mid-flow failure can be recovered through a supported entrypoint.
- All cross-module imports pass the architecture contract.
- No new module, package, import source, or global transaction is introduced.

## Exit Gate

Operations Exception Center may start when the canonical flow and its replay/recovery cases pass consistently and expose stable failure states that operators can query.
