# Order Workflow Projection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide one backend-owned operational workflow stage for every order item so Orders, Scale, QC, and Shipping show the same next action.

**Architecture:** Keep module facts in their current owners: customization, mapping, listing/template, production, submission, and shipment. A small order workflow service derives a `workflow` projection from those facts; API DTOs expose it and FE renders it without local priority rules.

**Tech Stack:** Node.js, Mongoose, Jest, React, TanStack Query, existing API client.

## Global Constraints

- Do not change existing business records or backend routes.
- Do not add dependencies.
- Keep raw ids internal; UI renders user-facing labels only.
- A workflow stage is derived by BE and never authored by FE.

---

### Task 1: Define and test the workflow projection

**Files:**
- Create: `src/modules/order/services/orderWorkflow.service.js`
- Create: `src/test/order/services/orderWorkflow.service.test.js`

- [x] Write failing tests for terminal states, missing mapping, missing PSD, text-only customization, customer-image requirement, scale, QC reject, vendor handoff, and shipment stages.
- [x] Implement the smallest pure `deriveOrderItemWorkflow(facts)` function returning `{ stage, owner, blockers, nextActions }`.
- [x] Run `npx jest src/test/order/services/orderWorkflow.service.test.js --runInBand`.

### Task 2: Attach workflow to operational DTOs and queries

**Files:**
- Modify: `src/modules/order/dtos/order.dto.js`
- Modify: `src/modules/order/services/orderQuery.service.js`
- Modify: `src/modules/production/dtos/productionTask.dto.js`
- Modify: `src/modules/production/repositories/productionTask.repository.js`
- Test: `src/test/order/dtos/order.dto.test.js`
- Test: `src/test/production/repositories/productionTask.repository.test.js`

- [x] Write failing DTO/query tests for a shared `workflow` payload.
- [x] Hydrate workflow facts once per returned row and expose the projection in Order Workbench, Order Detail, and production responses.
- [x] Run the focused order/production suites.

### Task 3: Remove FE workflow inference

**Files:**
- Modify: `src/features/orders/utils/ordersApi.js`
- Modify: `src/features/scale/utils/scaleApi.js`
- Test: `src/features/orders/utils/ordersApi.test.js`
- Test: `src/features/scale/utils/scaleApi.test.js`

- [x] Write failing mapper tests proving `workflow.stage` wins over stale item/listing status.
- [x] Render the BE-provided stage with a legacy-field fallback for partial-migration responses.
- [x] Run focused FE tests and `npm run build`.

### Task 4: Regression verification

**Files:**
- Test: `src/test/e2e/orderFulfillmentFlow.e2e.test.js`

- [x] Add the cross-module edge cases that previously diverged: mapped-but-missing-PSD, no-customization, custom image missing, QC rejection, and sent-to-vendor/tracking.
- [x] Run focused suites for order, production, and FE mapper behavior.
