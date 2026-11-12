# Vendor Rematch Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide an audited action that resets an externally-cancelled vendor order item to manual vendor matching and guarantees a fresh production/QC run.

**Architecture:** Add an order-owned recovery service and route. It validates the active vendor submission and shipment through module public ports, invokes each module's narrow cancellation/reset operation, recomputes order status/read-model fields, and writes a timeline/audit event. FE exposes a confirmed action and refreshes the workbench queries.

**Tech Stack:** Express, Mongoose transactions, Joi, React, Ant Design, React Query, Jest.

**Spec:** `docs/superpowers/specs/2026-11-12-vendor-rematch-recovery-design.md`

## Global Constraints

- Do not re-import Amazon data or reuse production/QC outputs.
- Require external-cancellation confirmation and a reason.
- Block recovery when tracking or marketplace confirmation exists.
- Preserve cancelled attempts and audit history.
- Use module public ports only.

## Review Focus

- Submitted orders with a tracking number must be rejected.
- A cancelled task must not populate `Scale by` in the order workbench.
- The `NO_COST_CENTER` tab must include a recovered item until a new cost center is selected.
- A repeated recovery request must not create duplicate timeline/audit data.
- Permissions must require the existing order/vendor/mapping/production write scope.

---

### Task 1: Backend recovery contract

**Files:** order validator/controller/routes/public/service tests; mapping, production, vendorSubmission, shipment public service/repository tests.

- [ ] Write failing service and route tests for successful recovery, tracking rejection, confirmation/reason validation, and idempotency.
- [ ] Add narrow public-port operations to cancel the active task/submission, mark an untracked shipment cancelled, and clear the selected fulfillment plan.
- [ ] Add `POST /api/orders/items/:orderItemId/vendor-rematch-recovery`; transition the item to `MAPPING_PENDING`, recompute cost-center status, write timeline/audit, and rebuild projection.
- [ ] Run focused order/mapping/production/vendor-submission tests.

### Task 2: Workbench state correctness

**Files:** production summary service/repository and order workbench repository tests.

- [ ] Write failing tests proving cancelled production tasks are not used for workbench summary and recovered items count in `NO_COST_CENTER`.
- [ ] Exclude cancelled tasks from workbench summaries and keep cost-center filters based on recomputed active plan state.
- [ ] Run focused workbench tests.

### Task 3: Operator UI

**Files:** FE order API, mutation hook, action menu/modal, translations, and tests.

- [ ] Write failing UI/API tests for confirmation, reason submission, server error, and query invalidation.
- [ ] Add a destructive-confirmation modal and action visible only for eligible submitted vendor attempts.
- [ ] Refresh workbench, summary, timeline, mapping and production queries after success.
- [ ] Run focused FE tests plus lint/typecheck/build.
