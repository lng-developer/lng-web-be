# Vendor Migration Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let authorized users review and bulk-map legacy products that were withheld from import because they lack a Product Type Group.

**Architecture:** Store unresolved source products in a vendor-owned Mongo staging model. The vendor controller validates HTTP input, the service owns active group checks and auditing, and the repository owns Mongoose queries. The CSV importer synchronizes review rows without creating production products.

**Tech Stack:** Node.js, Express, Mongoose, Joi, Jest.

**Spec:** `docs/superpowers/specs/2026-08-21-vendor-migration-review-design.md`

## Global Constraints

- Keep staging separate from `VendorProduct`; no migration API writes production vendor products or variants.
- Require `VENDORS:READ` for review and `VENDORS:WRITE` for assignment.
- Use catalog public port for Product Type Group validation.
- Validate all request input and use lean reads.

---

### Task 1: Add staged review persistence

**Files:**
- Create: `src/modules/vendor/models/vendorMigrationReview.model.js`
- Create: `src/modules/vendor/repositories/vendorMigrationReview.repository.js`
- Test: `tests/vendor/repositories/vendorMigrationReview.repository.test.js`

- [ ] Write repository tests for paginated pending rows and bulk assignment by legacy ID.
- [ ] Run the repository test and confirm it fails because the repository is absent.
- [ ] Add the smallest model and repository with a unique `legacyProductId`, lean list, pending count, upsert, and bulk update.
- [ ] Run the repository test and confirm it passes.

### Task 2: Add review HTTP API

**Files:**
- Modify: `src/modules/vendor/validators/vendor.validator.js`
- Modify: `src/modules/vendor/controllers/vendor.controller.js`
- Modify: `src/modules/vendor/services/vendor.service.js`
- Modify: `src/modules/vendor/routes/index.js`
- Test: `tests/vendor/routes/index.test.js`

- [ ] Write route tests for permission checks, request validation, and controller delegation.
- [ ] Run the route test and confirm it fails because migration handlers are absent.
- [ ] Add the validators, controller handlers, service methods, and routes before parameterized `/:id` routes.
- [ ] Run the route test and confirm it passes.

### Task 3: Stage review rows from the technical template

**Files:**
- Modify: `src/modules/vendor/scripts/importVendorTemplate.js`
- Test: `tests/vendor/scripts/importVendorTemplate.test.js`

- [ ] Write a failing importer test for synchronizing `MERGE_REVIEW` rows while preserving the no-production-import rule.
- [ ] Run the focused importer test and confirm it fails.
- [ ] Add an explicit staging call only for non-dry-run technical imports.
- [ ] Run focused vendor migration tests and `git diff --check`.
