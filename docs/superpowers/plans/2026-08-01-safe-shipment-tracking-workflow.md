# Safe Shipment And Tracking Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Secure Shipment creation, vendor webhook processing, and tracking polling with vendor-scoped credentials, idempotent state transitions, privacy-safe diagnostics, and a production-ready Shipment workbench.

**Architecture:** Vendor Submission remains the immutable source for vendor/provider/external-order identity. Shipment resolves credentials once, passes them into provider adapters, and funnels webhook, polling, and manual updates through one conditional `applyTrackingUpdate` service path. The frontend is implemented only after backend route, service, integration, and architecture gates pass.

**Tech Stack:** Node.js, Express, MongoDB, Mongoose, Joi, Jest; React 19, TypeScript, Ant Design, TanStack Query, Vitest.

## Global Constraints

- Work in BE `C:\lng_system\lng-web\lng-web-be\.worktrees\fe-refactor` and FE `C:\lng_system\lng-web\lng-web-fe\.worktrees\fe-refactor`.
- Preserve strict modular-monolith boundaries and use public ports for cross-module calls.
- Derive vendor, provider, and vendor external order ID from the persisted Vendor Submission.
- Never fall back to shared environment credentials in live tracking paths.
- Reject query-string webhook tokens and provider/submission mismatches before mutation.
- Missing or invalid tracking must never move Shipment or Order Item to `SHIPPED`.
- Do not persist raw webhook payloads, recipient PII, secrets, or authorization material.
- Keep batches bounded to 100 and defer distributed scheduler locking.
- Do not add frontend dependencies.
- Follow TDD: failing focused test, minimal implementation, focused green test.
- Do not commit after individual tasks. After all gates pass, create exactly one final implementation commit per repository because BE and FE have separate Git histories.

---

## File Map

### Backend

- `src/modules/shipment/services/shipmentIdentity.service.js`: derive and verify immutable vendor tracking identity from a Vendor Submission DTO.
- `src/modules/shipment/services/shipment.service.js`: orchestrate credential resolution, canonical tracking application, creation repair, polling, state transitions, and side effects.
- `src/modules/shipment/services/shipmentWebhook.service.js`: authenticate, normalize, resolve, and delegate webhook updates without owning transition rules.
- `src/modules/shipment/services/vendorWebhookVerifierRegistry.service.js`: select provider-specific webhook verifier.
- `src/modules/shipment/services/vendorWebhookVerifiers/sharedSecret.verifier.js`: constant-time provider-specific header verification for providers without native signatures.
- `src/modules/shipment/services/vendorTrackingAdapters/*.adapter.js`: normalize/fetch only; consume supplied credentials.
- `src/modules/shipment/services/vendorTrackingAdapters/requestJson.js`: explicit HTTP method and bounded response handling.
- `src/modules/shipment/repositories/shipment.repository.js`: conditional identity/tracking/status updates.
- `src/modules/shipment/models/vendorWebhookLog.model.js`: privacy-safe fields and 30-day TTL.
- `src/modules/shipment/repositories/vendorWebhookLog.repository.js`: date and Shop-scoped log queries.
- `src/modules/shipment/validators/shipment.validator.js`: match-only compatibility fields and date-only strings.
- `src/modules/shipment/controllers/shipment.controller.js`, `routes/index.js`, `public.js`: expose safe HTTP/public contracts.
- `src/modules/vendorSubmission/services/vendorSubmission.service.js`, `public.js`: trigger idempotent Shipment creation/repair after successful submission without reposting vendor orders.
- `docs/shipment/SHIPMENT_API.md`, `SHIPMENT_MODULE_GUIDE.md`, `docs/audit/AUDIT_EVENT_CATALOG.md`: document final contract.

### Frontend

- `src/features/portal/shipments/api/shipmentApi.ts`: typed Shipment, summary, webhook-log, and recheck API calls.
- `src/features/portal/shipments/api/shipmentKeys.ts`: query-key factory.
- `src/features/portal/shipments/auth/shipmentAccess.ts`: effective read/write permission helpers.
- `src/features/portal/shipments/pages/ShipmentWorkbenchPage.tsx`: queue, filters, summary, and actions.
- `src/features/portal/shipments/pages/ShipmentDetailDrawer.tsx`: safe tracking/status history and diagnostics.
- `src/features/portal/shipments/pages/ShipmentWorkbenchPage.module.scss`: responsive dense layout.
- `src/app/router/router.tsx`, `src/app/layout/appNavigation.ts`: route and navigation.
- `src/shared/i18n/locales/en/common.json`, `vi/common.json`: complete bilingual copy.

