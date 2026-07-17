# Merchize Vendor Submission Submit Adapter V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow operators to dry-run and explicitly submit a READY `VendorSubmission` to Merchize using the official external order API.

**Architecture:** Keep vendor submission state in `vendorSubmission`. Add a tiny provider adapter under `vendorSubmission`; do not put submit logic in `shipment` because shipment owns tracking only. Use `media.public` only if a public download URL needs to be built or asset existence must be validated.

**Tech Stack:** Node.js, Express, CommonJS, Joi, Jest, existing `fetch`/HTTP helper pattern if present.

## Global Constraints

- Strict modular monolith: cross-module calls only through `public.js`.
- No vendor credential CRUD in V1; use `.env`.
- No auto-submit from QC/pass; operator must call submit endpoint explicitly.
- Default must be safe: `dryRun=true`.
- Real POST requires explicit `dryRun=false`.
- Never expose access tokens, local paths, provider paths, or raw Mongo docs.
- Do not create shipment from submit adapter; shipment starts after `SUBMITTED`.
- Do not implement other vendors in this plan.

---

## Files

- Create: `src/modules/vendorSubmission/services/submitAdapters/merchize.adapter.js`
- Create: `src/modules/vendorSubmission/services/submitAdapters/registry.js`
- Modify: `src/modules/vendorSubmission/services/vendorSubmission.service.js`
- Modify: `src/modules/vendorSubmission/controllers/vendorSubmission.controller.js`
- Modify: `src/modules/vendorSubmission/validators/vendorSubmission.validator.js`
- Modify: `src/modules/vendorSubmission/routes/index.js`
- Modify: `src/modules/vendorSubmission/dtos/vendorSubmission.dto.js`
- Test: `src/test/vendorSubmission/services/merchizeSubmitAdapter.service.test.js`
- Test: `src/test/vendorSubmission/services/vendorSubmission.service.test.js`
- Test: `src/test/vendorSubmission/routes/index.test.js`
- Docs/Bruno: `docs/vendorSubmission/VENDOR_SUBMISSION_API.md`, `docs/bruno/VendorSubmission/*`

---

### Task 1: Merchize Payload Builder

**Files:**
- Create: `src/modules/vendorSubmission/services/submitAdapters/merchize.adapter.js`
- Test: `src/test/vendorSubmission/services/merchizeSubmitAdapter.service.test.js`

**Interfaces:**
- Consumes: `VendorSubmission.payloadSnapshot`
- Produces:
  - `buildMerchizePayload(submission): { order_id, identifier, shipping_info, tags, items }`
  - `validateMerchizePayload(payload): void`
  - `submitMerchizeOrder(payload): Promise<{ provider, externalId, response }>`

- [ ] **Step 1: Write failing tests**

Cover:
- builds `order_id` from `payloadSnapshot.orderItem.externalOrderId || payloadSnapshot.orderItem.orderId || submission.orderItemId`
- maps shipping from `payloadSnapshot.order.shippingAddress`
- maps item `merchize_sku` from `payloadSnapshot.vendorCostCenter.sku || payloadSnapshot.vendorCostCenter.lngCode`
- maps `design_front` from first scaled output/download URL in `payloadSnapshot.fileChecks`
- requires `items[].image`
- rejects missing shipping, missing SKU, missing image, missing design URL.

Run:
```powershell
npx jest src/test/vendorSubmission/services/merchizeSubmitAdapter.service.test.js --runInBand
```
Expected: FAIL because adapter does not exist.

- [ ] **Step 2: Implement minimal adapter**

Implementation notes:
- Use env:
  - `MERCHIZE_API_BASE_URL`
  - fallback `MERCHIZE_BASE_URL`
  - `MERCHIZE_ACCESS_TOKEN`
  - optional `MERCHIZE_IDENTIFIER`
- Endpoint: `POST {baseUrl}/order/external/orders`
- Do not log payload with customer address in production code.
- Use only safe URLs already exposed by backend, e.g. `/api/media/assets/:id/download`, or absolute public URLs if present.

- [ ] **Step 3: Run adapter tests**

Run:
```powershell
npx jest src/test/vendorSubmission/services/merchizeSubmitAdapter.service.test.js --runInBand
```
Expected: PASS.

---

### Task 2: Submit Service With Dry Run

**Files:**
- Create: `src/modules/vendorSubmission/services/submitAdapters/registry.js`
- Modify: `src/modules/vendorSubmission/services/vendorSubmission.service.js`
- Modify: `src/modules/vendorSubmission/dtos/vendorSubmission.dto.js`
- Test: `src/test/vendorSubmission/services/vendorSubmission.service.test.js`

