# Safe Vendor Submission Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically submit QC-passed production work to the correctly mapped vendor without credential crossover, fabricated customer data, duplicate remote orders, or stuck Production state, then expose a safe operations workbench.

**Architecture:** Keep the existing modular-monolith public ports. Extend Vendor Submission with conditional repository transitions and a small state machine; derive vendor identity and provider from the persisted snapshot, pass vendor-scoped credentials into adapters, and treat ambiguous transport outcomes as reconciliation work rather than retryable failures. Build the FE only after all BE safety and architecture tests pass.

**Tech Stack:** Node.js, Express, MongoDB/Mongoose, Joi, Jest; React, TypeScript, Ant Design, TanStack Query, Vitest.

## Global Constraints

- Do not add dependencies.
- Provider comes from `payloadSnapshot.vendorProduct.vendor.providerKey`; HTTP callers cannot choose it.
- Credential lookup requires both `vendorId` and `providerKey`.
- Never automatically repeat a POST after an ambiguous transport result.
- Never synthesize recipient identity, address, email, phone, or country data.
- Preserve shop-scoped `VENDOR_SUBMISSIONS:READ` and `VENDOR_SUBMISSIONS:WRITE` authorization.
- Keep provider payloads, credentials, and customer data out of audit records.
- FE work starts only after the full Vendor Submission and architecture suites pass.

---

### Task 1: Vendor-scoped provider and credentials

**Files:**
- Modify: `src/modules/vendor/repositories/vendorIntegrationConfig.repository.js`
- Modify: `src/modules/vendor/services/vendor.service.js`
- Modify: `src/modules/vendor/public.js`
- Modify: `src/modules/vendorSubmission/services/vendorSubmission.service.js`
- Modify: `src/modules/vendorSubmission/services/submitAdapters/merchize.adapter.js`
- Modify: `src/modules/vendorSubmission/services/submitAdapters/printway.adapter.js`
- Modify: `src/modules/vendorSubmission/services/submitAdapters/lenful.adapter.js`
- Test: `src/test/vendor/services/vendor.service.test.js`
- Test: `src/test/vendorSubmission/services/vendorSubmission.service.test.js`
- Test: `src/test/vendorSubmission/services/*SubmitAdapter.service.test.js`

**Interfaces:**
- Produces: `getVendorIntegrationCredential(vendorId, providerKey, options?)`
- Produces: adapter `submitPayload(payload, { credential, idempotencyKey })`
- Consumes: `payloadSnapshot.vendorProduct.vendor.id|_id|providerKey`

- [ ] Write failing tests proving two vendors sharing `MERCHIZE` receive their own credential and request provider overrides are rejected.
- [ ] Run the focused Vendor and Vendor Submission service tests and confirm the failures identify provider-only lookup and caller-controlled provider.
- [ ] Add repository lookup by `{ vendorId, providerKey }`, update the public credential signature, derive provider/vendor ID from the snapshot, and inject the credential into the selected adapter.
- [ ] Run the focused tests and confirm they pass.
- [ ] Commit with `fix(vendor-submission): scope provider credentials to vendor`.

### Task 2: Atomic submit state machine

**Files:**
- Modify: `src/modules/vendorSubmission/constants/vendorSubmission.constants.js`
- Modify: `src/modules/vendorSubmission/models/vendorSubmission.model.js`
- Modify: `src/modules/vendorSubmission/repositories/vendorSubmission.repository.js`
- Modify: `src/modules/vendorSubmission/services/vendorSubmission.service.js`
- Modify: `src/modules/vendorSubmission/dtos/vendorSubmission.dto.js`
- Modify: `src/modules/vendorSubmission/validators/vendorSubmission.validator.js`
- Test: `src/test/vendorSubmission/repositories/vendorSubmission.repository.test.js`
- Test: `src/test/vendorSubmission/services/vendorSubmission.service.test.js`
- Test: `src/test/vendorSubmission/dtos/vendorSubmission.dto.test.js`

**Interfaces:**
- Adds statuses: `SUBMITTING`, `NEEDS_REVIEW`
- Produces: `claimReadyForSubmit(id, { provider, operationKey, claimedAt })`
- Produces: `transitionStatus(id, fromStatuses, patch)` using one conditional `findOneAndUpdate`
- Persists: `submitOperationKey`, `submitClaimedAt`, `submitAttemptCount`

- [ ] Write failing repository tests proving only one of two READY claims succeeds and terminal states cannot be overwritten by stale writers.
- [ ] Write failing service tests proving the second concurrent submit never invokes an adapter and `ECONNRESET` transitions `SUBMITTING` to `NEEDS_REVIEW`.
- [ ] Run those tests and verify the expected failures.
- [ ] Add the two statuses and fields, conditional repository transitions, stable operation key `vendor-submission:<submissionId>`, and service transitions `READY → SUBMITTING → SUBMITTED|FAILED|NEEDS_REVIEW`.
- [ ] Ensure explicit provider rejections become `FAILED`; errors without a confirmed rejection become `NEEDS_REVIEW` and are not automatically POSTed again.
- [ ] Run repository, DTO, and service tests and confirm they pass.
- [ ] Commit with `fix(vendor-submission): make submit transitions atomic`.