---

### Task 1: Lock Shipment Identity To Vendor Submission Snapshot

**Files:**
- Create: `src/modules/shipment/services/shipmentIdentity.service.js`
- Modify: `src/modules/shipment/services/shipment.service.js`
- Test: `src/test/shipment/services/shipmentIdentity.service.test.js`
- Test: `src/test/shipment/services/shipment.service.test.js`

**Interfaces:**
- Consumes: detailed Vendor Submission DTO from `vendorSubmission.public.getById(id)`.
- Produces: `deriveTrackingIdentity(submission)` returning `{ vendorId, provider, vendorExternalOrderId, shopId, orderId, orderItemId }` and `assertMatchingTrackingIdentity(identity, compatibilityInput)`.

- [ ] **Step 1: Write failing identity tests**

```js
expect(deriveTrackingIdentity(submission)).toEqual({
  vendorId,
  provider: 'MERCHIZE',
  vendorExternalOrderId: 'MZ-100',
  shopId,
  orderId,
  orderItemId,
});
expect(() => assertMatchingTrackingIdentity(identity, { provider: 'PRINTWAY' }))
  .toThrow(/provider does not match/i);
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- --runInBand src/test/shipment/services/shipmentIdentity.service.test.js`

Expected: FAIL because the identity service does not exist.

- [ ] **Step 3: Implement minimal identity derivation and mismatch validation**

```js
function deriveTrackingIdentity(submission = {}) {
  const vendor = submission.payloadSnapshot?.vendorProduct?.vendor || {};
  const identity = {
    vendorId: String(vendor.id || vendor._id || ''),
    provider: String(vendor.providerKey || submission.provider || '').trim().toUpperCase(),
    vendorExternalOrderId: String(submission.vendorExternalOrderId || '').trim(),
    shopId: String(submission.shopId || ''),
    orderId: String(submission.orderId || ''),
    orderItemId: String(submission.orderItemId || ''),
  };
  if (!identity.vendorId || !identity.provider || !identity.vendorExternalOrderId) {
    throw validationError('Vendor tracking identity is incomplete');
  }
  return identity;
}
```

- [ ] **Step 4: Change recheck to derive identity before any provider request**

When `vendorSubmissionId` exists, treat request `provider` and `externalOrderId` as optional match-only compatibility values. Reject mismatches; pass only persisted identity to later tasks.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npm test -- --runInBand src/test/shipment/services/shipmentIdentity.service.test.js src/test/shipment/services/shipment.service.test.js`

Expected: PASS.

### Task 2: Enforce Vendor-Scoped Tracking Credentials

**Files:**
- Modify: `src/modules/shipment/services/shipment.service.js`
- Modify: `src/modules/shipment/services/vendorTrackingAdapters/merchize.adapter.js`
- Modify: `src/modules/shipment/services/vendorTrackingAdapters/printway.adapter.js`
- Modify: `src/modules/shipment/services/vendorTrackingAdapters/lenful.adapter.js`
- Test: `src/test/shipment/services/shipment.service.test.js`
- Test: `src/test/shipment/services/vendorTrackingAdapterRegistry.service.test.js`

**Interfaces:**
- Consumes: Task 1 identity and `vendor.public.getVendorIntegrationCredential(vendorId, provider)`.
- Produces: `fetchVendorTracking(identity, options)` and adapter signature `fetchTrackingByExternalOrderId(externalOrderId, { credential, dateFrom, dateTo })`.

- [ ] **Step 1: Add failing two-vendor credential isolation tests**

```js
await service.recheckVendorTracking({ vendorSubmissionId: submissionA.id }, auth);
expect(vendorPublic.getVendorIntegrationCredential)
  .toHaveBeenCalledWith(vendorAId, 'MERCHIZE');
expect(adapter.fetchTrackingByExternalOrderId)
  .toHaveBeenCalledWith('MZ-A', expect.objectContaining({ credential: credentialA }));
```

Repeat with vendor B using the same provider and assert `credentialB`.

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- --runInBand src/test/shipment/services/shipment.service.test.js`

