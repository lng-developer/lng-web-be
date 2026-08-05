# External Order Raw Retention Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expire external order raw records 90 days after creation.

**Architecture:** Use MongoDB's native TTL index on the existing `createdAt` timestamp. No application scheduler or new dependency is needed.

**Tech Stack:** Node.js, Mongoose, Jest, MongoDB TTL indexes

## Global Constraints

- Retention is exactly 90 days (`7_776_000` seconds).
- Do not apply or sync indexes against Atlas in this task.
- Do not change import jobs or retry behavior.

---

### Task 1: Declare and verify the TTL index

**Files:**
- Modify: `src/modules/integration/externalOrderImport/models/externalOrderRawRecord.model.js`
- Create: `src/test/integration/externalOrderImport/models/externalOrderRawRecord.model.test.js`

**Interfaces:**
- Consumes: Mongoose schema timestamps and `Schema#index()`.
- Produces: TTL index `{ createdAt: 1 }` with `expireAfterSeconds: 7_776_000`.

- [ ] **Step 1: Write the failing schema test**

Assert that `ExternalOrderRawRecord.schema.indexes()` contains exactly the expected TTL definition.

- [ ] **Step 2: Verify RED**

Run `npx jest src/test/integration/externalOrderImport/models/externalOrderRawRecord.model.test.js --runInBand` and expect the TTL assertion to fail.

- [ ] **Step 3: Add the minimal index declaration**

Add `externalOrderRawRecordSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });` beside the existing schema indexes.

- [ ] **Step 4: Verify GREEN and architecture**

Run the focused Jest test, `node -c` for the model, and `npm run test:architecture -- --runInBand`.

