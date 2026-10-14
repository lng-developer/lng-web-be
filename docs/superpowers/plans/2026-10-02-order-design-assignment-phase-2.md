# Order And Design Assignment Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict Sales and Design work to assigned records while giving each team leader a complete assignment queue.

**Architecture:** Sales ownership reuses `Order.assignedStaffIds`; Order access becomes order-level, so a scoped Sales member cannot read or mutate another member's Order. The Design module gains an order-linked `DesignRequest` aggregate and public port. Orders creates requests through that port; Design owns listing, assignment, status transitions, and team validation.

**Tech Stack:** Node.js, Express, Mongoose, Joi, Jest, existing Auth/Organization public ports.

**Spec:** `docs/superpowers/specs/2026-10-02-order-design-assignment-phase-2-design.md`

## Global Constraints

- Do not add `ownerTeamId` or shop scope to `Order`.
- Keep all cross-module interactions behind public ports.
- Use `.lean()` for read-only Mongoose queries and DTOs for API responses.
- No UI-only authorization; service-level reads, writes, and assignee checks are mandatory.
- Migration is dry-run-first, idempotent, and must not fabricate historical Design Requests.
- Existing unassigned Orders remain leader/admin queue work until assigned.

## Review Focus

- An `OWN` scoped Sales account must get `403` for direct-ID reads/mutations of an Order assigned to someone else; cover in Task 2.
- An unassigned Order must be invisible to Sales members but visible to Sales Leader; cover list, workbench, and detail in Task 2.
- A Sales Leader must be unable to assign an active non-Sales account; cover in Task 2.
- A duplicate PSD request for one Order Item/type must return the active Design Request, not create a second record; cover in Task 3.
- A Designer must be unable to read or transition another Designer's request, including through a direct request ID; cover in Task 4.

---

### Task 1: Role policy and assignment migration

**Files:**
- Modify: `src/modules/auth/constants/auth.constants.js`
- Modify: `src/modules/auth/scripts/seedRbac.js`
- Create: `src/modules/auth/scripts/migrateOrderDesignAssignments.js`
- Modify: `tests/auth/scripts/seedRbac.test.js`
- Create: `tests/auth/scripts/migrateOrderDesignAssignments.test.js`

**Interfaces:**
- Produces `roleCodes.DESIGN_LEADER` and permissions `DESIGN:REQUEST_READ`, `DESIGN:REQUEST_ASSIGN`, `DESIGN:REQUEST_WORK`.
- Produces `migrateOrderDesignAssignments({ apply })`, which reports proposed/created/kept assignment records and invalidates affected account permission caches.

- [ ] Write failing seed tests asserting `DESIGN_LEADER` has request read/assign/work, `DESIGNER` has request read/work, and generic `LEADER` has no Design workflow permissions.
- [ ] Write failing migration-plan tests with one active Sales member, Sales leader, Design member, Design leader, and an unrelated team member; assert only the four intended account-role targets are planned.
- [ ] Run `npx jest tests/auth/scripts/seedRbac.test.js tests/auth/scripts/migrateOrderDesignAssignments.test.js --runInBand` and confirm failures for the missing role/plan.
- [ ] Add the role/permission mapping. Preserve `SALES_LEADER` global assignment; use `OWN` scope for Sales member Order permissions and Design member request permissions.
- [ ] Implement `migrateOrderDesignAssignments()` using `organization.public.listRoleAssignmentSource()`, `AccessAssignment`, and `authManager.invalidatePermissionCache()`. Limit current-team matching to active `SALE1` and `DES`; update/reuse matching assignments without deleting unrelated assignments.
- [ ] Re-run the focused tests; expected: PASS.

### Task 2: Sales Order ownership enforcement

