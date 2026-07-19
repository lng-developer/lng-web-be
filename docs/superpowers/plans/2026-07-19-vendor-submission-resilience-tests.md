# Vendor Submission Resilience Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add focused regression tests that prove existing Merchize vendor submission behavior is safe across validation, real submission, failure, retry, and HTTP routing.

**Architecture:** Test the three existing boundaries independently: `merchize.adapter.js` owns payload and HTTP behavior, `vendorSubmission.service.js` owns state transitions and production handoff, and the route owns authentication and body validation. Use the existing Jest mocks and never issue a live provider request.

**Tech Stack:** Node.js, CommonJS, Jest, Express route harness, existing `AppError` and public-port mocks.

## Global Constraints

- Keep every new test in the current vendor-submission test files; do not create a new adapter or provider.
- Do not set real credentials or call a live Merchize endpoint.
- Verify only `MERCHIZE` in this slice.
- Do not change production code unless a new regression test exposes a behavior that contradicts the specification.
- If a test exposes a production bug, stop after recording the failing test and create a separate bug-fix plan; do not broaden this test-only slice.

---

### Task 1: Expand Merchize Adapter Validation Coverage

**Files:**
- Modify: `src/test/vendorSubmission/services/merchizeSubmitAdapter.service.test.js`

**Interfaces:**
- Consumes: `adapter.buildPayload(submission)` and `adapter.validatePayload(payload)` from `src/modules/vendorSubmission/services/submitAdapters/merchize.adapter.js`.
- Produces: Regression coverage that validation rejects missing shipping address, SKU, product image, and design URL without calling `global.fetch`.

- [x] **Step 1: Add the validation matrix test.**

```js
test.each([
  ['shipping address', (payload) => { payload.shipping_info.address_1 = ''; }, /shipping_info\.address_1/],
  ['vendor SKU', (payload) => { payload.items[0].merchize_sku = null; payload.items[0].product_id = null; payload.items[0].sku = null; }, /merchize_sku/],
  ['product image', (payload) => { payload.items[0].image = null; }, /items\[0\]\.image/],
  ['scaled design', (payload) => { payload.items[0].design_front = null; }, /items\[0\]\.design_front/],
])('rejects a missing %s before POST', (_name, mutate, expected) => {
  const payload = adapter.buildPayload(submission);
  mutate(payload);

  expect(() => adapter.validatePayload(payload)).toThrow(expected);
  expect(global.fetch).not.toHaveBeenCalled();
});
```

- [x] **Step 2: Run the adapter suite.**

Run: `npm test -- --runInBand src/test/vendorSubmission/services/merchizeSubmitAdapter.service.test.js`

Expected: PASS. The test confirms validation is local and does not invoke the HTTP client.

- [x] **Step 3: Review the failure contract.**

Confirm the thrown error has `statusCode: 400` and `code: 'VALIDATION_ERROR'` for one matrix case. Add this assertion to the first case if the current matcher does not prove it.

---

### Task 2: Add Submit-Service Safety Contracts

**Files:**
- Modify: `src/test/vendorSubmission/services/vendorSubmission.service.test.js`

**Interfaces:**
- Consumes: `service.submitToVendor(submissionId, { provider, dryRun }, authContext)`.
- Produces: Coverage for transport failures, duplicate submit prevention, response redaction, and idempotent production handoff.

- [x] **Step 1: Add the transient-failure test.**

```js
test('keeps a ready submission retryable when the provider transport fails', async () => {
  const adapter = {
    provider: 'MERCHIZE',
    buildPayload: jest.fn(() => ({ order_id: '113-TEST-ORDER' })),
    validatePayload: jest.fn(),
    submitPayload: jest.fn().mockRejectedValueOnce(Object.assign(new Error('socket hang up'), {
      code: 'ECONNRESET',
    })),
  };
  submitRegistry.getAdapter.mockReturnValueOnce(adapter);

  await expect(service.submitToVendor(submissionId, { provider: 'MERCHIZE', dryRun: false }, {
    permissions: ['VENDOR_SUBMISSIONS:WRITE'],
    accountId: actorId,
  }))
    .rejects.toMatchObject({ message: 'socket hang up', code: 'ECONNRESET' });

  expect(repository.updateById).not.toHaveBeenCalled();
  expect(productionPublic.markSentToVendor).not.toHaveBeenCalled();
});
```

- [x] **Step 2: Add duplicate-submit and handoff-idempotency tests.**

```js
test('does not post a submission that is already submitted', async () => {
  repository.findById.mockResolvedValueOnce({ ...submission, status: 'SUBMITTED' });

  await expect(service.submitToVendor(submissionId, { provider: 'MERCHIZE', dryRun: false }, {
    permissions: ['VENDOR_SUBMISSIONS:WRITE'],
    accountId: actorId,
  }))
    .rejects.toMatchObject({ statusCode: 409, code: 'CONFLICT_ERROR' });

  const adapter = submitRegistry.getAdapter.mock.results[0].value;
  expect(adapter.submitPayload).not.toHaveBeenCalled();
  expect(repository.updateById).not.toHaveBeenCalled();
});

test('accepts an already-completed production handoff for the same submission', async () => {
  productionPublic.markSentToVendor.mockRejectedValueOnce(Object.assign(new Error('already sent'), {
    statusCode: 409,
    details: { status: 'SENT_TO_VENDOR', vendorSubmissionId: submissionId },
  }));

  await expect(service.submitToVendor(submissionId, { provider: 'MERCHIZE', dryRun: false }, {
    permissions: ['VENDOR_SUBMISSIONS:WRITE'],
    accountId: actorId,
  }))
    .resolves.toMatchObject({ status: 'SUBMITTED' });
});
```

