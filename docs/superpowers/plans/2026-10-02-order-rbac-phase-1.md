# Order RBAC Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Limit order actions to Sales roles while reserving fulfilment transitions for system administrators.

**Architecture:** Keep the approved global order scope. Add distinct permissions for assignment, customer-case decisions, and fulfilment transitions; route guards enforce them before existing service-level order access checks. A migration grants the new Sales Leader role to leaders of the live Sales teams (`SALE1`, `SALE2`, `KD`) without changing generic HR team-leader assignments.

**Tech Stack:** Express, Mongoose, Jest, existing Auth RBAC and Organization public port.

**Spec:** User-approved Order RBAC phase 1 in this conversation.

## Global Constraints

- Preserve `SUPER_ADMIN` access and Finance-owned refund confirmation.
- Do not introduce shop scope or modify order ownership data in this phase.
- Do not grant any direct Orders permission to Design roles.
- Do not remove unrelated existing assignments.

## Review Focus

- A Sales Operator must receive `403` for assign, cancel, replacement, and fulfilment actions.
- A Sales Leader must receive `403` for vendor submission and shipment actions.
- A read-only order user must not create a PSD request.
- Existing super-admin access must retain every newly introduced permission.
- The migration must only assign Sales Leader to leaders in `SALE1`, `SALE2`, and `KD`.

---

### Task 1: Order action permissions and HTTP guards

**Files:**
- Modify: `src/modules/auth/scripts/seedRbac.js`
- Modify: `src/modules/order/routes/index.js`
- Test: `tests/auth/scripts/seedRbac.test.js`
- Test: `tests/order/routes/index.test.js`

**Interfaces:**
- Produces: `ORDERS:ASSIGN`, `ORDERS:CASE_MANAGE`, and `ORDERS:FULFILL` permissions.

- [ ] Write failing route and seed tests for Sales Operator denial and Sales Leader access.
- [ ] Run the focused tests and confirm they fail because permissions/guards do not exist.
- [ ] Add the three permissions, role mappings, and route guards; move PSD request to write access.
- [ ] Re-run focused tests and confirm they pass.

### Task 2: Sales Leader role migration

**Files:**
- Modify: `src/modules/auth/constants/auth.constants.js`
- Create: `src/modules/auth/scripts/migrateSalesOrderRoles.js`
- Test: `tests/auth/scripts/migrateSalesOrderRoles.test.js`

**Interfaces:**
- Consumes: `roleCodes.SALES_LEADER` and `SALES_TEAM_CODES = ['SALE1', 'SALE2', 'KD']`.
- Produces: active global `SALES_LEADER` assignments for active leaders in those teams.

- [ ] Write a failing migration-plan test for Sales leaders only.
- [ ] Run it and confirm failure because the role/script is absent.
- [ ] Implement an idempotent dry-run/apply migration using Organization's public role-assignment source.
- [ ] Run the migration test and a database dry-run.

### Task 3: Verification and live role update

**Files:**
- Verify: changed order route/RBAC/migration tests and architecture contract.

- [ ] Apply the migration to `lng_web_be` after a dry-run reports the exact target count.
- [ ] Run syntax, focused tests, architecture tests, and the full test suite.
