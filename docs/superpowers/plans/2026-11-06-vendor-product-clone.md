# Vendor Product Clone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a safe BE/FE flow to clone a vendor product and its cost centers to a selected vendor.

**Architecture:** Keep the operation inside the vendor module. The service validates source/target,
creates the new product and child cost centers through repositories, records audit, and compensates
on child failure; the existing vendor products page calls one endpoint and refreshes after success.

**Tech Stack:** Node.js/CommonJS/Express/Mongoose/Jest; existing frontend stack and API client.

**Spec:** `docs/superpowers/specs/2026-11-06-vendor-product-clone-design.md`

## Global Constraints

- Respect vendor module boundaries and DTO responses.
- Never mutate the source product or its cost centers.
- Do not copy legacy/external identifiers.
- Do not add dependencies.
- Work on the current `develop` branches.

## Review Focus

- Same-vendor duplicate code must get a deterministic new code or a clear conflict.
- Cross-vendor clone must rewrite both vendor references on every child.
- A failed child insert must not leave an orphan product.
- Inactive source/target vendors must be rejected.
- FE must prevent duplicate submits and show the server error.

### Task 1: Backend clone endpoint

**Files:**
- Modify: `src/modules/vendor/validators/vendor.validator.js`
- Modify: `src/modules/vendor/repositories/vendorProduct.repository.js`
- Modify: `src/modules/vendor/repositories/vendorCostCenter.repository.js`
- Modify: `src/modules/vendor/services/vendor.service.js`
- Modify: `src/modules/vendor/controllers/vendor.controller.js`
- Modify: `src/modules/vendor/routes/index.js`
- Test: existing vendor service/controller test location discovered during implementation

- [ ] Write failing service tests for cross-vendor cloning, default code collision handling, and child failure cleanup.
- [ ] Run the focused tests and confirm they fail because clone is absent.
- [ ] Implement the smallest repository/service/controller/route changes using existing audit, error, DTO, and transaction patterns.
- [ ] Run focused backend tests, syntax checks, and architecture tests.

### Task 2: Frontend product action

**Files:**
- Modify: existing vendor products page/action/API files discovered in the FE repository
- Test: existing frontend test location discovered during implementation

- [ ] Write a failing test for opening clone UI with source defaults, selecting target vendor, and submitting once.
- [ ] Run the focused test and confirm the missing behavior.
- [ ] Add the clone action/modal using existing components and API conventions; refresh products on success.
- [ ] Run focused FE test/build/lint commands available in the repository.

### Task 3: Cross-repository verification

- [ ] Inspect both diffs for unrelated changes and contract drift.
- [ ] Run the affected backend and frontend suites plus required build/architecture checks.
- [ ] Record any existing unrelated failures explicitly.