- [x] **Step 3: Add the persisted-response redaction assertion.**

```js
const adapter = {
  provider: 'MERCHIZE',
  buildPayload: jest.fn(() => ({ order_id: '113-TEST-ORDER' })),
  validatePayload: jest.fn(),
  submitPayload: jest.fn().mockResolvedValueOnce({
    provider: 'MERCHIZE',
    externalId: 'MZ-ORDER-1',
    response: { success: true, token: 'do-not-store', localPath: 'C:\\private\\order.json' },
  }),
};
submitRegistry.getAdapter.mockReturnValueOnce(adapter);

await service.submitToVendor(submissionId, { provider: 'MERCHIZE', dryRun: false }, {
  permissions: ['VENDOR_SUBMISSIONS:WRITE'],
  accountId: actorId,
});

const patch = repository.updateById.mock.calls[0][1];
expect(patch.submittedResponse).toEqual({ success: true });
```

- [x] **Step 4: Run the service suite.**

Run: `npm test -- --runInBand src/test/vendorSubmission/services/vendorSubmission.service.test.js`

Expected: PASS. Existing vendor rejection coverage must remain green and the new timeout case must leave the submission unchanged.

---

### Task 3: Complete the HTTP Submit Route Contract

**Files:**
- Modify: `src/test/vendorSubmission/routes/index.test.js`

**Interfaces:**
- Consumes: `POST /:id/submit-to-vendor` with `VENDOR_SUBMISSIONS:WRITE`.
- Produces: Coverage that an explicit live-submit request reaches `service.submitToVendor()` with `dryRun: false` and invalid input stops before the service.

- [x] **Step 1: Add the explicit real-submit forwarding test.**

```js
test('forwards explicit dryRun false to the submit service', async () => {
  service.submitToVendor.mockResolvedValueOnce({ status: 'SUBMITTED', provider: 'MERCHIZE' });

  const response = await request(createServer(), {
    method: 'POST',
    path: `/${submissionId}/submit-to-vendor`,
    headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDOR_SUBMISSIONS:WRITE'] }) },
    body: { provider: 'MERCHIZE', dryRun: false },
  });

  expect(response.statusCode).toBe(200);
  expect(service.submitToVendor).toHaveBeenCalledWith(submissionId, {
    provider: 'MERCHIZE',
    dryRun: false,
  }, expect.objectContaining({ permissions: ['VENDOR_SUBMISSIONS:WRITE'] }));
});
```

- [x] **Step 2: Add the unsupported-provider assertion.**

```js
const response = await request(createServer(), {
  method: 'POST',
  path: `/${submissionId}/submit-to-vendor`,
  headers: { 'X-Auth-Context': JSON.stringify({ permissions: ['VENDOR_SUBMISSIONS:WRITE'] }) },
  body: { provider: 'UNKNOWN', dryRun: false },
});

expect(response.statusCode).toBe(400);
expect(service.submitToVendor).not.toHaveBeenCalled();
```

- [x] **Step 3: Run the route suite.**

Run: `npm test -- --runInBand src/test/vendorSubmission/routes/index.test.js`

Expected: PASS. The route remains registered before `/:id` and body validation prevents invalid service calls.

---

### Task 4: Verify the Regression Slice

**Files:**
- Verify: `src/test/vendorSubmission/services/merchizeSubmitAdapter.service.test.js`
- Verify: `src/test/vendorSubmission/services/vendorSubmission.service.test.js`
- Verify: `src/test/vendorSubmission/routes/index.test.js`

**Interfaces:**
- Consumes: The completed tests from Tasks 1-3.
- Produces: Fresh evidence that all resilience contracts pass without a live vendor call.

- [x] **Step 1: Run the focused suites together.**

Run: `npm test -- --runInBand src/test/vendorSubmission/services/merchizeSubmitAdapter.service.test.js src/test/vendorSubmission/services/vendorSubmission.service.test.js src/test/vendorSubmission/routes/index.test.js`

Expected: PASS with zero failures.

- [x] **Step 2: Run architecture verification.**

Run: `npm run test:architecture -- --runInBand`

Expected: PASS. No test introduces a cross-module internal import.

- [x] **Step 3: Inspect the scoped diff.**

Run: `git diff --check; git diff -- src/test/vendorSubmission/services/merchizeSubmitAdapter.service.test.js src/test/vendorSubmission/services/vendorSubmission.service.test.js src/test/vendorSubmission/routes/index.test.js`

Expected: Only the regression tests and no credentials, generated data, or production behavior changes are present.

## Plan Self-Review

- Spec coverage: Tasks 1-3 cover every row in the test matrix; Task 4 verifies the combined result.
- Scope: The plan modifies only existing test files and intentionally excludes provider implementation, live calls, and other vendors.
- Consistency: All tests use the existing `MERCHIZE` provider, `submitToVendor()` signature, and route path.
