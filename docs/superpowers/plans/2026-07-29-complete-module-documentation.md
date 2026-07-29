# Complete Backend Module Documentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add code-grounded developer guides for every current backend module not already covered and link them from the documentation index.

**Architecture:** Read each module from its route/model/service/repository/public-port boundaries, then document only implemented behavior and known limitations. Existing API docs remain the request/response reference; new guides explain ownership, state, authorization, orchestration, and change checks.

**Tech Stack:** Node.js, Express, CommonJS, Mongoose, BullMQ/Redis where used, Joi, Jest, Markdown/Mermaid.

## Global Constraints

- Preserve strict modular-monolith imports through target-module `public.js`.
- Do not change production behavior, schemas, routes, seeds, or databases.
- Preserve unrelated dirty-tree changes.
- Verify each module with its narrow Jest suites, then run the architecture contract.
- Do not commit or push unless explicitly requested.

---

### Task 1: Audit And Notification Guides

**Files:**
- Create: `docs/audit/AUDIT_MODULE_GUIDE.md`
- Create: `docs/notification/NOTIFICATION_MODULE_GUIDE.md`

**Interfaces:**
- Consumes: current Audit/Notification routes, models, services, repositories, public ports, and tests.
- Produces: ownership, persistence, authorization, public-port, delivery/read-state, and change-check documentation.

- [ ] Inspect all Audit and Notification module source plus existing docs.
- [ ] Write both guides with exact current endpoints and limitations.
- [ ] Run `npm test -- --runInBand src/test/audit src/test/notification`.

### Task 2: Vendor And Vendor Submission Guides

**Files:**
- Create: `docs/vendor/VENDOR_MODULE_GUIDE.md`
- Create: `docs/vendorSubmission/VENDOR_SUBMISSION_MODULE_GUIDE.md`

**Interfaces:**
- Consumes: Vendor master-data/routing contracts and Vendor Submission lifecycle/adapters.
- Produces: guide coverage for vendor products, cost centers, submission snapshots, idempotency, transitions, and downstream shipment handoff.

- [ ] Inspect both module boundaries and existing API/runbook docs.
- [ ] Write both guides and correct only confirmed stale API statements.
- [ ] Run `npm test -- --runInBand src/test/vendor src/test/vendorSubmission`.

### Task 3: Production And Shipment Guides

**Files:**
- Create: `docs/production/PRODUCTION_MODULE_GUIDE.md`
- Create: `docs/shipment/SHIPMENT_MODULE_GUIDE.md`

**Interfaces:**
- Consumes: mapping/design readiness, Production task/file/QC state, Vendor Submission handoff, and Shipment tracking lifecycle.
- Produces: end-to-end operational state and authorization documentation.

- [ ] Inspect Production and Shipment source plus API docs.
- [ ] Write both guides with exact state transitions, blockers, side effects, and public ports.
- [ ] Run `npm test -- --runInBand src/test/production src/test/shipment`.

### Task 4: Finance And Report Guides

**Files:**
- Create: `docs/finance/FINANCE_MODULE_GUIDE.md`
- Create: `docs/report/REPORT_MODULE_GUIDE.md`

**Interfaces:**
- Consumes: Finance import/snapshot/recalculation contracts and Report read-model composition.
- Produces: source ownership, money semantics, idempotency, authorization, and reporting boundary documentation.

- [ ] Inspect Finance and Report source plus API docs.
- [ ] Write both guides with exact current calculation and read-model behavior.
- [ ] Run `npm test -- --runInBand src/test/finance src/test/report`.

### Task 5: Index And Full Verification

**Files:**
- Modify: `docs/README.md`

**Interfaces:**
- Consumes: all eight new module guides.
- Produces: a complete discoverable module documentation index.

- [ ] Add links under the existing module sections and add Notification if absent.
- [ ] Verify all Markdown links resolve.
- [ ] Run `npm run test:architecture -- --runInBand`.
- [ ] Run `git diff --check` and inspect scoped status/diffs.