**Files:**
- Modify: `src/modules/order/services/orderAccess.service.js`
- Modify: `src/modules/order/services/orderQuery.service.js`
- Modify: `src/modules/order/services/orderAssignment.service.js`
- Modify: `src/modules/order/services/orderAddressValidation.service.js`
- Modify: `src/modules/order/services/orderCase.service.js`
- Modify: `src/modules/order/services/orderItemCancel.service.js`
- Modify: `src/modules/order/services/orderItemRecheck.service.js`
- Modify: `src/modules/order/services/orderOperations.service.js`
- Modify: `src/modules/order/services/orderReadiness.service.js`
- Modify: `src/modules/order/services/orderReplacement.service.js`
- Modify: `tests/order/services/orderAccess.service.test.js`
- Modify: `tests/order/services/orderQuery.service.test.js`
- Modify: `tests/order/services/orderAssignment.service.test.js`

**Interfaces:**
- Produces `orderAccess.canWriteOrder(order, authContext)` and `orderAccess.assertCanWriteOrder(order, authContext)`.
- Extends `orderAccess.getOrderReadConstraint(authContext)` to return the own-assignment constraint for `OWN` scoped Order access.
- `orderAssignmentService.assignStaff(orderId, assignedStaffIds, authContext)` rejects assignees outside active Sales team membership.

- [ ] Write failing access tests for global leader/admin access, assigned own-scope member access, different-member denial, and unassigned denial.
- [ ] Write failing query tests asserting list, workbench/projection, summary, and direct detail apply the same `assignedStaffIds` restriction for own scope.
- [ ] Write failing assignment tests asserting Sales Leader can assign only active `SALE1` members and gets validation/forbidden for a non-Sales account.
- [ ] Run the three focused service tests and confirm they fail because writes remain shop-based and assignment accepts any active account.
- [ ] Implement the shared Order-level read/write checks. Replace every listed `assertCanWriteShop()` call with `assertCanWriteOrder()` after loading the canonical Order; retain global/admin behavior.
- [ ] Use Organization public-port data inside `orderAssignment.service` for Sales-member assignee validation; do not import Organization repositories/models.
- [ ] Re-run focused service tests and `npx jest tests/order/routes/index.test.js --runInBand`; expected: PASS.

### Task 3: Order-linked Design Request aggregate and public port

**Files:**
- Create: `src/modules/design/models/designRequest.model.js`
- Create: `src/modules/design/repositories/designRequest.repository.js`
- Create: `src/modules/design/dtos/designRequest.dto.js`
- Create: `src/modules/design/services/designRequest.service.js`
- Modify: `src/modules/design/constants/design.constants.js`
- Modify: `src/modules/design/public.js`
- Create: `tests/design/models/designRequest.model.test.js`
- Create: `tests/design/repositories/designRequest.repository.test.js`
- Create: `tests/design/services/designRequest.service.test.js`

**Interfaces:**
- `design.public.createOrderDesignRequest(payload, authContext)` returns an order-linked Design Request DTO.
- `designRequestService.createOrderDesignRequest({ orderId, orderItemId, shopId, requestedByAccountId, note, listingSnapshot }, authContext)` creates or returns an active `PSD_TEMPLATE` request.
- Active statuses: `PENDING_ASSIGNMENT`, `ASSIGNED`, `IN_PROGRESS`; terminal statuses: `COMPLETED`, `CANCELLED`.

- [ ] Write a failing model/index test for the partial unique active-request key `{ orderItemId, requestType }`.
- [ ] Write a failing service test: identical active request inputs return the existing DTO; once terminal, a new request can be created.
- [ ] Write failing service tests for persisted safe snapshots and no raw Order/customization payload fields in the DTO.
- [ ] Run focused Design Request tests and confirm they fail because the aggregate/public port is absent.
- [ ] Implement constants, schema/index, repository, DTO, service, and public-port entry. Handle duplicate-key races by retrieving the active record and returning it.
- [ ] Re-run focused Design Request tests; expected: PASS.

### Task 4: Design queue endpoints and ownership checks