Expected: FAIL because adapters still resolve credentials internally.

- [ ] **Step 3: Move credential resolution into Shipment service**

Resolve exactly once with `vendorId + provider`; missing credentials return `VALIDATION_ERROR`. Remove adapter imports of Vendor public and remove `MERCHIZE_ACCESS_TOKEN`, `PRINTWAY_ACCESS_TOKEN`, and `LENFUL_*TOKEN` fallbacks from live fetch paths.

- [ ] **Step 4: Update adapters to require supplied credential**

```js
async fetchTrackingByExternalOrderId(externalOrderId, { credential, ...options } = {}) {
  const baseUrl = String(credential?.baseUrl || '').replace(/\/+$/, '');
  const token = credential?.accessToken;
  if (!baseUrl || !token) throw credentialError(PROVIDER);
  // provider request
}
```

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npm test -- --runInBand src/test/shipment/services/shipment.service.test.js src/test/shipment/services/vendorTrackingAdapterRegistry.service.test.js`

Expected: PASS and no test enables environment credential fallback.

### Task 3: Add Provider-Specific Webhook Verification

**Files:**
- Create: `src/modules/shipment/services/vendorWebhookVerifierRegistry.service.js`
- Create: `src/modules/shipment/services/vendorWebhookVerifiers/sharedSecret.verifier.js`
- Modify: `src/modules/shipment/services/shipmentWebhook.service.js`
- Modify: `src/modules/shipment/controllers/shipment.controller.js`
- Modify: `src/modules/shipment/routes/index.js`
- Modify: `src/modules/shipment/validators/shipment.validator.js`
- Modify: `src/modules/shipment/routes/index.js`
- Test: `src/test/shipment/services/shipmentWebhook.service.test.js`
- Test: `src/test/shipment/routes/index.test.js`

**Interfaces:**
- Consumes: normalized provider and raw Express request.
- Produces: `verifyVendorWebhook(provider, req)` that resolves only after valid provider-specific authentication.

- [ ] **Step 1: Add failing authentication tests**

Cover missing header, invalid header, query-only token, missing provider configuration, correct provider-specific header, and native signature verifier selection.

```js
await expect(service.receiveVendorWebhook('MERCHIZE', request({ query: { token: secret } })))
  .rejects.toMatchObject({ statusCode: 403 });
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- --runInBand src/test/shipment/services/shipmentWebhook.service.test.js src/test/shipment/routes/index.test.js`

- [ ] **Step 3: Implement constant-time shared-secret verifier**

```js
const crypto = require('crypto');
function equalSecret(actual, expected) {
  const left = Buffer.from(String(actual || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
```

Require the provider-specific configured header. Do not read `req.query.token` or the global shared secret.

- [ ] **Step 4: Enforce provider/submission binding after authentication**

After resolving the submission, derive Task 1 identity and reject when `identity.provider !== normalizedRouteProvider` before Shipment mutation.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the two suites from Step 2. Expected: PASS.

### Task 4: Centralize Idempotent Tracking Application

**Files:**
- Modify: `src/modules/shipment/services/shipment.service.js`
- Modify: `src/modules/shipment/repositories/shipment.repository.js`
- Modify: `src/modules/shipment/services/shipmentWebhook.service.js`
- Test: `src/test/shipment/services/shipment.service.test.js`
- Test: `src/test/shipment/services/shipmentWebhook.service.test.js`
- Test: `src/test/shipment/repositories/shipment.repository.test.js`

**Interfaces:**
- Produces: `applyTrackingUpdate(shipmentOrSubmissionId, update, authContext)` where update is `{ provider, carrier?, trackingNumber?, trackingUrl?, shipmentStatus?, source, sourceEventId? }`.
- Produces: `POST /api/shipments/:id/recheck`, whose controller passes only the Shipment ID and audited auth context to `recheckShipment(shipmentId, authContext)`.

- [ ] **Step 1: Add failing state and race tests**

Cover new valid tracking, repeated identical tracking, fake tracking, delivered without repeated tracking, terminal regression, and conditional-update loss.

```js
const result = await service.applyTrackingUpdate(shipmentId, {
  provider: 'MERCHIZE', shipmentStatus: 'DELIVERED', source: 'WEBHOOK',
}, systemAuth);
expect(result.status).toBe('DELIVERED');
expect(repository.updateTrackingIfNotDelivered).not.toHaveBeenCalled();
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- --runInBand src/test/shipment/services/shipment.service.test.js src/test/shipment/services/shipmentWebhook.service.test.js src/test/shipment/repositories/shipment.repository.test.js`

- [ ] **Step 3: Add conditional repository mutations**

Add minimal functions that require current status and increment `__v`. Do not add a generic state-machine abstraction.

- [ ] **Step 4: Implement `applyTrackingUpdate` using the approved state graph**

Validate tracking with the existing normalizer. Apply status-only forward transitions before requiring a new tracking number. On a conditional-update loss, reload and return an equivalent compatible state or throw conflict.

- [ ] **Step 5: Delegate webhook, polling, and manual tracking to the canonical function**

Delete duplicated transition branches from `shipmentWebhook.service.js` and `recheckVendorTracking` once delegation covers them.

- [ ] **Step 6: Add the shipment-identity recheck route**

The route requires `SHIPMENTS:WRITE`, accepts no provider/external-order body fields, loads the Shipment and linked Vendor Submission, derives Task 1 identity, fetches tracking, and delegates to `applyTrackingUpdate`.

- [ ] **Step 7: Run focused tests and verify GREEN**

Run the suites from Step 2. Expected: PASS.

### Task 5: Create And Repair Shipment After Vendor Submission

**Files:**
- Modify: `src/modules/shipment/public.js`
- Modify: `src/modules/vendorSubmission/services/vendorSubmission.service.js`
- Modify: `src/modules/vendorSubmission/public.js`
- Test: `src/test/vendorSubmission/services/vendorSubmission.service.test.js`
- Test: `src/test/shipment/services/shipment.service.test.js`
- Test: `src/test/e2e/orderFulfillmentFlow.e2e.test.js`

**Interfaces:**
- Produces Shipment public operation `ensureFromVendorSubmission(vendorSubmissionId, authContext)`.
- Vendor Submission calls it only after persisted `SUBMITTED` state or during submitted-state recovery.

- [ ] **Step 1: Add failing creation and recovery tests**

Assert successful submit creates `TRACKING_PENDING`, repeated submitted submit repairs missing Shipment without calling the vendor adapter, and duplicate creation repairs Order Item/timeline side effects.

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- --runInBand src/test/vendorSubmission/services/vendorSubmission.service.test.js src/test/shipment/services/shipment.service.test.js src/test/e2e/orderFulfillmentFlow.e2e.test.js`

- [ ] **Step 3: Export the idempotent Shipment public operation**

Reuse existing `createFromVendorSubmission`; expose it under the explicit recovery name instead of adding a second implementation.

- [ ] **Step 4: Call Shipment after Production handoff repair**

Keep Vendor Submission committed if Shipment creation fails. A later submitted-state replay invokes the same ensure operation and never reposts the vendor order.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the suites from Step 2. Expected: PASS.

### Task 6: Fix Provider HTTP And Date Contracts

**Files:**
- Modify: `src/modules/shipment/services/vendorTrackingAdapters/requestJson.js`
- Modify: `src/modules/shipment/services/vendorTrackingAdapters/printway.adapter.js`
- Modify: `src/modules/shipment/validators/shipment.validator.js`
- Modify: `src/modules/shipment/repositories/shipment.repository.js`
- Modify: `src/modules/shipment/repositories/vendorWebhookLog.repository.js`
- Test: `src/test/shipment/services/vendorTrackingAdapterRegistry.service.test.js`
- Test: `src/test/shipment/repositories/shipment.repository.test.js`
- Test: `src/test/shipment/services/shipmentWebhook.service.test.js`

**Interfaces:**
- `requestJson(url, { method = 'GET', token, body = null })`.
- Date-only API inputs remain strings until repositories normalize bounds.

- [ ] **Step 1: Add failing HTTP-method and full-day tests**

Assert Printway uses its required method and `2026-08-01` becomes `2026-08-01T23:59:59.999Z` for `dateTo`.

- [ ] **Step 2: Run tests and verify RED**

Run the three suites listed above.

- [ ] **Step 3: Make request method explicit and update all adapter callers**

Do not infer POST from body presence. Merchize/Lenful pass `method: 'GET'`; Printway passes its documented method explicitly.

- [ ] **Step 4: Change date validators to ISO strings and normalize in repositories**

Reuse the date-only end-of-day pattern already implemented by Vendor Submission repository.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the suites from Step 2. Expected: PASS.

### Task 7: Minimize Webhook Logs And Enforce Scoped Reads

**Files:**
- Modify: `src/modules/shipment/models/vendorWebhookLog.model.js`
- Modify: `src/modules/shipment/services/shipmentWebhook.service.js`
- Modify: `src/modules/shipment/repositories/vendorWebhookLog.repository.js`
- Modify: `src/modules/shipment/dtos/shipment.dto.js`
- Create: `src/modules/shipment/scripts/ensureShipmentIndexes.js`
- Modify: `package.json`
- Test: `src/test/shipment/services/shipmentWebhook.service.test.js`
- Test: `src/test/shipment/dtos/shipment.dto.test.js`
- Test: `src/test/shipment/routes/index.test.js`

**Interfaces:**
- Webhook logs store `payloadHash` instead of `rawPayload`.
- Unresolved logs require global Shipment permission; Shop-scoped callers only receive logs with allowed `shopId`.

- [ ] **Step 1: Add failing privacy and scope tests**

Use sentinels for recipient name, address, token, authorization, and email. Assert none appear in persisted log or DTO. Assert a scoped reader cannot see `shopId: null` logs.

- [ ] **Step 2: Run tests and verify RED**

Run the three suites listed above.

- [ ] **Step 3: Replace raw payload with deterministic SHA-256 hash**

Hash the received body bytes or stable JSON representation; retain only normalized diagnostic fields.

- [ ] **Step 4: Change TTL to 30 days and add index sync script**

Expose `npm run indexes:shipments`. The script calls `Shipment.syncIndexes()` and `VendorWebhookLog.syncIndexes()` after an explicit database connection.

- [ ] **Step 5: Enforce global-only access for unresolved logs**

Represent global permission separately from Shop scopes; do not treat a scoped permission as authorization to read unresolved logs.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the suites from Step 2. Expected: PASS.

### Task 8: Backend Documentation And Release Gate

**Files:**
- Modify: `docs/shipment/SHIPMENT_API.md`
- Modify: `docs/shipment/SHIPMENT_MODULE_GUIDE.md`
- Modify: `docs/audit/AUDIT_EVENT_CATALOG.md`

- [ ] **Step 1: Update documented routes, identity rules, state graph, auth, retention, and recovery**

Document that recheck identifiers are derived, webhook query tokens are rejected, provider-specific verification is required, and status-only forward updates are supported.

- [ ] **Step 2: Run backend gates**

```powershell
npm test -- --runInBand src/test/shipment src/test/vendorSubmission src/test/order src/test/e2e/orderFulfillmentFlow.e2e.test.js src/test/architecture.contract.test.js
npm test -- --runInBand
git diff --check
```

Expected: all affected suites pass. If unrelated full-suite failures reproduce in isolation, record exact evidence and do not expand scope without approval.

- [ ] **Step 3: Stop before FE if any affected backend gate fails**

Do not build the workbench against an unstable backend contract.

### Task 9: Add Typed Shipment API, RBAC, Route, And Navigation

**Files:**
- Create: `src/features/portal/shipments/api/shipmentApi.ts`
- Create: `src/features/portal/shipments/api/shipmentKeys.ts`
- Create: `src/features/portal/shipments/auth/shipmentAccess.ts`
- Modify: `src/app/router/router.tsx`
- Modify: `src/app/layout/appNavigation.ts`
- Modify: `src/shared/i18n/locales/en/common.json`
- Modify: `src/shared/i18n/locales/vi/common.json`
- Test: `src/test/portal/shipments/api/shipmentApi.test.ts`
- Test: `src/test/app/router/PortalShipmentRoute.test.tsx`
- Test: `src/test/app/layout/appNavigation.test.ts`

**Interfaces:**
- Produces typed `listShipments`, `getShipment`, `summarizeShipments`, `listWebhookLogs`, and `recheckShipment` calls.
- Recheck input contains only Shipment or Vendor Submission identity, never provider/external order ID.

- [ ] **Step 1: Add failing API and route/RBAC tests**

```ts
await recheckShipment('shipment-1')
expect(apiClient.post).toHaveBeenCalledWith('/api/shipments/shipment-1/recheck')
```

Assert `SHIPMENTS:READ` opens the route and `SHIPMENTS:WRITE` controls actions.

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run src/test/portal/shipments/api/shipmentApi.test.ts src/test/app/router/PortalShipmentRoute.test.tsx src/test/app/layout/appNavigation.test.ts --project unit --project ui`

- [ ] **Step 3: Implement minimal API, permission helpers, route, navigation, and bilingual labels**

Use the shared API client and lazy route boundary. Do not add endpoint constants or a new state store unless an existing pattern requires them.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: PASS.

### Task 10: Build Shipment And Tracking Workbench

**Files:**
- Create: `src/features/portal/shipments/pages/ShipmentWorkbenchPage.tsx`
- Create: `src/features/portal/shipments/pages/ShipmentDetailDrawer.tsx`
- Create: `src/features/portal/shipments/pages/ShipmentWorkbenchPage.module.scss`
- Test: `src/test/portal/shipments/pages/ShipmentWorkbenchPage.test.tsx`
- Test: `src/test/portal/shipments/pages/ShipmentDetailDrawer.test.tsx`

**Interfaces:**
- Consumes Task 9 typed API/hooks and existing shared `DataTable`, `FilterBar`, `DateRangePicker`, `StatusTag`, `PageHeader`, `SectionCard`, and feedback components.

- [ ] **Step 1: Add failing workbench state tests**

Cover loading skeleton/table, empty result, API error/retry, read-only mode, write recheck action, exception filtering, detail drawer, and pagination.

- [ ] **Step 2: Run tests and verify RED**

Run: `npx vitest run src/test/portal/shipments/pages --project ui --maxWorkers=4`

- [ ] **Step 3: Implement the dense operational queue**

Columns: Order, product, vendor/provider, carrier/tracking, status, last update, action. Filters remain URL-backed where the current portal pattern supports shareable state.

- [ ] **Step 4: Implement consistent status colors**

- `TRACKING_PENDING`: blue/ready.
- `SHIPPED`: processing blue.
- `DELIVERED`: success green.
- `EXCEPTION`: error red.
- `RETURNED`: warning orange.
- `CANCELLED`: neutral gray.

- [ ] **Step 5: Implement safe detail and diagnostics**

Show normalized fields, timeline/status history, and scoped webhook-log outcomes. Never render raw HTML or raw provider payloads.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: PASS.

### Task 11: Final Verification And Single Final Commits

- [ ] **Step 1: Run final backend verification**

```powershell
npm test -- --runInBand src/test/shipment src/test/vendorSubmission src/test/order src/test/e2e/orderFulfillmentFlow.e2e.test.js src/test/architecture.contract.test.js
git diff --check
```

- [ ] **Step 2: Run final frontend verification**

```powershell
npm run lint
npm run build
npm test
git diff --check
```

- [ ] **Step 3: Review security invariants mechanically**

Search for query webhook tokens, global webhook-secret fallback, adapter credential lookup, tracking credential env fallback, raw webhook payload persistence, and caller-selected provider/external order ID. Expected: none remain in live Shipment paths.

- [ ] **Step 4: Sync indexes only against explicitly verified databases**

Run `npm run indexes:shipments` first against `lng_web_be_test`. After successful test verification and explicit approval, run it against `lng_web_be`.

- [ ] **Step 5: Create one final implementation commit in each repository**

Backend:

```powershell
git add package.json docs/audit/AUDIT_EVENT_CATALOG.md docs/shipment src/modules/shipment src/modules/vendorSubmission/public.js src/modules/vendorSubmission/services/vendorSubmission.service.js src/test/shipment src/test/vendorSubmission src/test/e2e/orderFulfillmentFlow.e2e.test.js
git commit -m "feat(shipment): secure vendor tracking workflow"
```

Frontend:

```powershell
git add src/app/layout/appNavigation.ts src/app/router/router.tsx src/features/portal/shipments src/shared/i18n/locales/en/common.json src/shared/i18n/locales/vi/common.json src/shared/ui/StatusTag.tsx src/test/app src/test/portal/shipments src/test/shared/ui
git commit -m "feat(shipment): add tracking workbench"
```

- [ ] **Step 6: Report exact commits, verification counts, index targets, and any unrelated failures**
