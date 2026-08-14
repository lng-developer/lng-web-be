# Customer Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a lightweight Customer module that projects buyer data from orders into customer profiles, care status, notes, timeline, summary, and a FE customer workspace.

**Architecture:** Backend owns customer state in `src/modules/customer` and exposes `/api/customers`. Order remains the source for order facts; customer projection consumes safe snapshots and never imports order internals. Frontend adds a customer API client, route, navigation item, and list-first workspace.

**Tech Stack:** Node.js, Express, Mongoose, Joi, Jest, React, TypeScript, Ant Design, TanStack Query.

## Global Constraints

- Do not expose unmasked PII.
- Do not import another module's internal models/services/controllers.
- Customer phase 1 is operational CRM only: no campaigns, loyalty, or marketing automation.
- Backfill must support dry-run and must not run against production without explicit approval.

---

### Task 1: Backend Customer Core

**Files:**
- Create `src/modules/customer/models/customer.model.js`
- Create `src/modules/customer/models/customerEvent.model.js`
- Create `src/modules/customer/models/customerNote.model.js`
- Create `src/modules/customer/repositories/customer.repository.js`
- Create `src/modules/customer/dtos/customer.dto.js`
- Create `src/modules/customer/services/customerProjection.service.js`
- Create `src/modules/customer/services/customer.service.js`
- Create `src/modules/customer/public.js`
- Create `src/modules/customer/index.js`
- Test `tests/customer/customerProjection.service.test.js`

**Interfaces:**
- Produces `upsertFromOrderSnapshot(snapshot)`
- Produces `listCustomers(params)`, `getSummary(params)`, `getCustomerById(id)`, `listTimeline(customerId, params)`

- [ ] Write projection tests for identity derivation, idempotent order upsert, lifecycle transitions, and address issue flag.
- [ ] Implement models and indexes.
- [ ] Implement repository functions.
- [ ] Implement DTO shaping.
- [ ] Implement projection and read services.
- [ ] Run `npx jest tests/customer/customerProjection.service.test.js --runInBand`.

### Task 2: Backend Routes And Permissions

**Files:**
- Create `src/modules/customer/controllers/customer.controller.js`
- Create `src/modules/customer/controllers/customerNote.controller.js`
- Create `src/modules/customer/routes/index.js`
- Create `src/modules/customer/validators/customer.validator.js`
- Modify `src/app.js`
- Modify auth permission catalog seed/constants where current permissions are declared
- Test `tests/customer/customer.routes.test.js`

**Interfaces:**
- Consumes service functions from Task 1.
- Produces REST endpoints `/api/customers`, `/api/customers/summary`, `/api/customers/:id`, `/api/customers/:id/timeline`, `/api/customers/:id/notes`, `/api/customers/:id/care-status`.

- [ ] Add `CUSTOMERS:READ`, `CUSTOMERS:WRITE`, `CUSTOMERS:MANAGE`.
- [ ] Add authenticated/authorized routes.
- [ ] Add controller validation and DTO responses.
- [ ] Add notes and care-status mutations.
- [ ] Mount `/api/customers`.
- [ ] Run `node -c` on changed backend JS files.
- [ ] Run customer route tests.

### Task 3: Order Projection Hook

**Files:**
- Modify order import/update service at the point where normalized orders are persisted.
- Create a small order-to-customer snapshot mapper inside the order module.
- Test focused order/customer projection integration.

**Interfaces:**
- Consumes `customer.public.upsertFromOrderSnapshot(snapshot)`.
- Produces customer updates after order import without importing customer internals.

- [ ] Locate the single normalized order import success path.
- [ ] Build safe customer snapshot from order DTO/document data.
- [ ] Call customer public port after order save.
- [ ] Make projection non-fatal: log failure but do not fail order import.
- [ ] Run focused order import/customer projection test.

### Task 4: Frontend Customer API And Route

**Files:**
- Create `src/features/portal/customers/api/customerApi.ts`
- Create `src/features/portal/customers/api/customerKeys.ts`
- Modify `src/app/layout/appNavigation.ts`
- Modify `src/app/router/router.tsx`
- Modify locale files for navigation label.

**Interfaces:**
- Produces typed FE API functions and `/portal/customers` route.

- [ ] Add API types/functions for list, summary, detail, timeline, notes, and care status.
- [ ] Add navigation item behind `CUSTOMERS:READ`.
- [ ] Add lazy route with `PortalPageBoundary`.
- [ ] Run `npm run typecheck`.

### Task 5: Frontend Customer Workspace

**Files:**
- Create `src/features/portal/customers/pages/CustomerWorkspacePage.tsx`
- Create `src/features/portal/customers/pages/CustomerWorkspacePage.module.scss`

**Interfaces:**
- Consumes customer API from Task 4.
- Produces list-first customer UI with KPI row, filters, table, and detail drawer.

- [ ] Build KPI summary row.
- [ ] Build filter bar and table.
- [ ] Build detail drawer with profile, stats, timeline, and notes.
- [ ] Add care status mutation for users with `CUSTOMERS:WRITE`.
- [ ] Run `npm run typecheck`.
- [ ] Run `npm run build`.

### Task 6: Dashboard Integration

**Files:**
- Modify `src/features/foundation/OperationsDashboardPage.tsx`

**Interfaces:**
- Consumes customer summary API.
- Replaces mock/new customer metric with real customer summary when `CUSTOMERS:READ` is available.

- [ ] Add customer summary query.
- [ ] Show new/returning/needs-follow-up in header cards.
- [ ] Keep fallback behavior when permission is missing.
- [ ] Run `npm run typecheck` and `npm run build`.