**Files:**
- Create: `src/modules/design/controllers/designRequest.controller.js`
- Create: `src/modules/design/validators/designRequest.validator.js`
- Modify: `src/modules/design/routes/index.js`
- Modify: `src/modules/design/services/designRequest.service.js`
- Modify: `tests/design/routes/index.test.js`
- Modify: `tests/design/services/designRequest.service.test.js`

**Interfaces:**
- `GET /api/design/requests` returns own assigned requests for `DESIGNER`; it returns all `DES` requests to `DESIGN_LEADER`/admin.
- `PATCH /api/design/requests/:requestId/assignment` accepts `{ assignedDesignerAccountId }` for Design Leader/admin.
- `PATCH /api/design/requests/:requestId/status` accepts `{ status }` and permits only assigned Designer or Design Leader/admin under the specified state graph.

- [ ] Write failing route/service tests for Designer own-only list/detail/status, Design Leader full queue/assignment, and direct-ID denial for another Designer's request.
- [ ] Add failing test that assignment rejects a non-Design or inactive account using Organization public-port membership data.
- [ ] Run focused Design route/service tests and confirm they fail because routes and authorization do not exist.
- [ ] Implement validators, controller DTO responses, and routes using permission guards; keep service ownership checks authoritative.
- [ ] Implement the exact state graph: `PENDING_ASSIGNMENT -> ASSIGNED`, `ASSIGNED -> IN_PROGRESS | CANCELLED`, `IN_PROGRESS -> COMPLETED | CANCELLED`; leader/admin can assign/reassign before completion.
- [ ] Re-run focused tests; expected: PASS.

### Task 5: Convert Order PSD request to the Design Request public contract

**Files:**
- Modify: `src/modules/order/services/orderDesignRequest.service.js`
- Modify: `src/modules/order/controllers/order.controller.js`
- Modify: `src/modules/order/dtos/order.dto.js` only if the existing response mapper needs the request DTO shape
- Modify: `tests/order/services/orderDesignRequest.service.test.js`
- Modify: `tests/order/routes/index.test.js`

**Interfaces:**
- `requestPsdForOrderItem(orderItemId, { note }, authContext)` calls `design.public.createOrderDesignRequest()` after `assertCanWriteOrder(order, authContext)` and returns its request DTO.
- Order audit metadata includes `designRequestId` and no raw request payload.

- [ ] Write failing service test for an assigned Sales member creating a Design Request and for an unassigned/different-member Sales account receiving `403`.
- [ ] Write failing test proving the service calls only Design/Mapping public ports, not a Design model/repository.
- [ ] Update the existing route test to assert the stable `{ note? }` request body and response with `id`, `status`, and `orderItemId`.
- [ ] Run focused Order Design Request tests and confirm failure because the endpoint still creates a shared listing-variant task.
- [ ] Replace the direct template-task call with the Design public-port request call; preserve mapping prerequisite and audit evidence.
- [ ] Re-run focused tests; expected: PASS.

### Task 6: Database dry-run, apply, and regression verification

**Files:**
- Verify: all files above

**Interfaces:**
- Consumes migration script and role seed from Task 1.
- Produces verified active `OWN` Sales/Design member assignments and global Sales/Design leader assignments in `lng_web_be`.

- [ ] Run syntax checks on every changed JavaScript file.
- [ ] Run focused Auth, Order, Design, Organization, and architecture suites; record existing unrelated failures separately rather than masking them.
- [ ] Read the target database name from `.env` without printing the connection string; run `node src/modules/auth/scripts/migrateOrderDesignAssignments.js` and review target counts.
- [ ] After counts are expected, run `node src/modules/auth/scripts/seedRbac.js` and `node src/modules/auth/scripts/migrateOrderDesignAssignments.js --apply`.
- [ ] Re-run migration dry-run; expected: zero pending creates/updates and retained assignments reported.
- [ ] Restart local backend only if it is not running under a file-watching process, then health-check it and manually verify Sales member, Sales Leader, Designer, and Design Leader API responses.