### Task 3: Strict adapter payloads and stable remote order keys

**Files:**
- Modify: `src/modules/vendorSubmission/services/submitAdapters/merchize.adapter.js`
- Modify: `src/modules/vendorSubmission/services/submitAdapters/printway.adapter.js`
- Modify: `src/modules/vendorSubmission/services/submitAdapters/lenful.adapter.js`
- Test: `src/test/vendorSubmission/services/merchizeSubmitAdapter.service.test.js`
- Test: `src/test/vendorSubmission/services/printwaySubmitAdapter.service.test.js`
- Test: `src/test/vendorSubmission/services/lenfulSubmitAdapter.service.test.js`

**Interfaces:**
- Consumes: `{ credential, idempotencyKey }` from Task 1/2
- Produces provider payload order identifiers from `idempotencyKey`
- Throws `VALIDATION_ERROR` before `fetch` when required recipient or production fields are absent

- [ ] Write failing adapter tests proving missing names/address/country/provider-required contact data cannot become `Test`, `Buyer`, `order@example.com`, `1234567890`, or `United States`.
- [ ] Write failing tests proving the stable operation key is used as the provider order identifier and the injected credential is used for the request.
- [ ] Run all three adapter suites and verify the expected failures.
- [ ] Remove fake fallbacks, expand each provider's required-field validation, and use the stable remote order identifier without logging it in audit metadata.
- [ ] Run all adapter tests and confirm they pass.
- [ ] Commit with `fix(vendor-submission): reject incomplete provider payloads`.

### Task 4: Reconciliation and Production handoff recovery

**Files:**
- Modify: `src/modules/vendorSubmission/repositories/vendorSubmission.repository.js`
- Modify: `src/modules/vendorSubmission/services/vendorSubmission.service.js`
- Modify: `src/modules/vendorSubmission/controllers/vendorSubmission.controller.js`
- Modify: `src/modules/vendorSubmission/routes/index.js`
- Modify: `src/modules/vendorSubmission/validators/vendorSubmission.validator.js`
- Test: `src/test/vendorSubmission/services/vendorSubmission.service.test.js`
- Test: `src/test/vendorSubmission/routes/index.test.js`

**Interfaces:**
- Produces: `repairProductionHandoff(submission, authContext)`
- Produces: `reconcileSubmission(id, { outcome, vendorExternalOrderId?, reason? }, authContext)`
- Outcomes: `REMOTE_FOUND`, `REMOTE_NOT_FOUND`; only `REMOTE_NOT_FOUND` returns `NEEDS_REVIEW` to `READY`

- [ ] Write failing tests proving an already `SUBMITTED` submission retries `markSentToVendor` and does not POST again.
- [ ] Write failing route/service tests for reconciliation: remote found records `SUBMITTED`; confirmed absence returns `READY`; other statuses are rejected.
- [ ] Run focused tests and verify the expected failures.
- [ ] Centralize the idempotent Production handoff and call it both after successful submit and when loading/reconciling an already submitted record.
- [ ] Add the authenticated, shop-scoped reconciliation endpoint with Joi validation and safe audit metadata.
- [ ] Run route and service tests and confirm they pass.
- [ ] Commit with `fix(vendor-submission): recover ambiguous submissions and handoffs`.

### Task 5: Inclusive date filtering

**Files:**
- Modify: `src/modules/vendorSubmission/repositories/vendorSubmission.repository.js`
- Test: `src/test/vendorSubmission/repositories/vendorSubmission.repository.test.js`

**Interfaces:**
- Date-only `dateTo=YYYY-MM-DD` becomes `YYYY-MM-DDT23:59:59.999Z`; full timestamps remain unchanged.

- [ ] Write a failing repository test for a date-only upper bound.
- [ ] Run the repository test and confirm it receives midnight instead of end-of-day.
- [ ] Reuse the minimal date-only normalization pattern already used by External Order Import.
- [ ] Run the repository test and full Vendor Submission suite.
- [ ] Commit with `fix(vendor-submission): include full end date in filters`.

### Task 6: Safe automatic dispatch after QC

**Files:**
- Modify: `src/modules/vendorSubmission/public.js`
- Modify: `src/modules/vendorSubmission/services/vendorSubmission.service.js`
- Modify: `src/modules/production/services/productionTask.service.js`
- Test: `src/test/vendorSubmission/services/vendorSubmission.service.test.js`
- Test: `src/test/production/services/productionTask.service.test.js`

