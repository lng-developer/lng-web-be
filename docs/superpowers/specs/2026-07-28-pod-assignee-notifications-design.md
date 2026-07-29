# POD Assignee Notifications — Small Version

## Goal

Extend the existing persisted notification inbox to alert explicitly assigned POD operators when a workflow needs their attention. Keep notification delivery best-effort so it never rolls back the owning business transition.

## Scope

The first version emits only these notifications:

| Type | Trigger | Recipient | Related resource |
| --- | --- | --- | --- |
| `ORDER_ASSIGNED` | An order is assigned to a staff account | New `order.assignedStaffId` | `order` |
| `PRODUCTION_ASSIGNED` | A production task is assigned to a designer | New `productionTask.assignedDesignUserId` | `productionTask` |
| `PRODUCTION_BLOCKED` | An assigned production task transitions to `BLOCKED` | `productionTask.assignedDesignUserId` | `productionTask` |
| `PRODUCTION_QC_REJECTED` | An assigned production task transitions to `QC_REJECTED` | `productionTask.assignedDesignUserId` | `productionTask` |
| `VENDOR_SUBMISSION_FAILED` | A vendor submission transitions to `FAILED` | Its order's `assignedStaffId` | `vendorSubmission` |
| `SHIPMENT_EXCEPTION` | A shipment transitions to `EXCEPTION` | Its order's `assignedStaffId` | `shipment` |

If the relevant assignment is absent, the service skips notification delivery. Unassigned work remains discoverable through existing workbench queues.

## Architecture

Each owning service calls `notification/public.js` only after its state transition succeeds. No module imports notification internals. Downstream services obtain order ownership only through `order/public.js` or an existing snapshot; they do not query the order model directly.

The existing `notify()` public port remains the delivery boundary. It already converts persistence failures into a logged best-effort failure result, so notification failure does not change the business response.

No event bus, queue, scheduler, preference model, or new API is introduced.

## Deduplication

Every call supplies a deterministic key containing the event type, resource ID, recipient ID, and the persisted transition version (`updatedAt` or an equivalent transition timestamp). Replaying the same persisted transition produces one inbox row, while a later real reassignment or repeated failure can produce another notification.

## Content

Titles and messages remain short and operational. They identify the order or task and the action needed without including customer PII. `relatedResource` contains only the resource type and ID so the frontend can navigate to the existing workbench/detail view.

## Verification

- Add focused unit assertions at the owning service transitions, mocking only `notification/public.js`.
- Cover recipient selection, missing-assignee skip, deterministic deduplication, and best-effort failure behavior.
- Run the affected module tests, notification tests, syntax checks, and `npm run test:architecture -- --runInBand`.

## Explicitly Deferred

- Tracking-overdue alerts until a canonical SLA/deadline exists.
- Broadcasts to roles, teams, or shop-scoped accounts.
- Email, push, WebSocket delivery, and per-user preferences.
- Notifications for successful status changes other than assignment.