**Interfaces:**
- Produces:
  - `submitToVendor(submissionId, payload, authContext)`
  - Payload: `{ provider: 'MERCHIZE', dryRun?: boolean }`
  - Dry-run response: `{ provider, dryRun: true, payload, validation: { ok: true } }`
  - Real response updates `VendorSubmission.status = SUBMITTED`

- [ ] **Step 1: Write failing service tests**

Cover:
- non-READY submission returns `409 CONFLICT_ERROR`
- unsupported provider returns `400 VALIDATION_ERROR`
- default dry-run does not call adapter POST and does not update status
- `dryRun=false` calls adapter, stores sanitized response, changes status to `SUBMITTED`
- real submit calls `production.public.markSentToVendor`
- adapter failure marks submission `FAILED` only if POST was attempted and response is a vendor rejection; validation failures keep `READY`.

- [ ] **Step 2: Implement service**

Minimal data additions:
- Add fields to `VendorSubmission` only if not enough:
  - `provider`
  - `vendorExternalOrderId`
  - `submittedResponse`

If avoiding schema change is still enough, store sanitized provider response in existing `statusHistory.reason` is not enough. Prefer adding the three fields above.

- [ ] **Step 3: Run service tests**

Run:
```powershell
npx jest src/test/vendorSubmission/services/vendorSubmission.service.test.js --runInBand
```
Expected: PASS.

---

### Task 3: API Endpoint

**Files:**
- Modify: `src/modules/vendorSubmission/routes/index.js`
- Modify: `src/modules/vendorSubmission/controllers/vendorSubmission.controller.js`
- Modify: `src/modules/vendorSubmission/validators/vendorSubmission.validator.js`
- Test: `src/test/vendorSubmission/routes/index.test.js`

**Endpoint:**
```http
POST /api/vendor-submissions/:id/submit-to-vendor
```

**Request:**
```json
{
  "provider": "MERCHIZE",
  "dryRun": true
}
```

**Rules:**
- Auth: `VENDOR_SUBMISSIONS:WRITE`
- `dryRun` defaults to `true`
- Real submit requires `dryRun=false`
- Route must be registered before `/:id`

- [ ] **Step 1: Write route tests**

Cover:
- missing auth returns 401/403 by existing convention
- missing provider returns 400
- default dry-run calls service with `dryRun=true`
- `dryRun=false` is accepted

- [ ] **Step 2: Implement route/controller/validator**

Keep controller thin: validate body, call service, return JSON.

- [ ] **Step 3: Run route tests**

Run:
```powershell
npx jest src/test/vendorSubmission/routes/index.test.js --runInBand
```
Expected: PASS.

---

### Task 4: Docs And Bruno

**Files:**
- Modify: `docs/vendorSubmission/VENDOR_SUBMISSION_API.md`
- Create/Modify: `docs/bruno/VendorSubmission/*Submit to Merchize*.bru`

- [ ] **Step 1: Document flow**

Document:
1. `GET /api/vendor-submissions/:id/payload-preview`
2. `POST /api/vendor-submissions/:id/submit-to-vendor` with `dryRun=true`
3. Fix missing `image/sku/design`
4. `POST /api/vendor-submissions/:id/submit-to-vendor` with `dryRun=false`
5. Tracking via shipment recheck.

- [ ] **Step 2: Add Bruno request**

Variables:
- `vendorSubmissionId`
- `provider=MERCHIZE`
- `dryRun=true`

Do not put tokens in Bruno files.

---

### Task 5: Verification

- [ ] **Run vendorSubmission tests**

```powershell
npx jest src/test/vendorSubmission --runInBand
```

- [ ] **Run production regression**

```powershell
npx jest src/test/production --runInBand
```

- [ ] **Run architecture**

```powershell
npm run test:architecture -- --runInBand
```

- [ ] **Syntax check changed files**

```powershell
Get-ChildItem -Path src\modules\vendorSubmission -Recurse -Filter *.js | ForEach-Object { node -c $_.FullName }
```

---

## Commit Plan

1. `feat(vendor-submission): add merchize submit payload dry-run`
2. `feat(vendor-submission): submit merchize order from ready submission`
3. `docs(vendor-submission): document merchize submit flow`

---

## Final Acceptance

- Operator can dry-run a Merchize payload from a READY submission.
- Operator can explicitly submit to Merchize with `dryRun=false`.
- System stores sanitized response and vendor external order id.
- `VendorSubmission` becomes `SUBMITTED`.
- `ProductionTask` becomes `SENT_TO_VENDOR` through `production.public`.
- No shipment is created automatically.
- No tokens, local paths, provider secrets, or raw Mongo docs are exposed.