**Interfaces:**
- Produces: `createAndSubmitFromProductionTask(productionTaskId, authContext)`
- Production calls the public port only after its QC mutation commits.

- [ ] Write failing tests proving QC pass creates and submits a valid mapped task automatically.
- [ ] Write failing tests proving invalid payload/credential failures do not roll back QC and leave an actionable `FAILED`, while ambiguous network outcomes leave `NEEDS_REVIEW`.
- [ ] Run the focused tests and verify the expected failures.
- [ ] Replace the create-only trigger with the public create-and-submit operation; retain the current logged isolation so QC remains committed when handoff fails.
- [ ] Run Production, Vendor Submission, and architecture suites.
- [ ] Commit with `feat(vendor-submission): auto-submit qc-passed tasks safely`.

### Task 7: Backend release gate and contract documentation

**Files:**
- Modify: `docs/vendorSubmission/VENDOR_SUBMISSION_API.md`
- Modify: `docs/vendorSubmission/VENDOR_SUBMISSION_MODULE_GUIDE.md`

**Interfaces:**
- Documents status machine, derived provider, reconciliation endpoint, automatic QC flow, and no-blind-retry rule.

- [ ] Update the API examples and state transition table without exposing credentials or full customer payloads.
- [ ] Run `npm test -- --runInBand src/test/vendorSubmission src/test/production`.
- [ ] Run `npm run test:architecture` and `git diff --check`.
- [ ] Do not begin FE if any command fails.
- [ ] Commit with `docs(vendor-submission): document safe automatic workflow`.

### Task 8: FE API, routing, and RBAC foundation

**Files:**
- Create: `src/features/portal/vendor-submissions/api/vendorSubmissionApi.ts`
- Create: `src/features/portal/vendor-submissions/api/vendorSubmissionKeys.ts`
- Create: `src/features/portal/vendor-submissions/auth/vendorSubmissionAccess.ts`
- Modify: `src/app/router/router.tsx`
- Modify: `src/app/layout/appNavigation.ts`
- Test: `src/test/portal/vendor-submissions/api/vendorSubmissionApi.test.ts`
- Test: `src/test/app/router/PortalVendorSubmissionRoute.test.tsx`
- Test: `src/test/app/layout/appNavigation.test.ts`

**Interfaces:**
- Typed list, summary, detail, preview, dry-run, real-submit, retry, cancel, and reconcile functions.
- Route: `/portal/vendor-submissions`

- [ ] Write failing API contract and route/navigation RBAC tests, including scoped READ visibility and WRITE action checks.
- [ ] Run focused tests and verify missing module/route failures.
- [ ] Add the shared-client API layer, stable query keys, scope-aware access helpers, lazy route, and navigation entry.
- [ ] Run focused tests and confirm they pass.
- [ ] Commit with `feat(vendor-submission): add frontend contract and route`.

### Task 9: FE operations workbench

**Files:**
- Create: `src/features/portal/vendor-submissions/pages/VendorSubmissionWorkbenchPage.tsx`
- Create: `src/features/portal/vendor-submissions/pages/VendorSubmissionWorkbenchPage.module.scss`
- Create: `src/features/portal/vendor-submissions/pages/VendorSubmissionDetailDrawer.tsx`
- Create: `src/features/portal/vendor-submissions/pages/VendorSubmissionActionModal.tsx`
- Test: `src/test/portal/vendor-submissions/pages/VendorSubmissionWorkbenchPage.test.tsx`
- Test: `src/test/portal/vendor-submissions/pages/VendorSubmissionDetailDrawer.test.tsx`

**Interfaces:**
- Consumes Task 8 API/access helpers.
- Displays provider as read-only; actions follow backend status and exact shop WRITE scope.

- [ ] Write failing tests for summary/filter pagination, sanitized detail preview, loading/empty/error states, and hidden write actions for readers.
- [ ] Write failing tests for dry-run preview, confirmed real submit, retry, cancel, reconciliation, conflict refresh, and cache invalidation.
- [ ] Run focused tests and verify missing component behavior.
- [ ] Build the dense Ant Design workbench using existing shared table, filter, drawer, modal, status, feedback, and date-range components.
- [ ] Run the Vendor Submission FE tests and confirm they pass.
- [ ] Commit with `feat(vendor-submission): add operations workbench`.

### Task 10: Final verification

**Files:**
- No production changes unless verification exposes a regression.

- [ ] In BE run `npm test -- --runInBand src/test/vendorSubmission src/test/production`.
- [ ] In BE run `npm run test:architecture` and `git diff --check`.
- [ ] In FE run `npx vitest run src/test/portal/vendor-submissions src/test/app/router/PortalVendorSubmissionRoute.test.tsx src/test/app/layout/appNavigation.test.ts`.
- [ ] In FE run `npm run lint`, `npm run build`, and `git diff --check`.
- [ ] Review `git status --short` in both worktrees and keep unrelated user changes outside commits.
