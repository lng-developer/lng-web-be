# Merchize Retry Order ID Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let retried Merchize submissions use a stable `-R<n>` external order reference and let tracking use that same reference.

**Architecture:** The Merchize adapter selects a persisted retry reference when present. The vendor-submission service writes that reference after it claims the next submit attempt, using its durable attempt counter. The shipment tracking identity carries the persisted vendor reference separately from LNG's immutable marketplace order ID.

**Tech Stack:** Node.js, Express CommonJS, Mongoose, Jest.

**Spec:** `docs/superpowers/specs/2026-11-20-merchize-retry-order-id-design.md`

## Global Constraints

- Keep marketplace order IDs unchanged internally.
- Use `-R<n>` only for Merchize attempts after attempt 1.
- Do not add dependencies or a schema migration.
- Preserve tracking lookup against the exact external number submitted to Merchize.

## Review Focus

- First Merchize attempt must retain the base external order ID — test in Task 1.
- A retry must use `-R2`, not mutate the internal order ID — test in Task 1.
- Non-Merchize adapters must remain untouched — test the provider guard in Task 2.
- A retry reference must be persisted before the outbound request — test in Task 2.
- Tracking must receive the persisted retry reference — test in Task 3.

---

### Task 1: Merchize payload retry reference

**Files:**
- Modify: `src/modules/vendorSubmission/services/submitAdapters/merchize.adapter.js`
- Test: `tests/vendorSubmission/services/merchizeSubmitAdapter.service.test.js`

**Interfaces:**
- Produces: `buildPayload(submission)` prefers `payloadSnapshot.merchizeExternalOrderId` over the marketplace external order ID.

- [ ] Add a failing adapter test for a snapshot with `merchizeExternalOrderId: '113-TEST-ORDER-R2'`.
- [ ] Run the focused test and confirm the payload still uses the base ID before implementation.
- [ ] Make `buildPayload` use the persisted Merchize reference when supplied.
- [ ] Run `npm test -- tests/vendorSubmission/services/merchizeSubmitAdapter.service.test.js --runInBand`.

### Task 2: Persist reference for submitted retry attempts

**Files:**
- Modify: `src/modules/vendorSubmission/services/vendorSubmission.service.js`
- Test: `tests/vendorSubmission/services/vendorSubmission.service.test.js`

**Interfaces:**
- Consumes: claimed `submitAttemptCount` and adapter provider.
- Produces: `payloadSnapshot.merchizeExternalOrderId` equal to base ID for attempt 1 or base ID plus `-R<attempt>` later.

- [ ] Add failing service tests for attempt 1, attempt 2, and a non-Merchize provider.
- [ ] Run the focused tests and confirm attempt 2 lacks persisted reference before implementation.
- [ ] Persist the reference immediately after claiming a Merchize submission and before building the payload.
- [ ] Run `npm test -- tests/vendorSubmission/services/vendorSubmission.service.test.js --runInBand`.

### Task 3: Tracking retry reference handoff

**Files:**
- Modify: `src/modules/vendorSubmission/dtos/vendorSubmission.dto.js`, `src/modules/shipment/services/shipment.service.js`
- Test: relevant shipment service test.

**Interfaces:**
- Produces: a vendor submission DTO property that carries `merchizeExternalOrderId`; tracking supplies it as `orderExternalOrderId` to the adapter.

- [ ] Add a failing tracking identity test for a persisted retry reference.
- [ ] Implement the smallest DTO and identity change.
- [ ] Run the focused shipment test.

### Task 4: Verify and release hotfix

**Files:**
- Verify: changed files and relevant Jest suites.

- [ ] Run syntax checks and relevant Jest suites.
- [ ] Inspect diff for secret-free, provider-scoped changes.
- [ ] Commit with `fix(vendor-submission): use retry suffix for Merchize order IDs`.
- [ ] Deploy the tested commit, mark the rejected submission failed with the documented reason, retry it, and verify the new Merchize external number ends in `-R2`.
