# Operating Cost Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to execute this plan task-by-task.

**Goal:** Replace fixed seller operating cost with audited, date-effective seller rules configurable by finance writers.

**Architecture:** Finance owns a small rule collection keyed by seller employee code. Report calculations resolve the rule effective on each report day; the UI manages rules through Finance APIs. `FINANCE:WRITE` authorizes mutations and no new RBAC permission is introduced.

**Tech Stack:** Express, Mongoose, Joi, React, TanStack Query, Ant Design.

## Global Constraints

- Rules are USD minor-unit amounts and use inclusive `effectiveFrom` / `effectiveTo` calendar days.
- Report reads remain read-only; every rule mutation creates an audit event.
- Do not retain fixed operating-cost or SALES-team eligibility in seller reports.

### Task 1: Finance rule CRUD and audit

**Files:** model, repository, service, DTO, validator, controller, routes, public port, focused tests.

- [ ] Write failing service and route tests for `FINANCE:WRITE`, date overlap validation, and audit.
- [ ] Add `OperatingCostRule` with seller employee code, USD amount, effective dates, active flag, and index.
- [ ] Add list/upsert endpoints under `/api/finance/operating-cost-rules`.
- [ ] Verify focused finance tests.

### Task 2: Date-effective report calculation

**Files:** finance snapshot service and focused tests.

- [ ] Write failing tests for a seller rule ending 18/8 and no cost from 19/8.
- [ ] Resolve each seller-day cost from its effective rule; aggregate seller cost from the same daily rows.
- [ ] Verify finance and report tests.

### Task 3: Finance configuration UI

**Files:** finance API, Finance workspace settings section, translations, focused UI tests.

- [ ] Write failing UI test for finance writer rule editor visibility.
- [ ] Add a compact effective-date rule table and edit form.
- [ ] Verify UI tests and typecheck.
