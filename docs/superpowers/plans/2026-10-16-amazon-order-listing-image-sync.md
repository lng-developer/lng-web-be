# Amazon Order Listing Image Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Queue one deduplicated Amazon main-listing image sync job after imported order items finish mapping.

**Architecture:** The final post-import mapping worker reads all imported raw records for its import job only after marking its own records complete. It invokes the integration public port only when every imported raw record is `COMPLETED` or `SKIPPED`; the port deduplicates ASINs, selects the newest online image-capable agent for that shop, and reuses the existing 25-item command dispatcher. The dispatcher only continues jobs already created by import; it no longer discovers or re-syncs listings on a seven-day schedule. Image enqueue failures are logged and never fail the import/mapping record.

**Tech Stack:** Node.js, MongoDB/Mongoose, BullMQ, Jest.

**Spec:** Existing listing image sync module and approved order-import flow in this task.

## Global Constraints

- Keep cross-module calls through `public.js`.
- Do not overwrite manual listing images or fail an order import because image sync cannot queue.
- One active image-sync job per shop; commands remain sequential batches of 25.
- BullMQ custom IDs must not contain `:`.

## Review Focus

- Multiple imported items with the same ASIN enqueue one listing candidate after the import job is complete.
- An offline or unsupported agent does not create a job or fail mapping.
- An active order import blocks image command dispatch.
- A manual image remains excluded by Catalog candidate filtering.
- Queue IDs stay valid for BullMQ.

### Task 1: Internal auto-enqueue API

**Files:**
- Modify: `src/modules/integration/listingImageSync/services/listingImageSync.service.js`
- Modify: `src/modules/integration/listingImageSync/public.js`
- Test: `tests/integration/listingImageSync.test.js`

- [x] Add a failing 100-ASIN integration test for automatic enqueue and a first command capped at 25 items.
- [x] Run the test and verify it fails because the public method is absent.
- [x] Add the smallest internal public method that returns null when no eligible agent/candidate/active-job conflict exists, otherwise creates then dispatches the job.
- [x] Run the image-sync tests.

### Task 2: Post-import hook and queue ID fix

**Files:**
- Modify: `src/modules/integration/externalOrderImport/services/postImportMappingProcessor.service.js`
- Modify: `src/modules/mapping/services/fulfillmentSideEffectQueue.service.js`
- Test: `tests/integration/externalOrderImport/workers/postImportMapping.worker.test.js`
- Test: `tests/mapping/services/fulfillmentSideEffectQueue.service.test.js`

- [x] Add failing tests proving a completed import job requests one deduplicated ASIN batch and a pending raw record blocks the request.
- [x] Run tests and verify the failures are caused by the old per-record hook.
- [x] Invoke the image-sync public port only after all imported raw records finish; log and continue on enqueue errors. Replace the queue ID delimiter.
- [x] Run narrow tests plus architecture test.

