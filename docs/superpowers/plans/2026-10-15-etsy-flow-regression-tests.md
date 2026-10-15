# Etsy Flow Regression Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify the approved Etsy import, reimport, listing/PSD, production readiness, cancellation, and Amazon regression scenarios without operational writes or vendor submission.

**Architecture:** Use Jest and an ephemeral MongoMemoryReplSet for backend integration tests. Keep repositories and the domain public-port chain real; replace only external network/storage/queue boundaries with deterministic test adapters. Existing heavily mocked tests/e2e/orderFulfillmentFlow.e2e.test.js remains a service orchestration regression, not persistence proof.

**Tech Stack:** Existing Jest, Mongoose, mongodb-memory-server; no new dependencies.

**Spec:** Approved six-scenario scope in this conversation: import; idempotent reimport; listing through PSD approval; mapping/production; cancelled order; Amazon regression. Stop before real vendor submission. Browser/VM/Etsy live validation is a separate manual acceptance test.

## Global Constraints

- Never connect this suite to the configured operational database or load operational tokens.
- Connect only to the URI returned by the ephemeral replica set, with a generated test database name; cleanup only that test database.
- Do not mock repositories or cross-module public ports in the persistence flow.
- Do not send requests to Etsy, Smarty, cloud storage, SMTP, carriers, or vendors. Unexpected outbound requests must fail the suite.
- Preserve dirty work; no production behavior fixes, commits, or pushes without reporting the defect and obtaining direction.
- Do not recreate the recently undone PSD-request indicator changes.

## Review Focus

- Same order imported twice: one order/item/identity, preserved approved PSD and customization.
- Identical SKU with different Etsy listing IDs: separate correct links, no SKU-only misassociation.
- Variant PSD approval: no accidental approval/readiness for sibling variants.
- Cancellation followed by stale source data: cancelled item stays blocked at creation, handoff, and submission entrypoints.
- Amazon customization: Etsy-specific parsing/status logic must not discard Amazon inputs or assets.

### Task 1: Persistence harness and import/reimport coverage

**Files:** Create `tests/e2e/etsyOrderFlow.persistence.test.js` and `tests/e2e/helpers/etsyFlowFixture.js`.

**Interfaces:** Fixture creates synthetic shop/catalog/vendor/media/account inputs in ephemeral Mongo only. Test enters the existing Etsy mapper and external order import public contract, awaiting explicit processing rather than running schedulers.

- [ ] Read actual mapper/import signatures and required schemas before creating minimal synthetic fixtures.
- [ ] Start the ephemeral replica set, initialize required indexes, disable external workers and fail unexpected network calls. Assert the test connection database is not `lng_web_be` before cleanup.
- [ ] Import a synthetic Etsy order and read back order/item/customization/listing. Assert literal expected shop, external IDs, SKU, quantity, personalization, image linkage, and source status; assert auto-created listing is APPROVED while a manually created listing stays DRAFT.
- [ ] Import the same order again. Assert identical document IDs/counts and preserved customization/approved assets. Import another listing with the same SKU and a different listing ID and assert distinct identity linkage.
- [ ] Run `npx jest tests/e2e/etsyOrderFlow.persistence.test.js --runInBand`. Report discovered product defects without weakening assertions.

### Task 2: PSD and production-readiness integration

**Files:** Extend `tests/e2e/etsyOrderFlow.persistence.test.js` and its fixture.

**Interfaces:** Consume imported listing/item IDs from Task 1 fixtures. Use existing Catalog request and Design assign/submit/QC services with scoped synthetic auth; use existing mapping and production public ports.

- [ ] Request PSD twice and assert one active task. Read the task DTO and assert main listing image is available, including when image arrives after task creation.
- [ ] Assign, start, submit synthetic ready media, and approve via existing lifecycle commands. Assert task history and the correct listing/variant PSD asset reference after readback.
- [ ] Exercise two variants: approving one must not make the sibling ready. Confirm missing mapping/template/PSD blocks production; configured approved inputs produce a ready plan and the expected production task with personalization intact.
- [ ] Stop before vendor transmission; assert no external vendor call occurred.
- [ ] Run the new persistence suite plus `npx jest tests/design tests/catalog tests/mapping tests/production --runInBand` and distinguish infrastructure failures from product defects.

### Task 3: Cancellation, Amazon regression, and reusable command

**Files:** Extend the persistence suite; modify `package.json`; create `docs/testing/etsy-flow-regression.md`.

**Interfaces:** Reuse fixtures from Task 1. Add `npm run test:etsy-flow` targeting the new persistence suite and existing Etsy parser/status/image tests plus Amazon customization ZIP regression.

- [ ] Import/reimport a fully cancelled and refunded Etsy order, assert persisted cancellation/payment evidence, then assert production creation/handoff/vendor submission guards reject it with no outbound call.
- [ ] Reimport stale non-cancelled data and assert the item cannot resume production. A cancellation with existing production/vendor activity must require review, not silently cancel external work.
- [ ] Import an Amazon fixture with customization and assert parsed inputs and workbench projection survive; retain the existing ZIP-to-projection regression suite.
- [ ] Document the exact command, synthetic database safety, scenarios, external boundaries, and the remaining manual VM/browser checklist. Label this backend integration coverage, not live Etsy/browser E2E.
- [ ] Run `npm run test:etsy-flow`, architecture checks, and the broad test command. Record passing counts and each failed suite; do not claim full green from scoped runs.
- [ ] Inspect only the task diff and hand off results without commit/push.
