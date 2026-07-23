# Returns, Claims, and RMA Conditional Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After explicit product-gate approval, add a bounded `returnsClaims` module for post-delivery cases, remedies, and vendor claims.

**Architecture:** The module owns case lifecycle and evidence links. It calls order, media, production, vendorSubmission, shipment, finance, auth, and audit through public ports and never rewrites historical fulfillment or finance truth.

**Tech Stack:** Node.js CommonJS, Express, Mongoose, Joi, Jest.

## Global Constraints

- Do not execute Tasks 2-6 until Task 1 is approved in writing by the product owner.
- Do not implement marketplace labels, inventory returns, AI grading, or generic ticketing.
- Cross-module calls use `public.js`; read queries use `.lean()`; responses use DTOs.
- Finance remedies create adjustments; they never mutate historical snapshots to hide the original event.

---

### Task 1: Close the Product Gate

**Files:**
- Create only after decisions exist: `docs/returnsClaims/PRODUCT_DECISIONS.md`

**Interfaces:**
- Produces: approved enums, thresholds, actors, evidence rules, remedy policy, vendor-claim process, finance treatment, and terminal states.

- [ ] **Step 1: Record explicit decisions**

The document must answer every gate item from `docs/superpowers/specs/2026-07-23-returns-claims-rma-design.md` with final approved values and no unresolved markers.

- [ ] **Step 2: Obtain product-owner approval**

Record the actual approver name and ISO approval date in the document:

The approval section must contain `Implementation authorized: yes`; otherwise stop after Task 1.

- [ ] **Step 3: Stop if authorization is absent**

Expected: Tasks 2-6 remain unstarted unless `Implementation authorized: yes`.

- [ ] **Step 4: Commit the decision record**

```powershell
git add docs/returnsClaims/PRODUCT_DECISIONS.md
git commit -m "docs(returns-claims): approve RMA product rules"
```

### Task 2: Create the Case Model and Repository

**Files:**
- Create: `src/modules/returnsClaims/models/returnClaim.model.js`
- Create: `src/modules/returnsClaims/repositories/returnClaim.repository.js`
- Test: `src/test/returnsClaims/repositories/returnClaim.repository.test.js`

**Interfaces:**
- Produces:
  - `create(payload)`
  - `findById(id)`
  - `findByIntakeIdentity(sourceChannel, externalRequestId)`
  - `findActiveOverlap(orderItemId, reasonCode)`
  - `updateIfStatus(id, expectedStatus, patch)`
  - `list(query)`

- [ ] **Step 1: Write failing repository tests**

Cover unique intake identity, `.lean()` reads, bounded pagination, active overlap lookup, and atomic expected-status update.

- [ ] **Step 2: Define the minimal schema**

Store case number, intake identity, shop/order/item references, reason, description, evidence asset ids, status, remedy executions, vendor claim summary, finance adjustment ids, timeline entries, created/updated actor and timestamps. Copy exact approved enums from `PRODUCT_DECISIONS.md`.

- [ ] **Step 3: Implement lean repository queries**

```js
function findById(id) {
  return ReturnClaim.findById(id).lean();
}

function updateIfStatus(id, expectedStatus, patch) {
  return ReturnClaim.findOneAndUpdate(
    { _id: id, status: expectedStatus },
    { $set: patch },
    { new: true, runValidators: true },
  ).lean();
}
```

- [ ] **Step 4: Verify and commit**

Run: `npm test -- src/test/returnsClaims/repositories --runInBand`

```powershell
git add src/modules/returnsClaims src/test/returnsClaims
git commit -m "feat(returns-claims): add case persistence"
```

### Task 3: Implement Guarded Case Lifecycle

**Files:**
- Create: `src/modules/returnsClaims/constants/returnClaim.constants.js`
- Create: `src/modules/returnsClaims/services/returnClaim.service.js`
- Create: `src/modules/returnsClaims/dtos/returnClaim.dto.js`
- Create: `src/modules/returnsClaims/public.js`
- Test: `src/test/returnsClaims/services/returnClaim.service.test.js`
- Test: `src/test/returnsClaims/dtos/returnClaim.dto.test.js`

**Interfaces:**
- Produces: `createCase`, `getCase`, `listCases`, `attachEvidence`, `submitForReview`, `approve`, `reject`, `cancel`.

- [ ] **Step 1: Write table-driven transition tests**

```js
it.each([
  ['OPEN', 'EVIDENCE_PENDING'],
  ['OPEN', 'UNDER_REVIEW'],
  ['UNDER_REVIEW', 'APPROVED'],
  ['UNDER_REVIEW', 'REJECTED'],
])('allows %s -> %s', async (from, to) => {
  repository.findById.mockResolvedValue(caseFixture({ status: from }));
  repository.updateIfStatus.mockResolvedValue(caseFixture({ status: to }));
  await expect(service.transition(caseId, to, authContext)).resolves.toMatchObject({ status: to });
});
```

Add rejected-edge, scope, intake idempotency, overlap, and evidence ownership tests.

- [ ] **Step 2: Implement service guards**

Validate order/item/shop through `order.public`, evidence through `media.public`, permissions through `auth.public`, then use atomic repository transitions and existing audit public port.

- [ ] **Step 3: Implement allow-listed DTOs and public exports**

Exclude raw customer data, media storage internals, vendor credentials, and internal error stacks.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- src/test/returnsClaims --runInBand`

Run: `npm run test:architecture -- --runInBand`

```powershell
git add src/modules/returnsClaims src/test/returnsClaims
git commit -m "feat(returns-claims): add guarded case lifecycle"
```

### Task 4: Implement Idempotent Remedies

**Files:**
- Create: `src/modules/returnsClaims/services/returnClaimRemedy.service.js`
- Test: `src/test/returnsClaims/services/returnClaimRemedy.service.test.js`

**Interfaces:**
- Produces: `requestReprint(caseId, command, authContext)`, `recordRefund(...)`, `openVendorClaim(...)`.

- [ ] **Step 1: Write failing idempotency and partial-failure tests**

Call each remedy twice with the same `caseId`, case version, and remedy type; assert one owner-module mutation. Inject owner failure and assert the approved case remains unresolved with retryable execution evidence.

- [ ] **Step 2: Delegate through public ports**

Reprint uses existing production/vendor submission boundaries; refund creates a finance adjustment through an approved finance public method; vendor claim records an external claim reference without modifying the original submission.

- [ ] **Step 3: Guard resolution**

Resolve a case only when every approved required remedy has terminal successful evidence.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- src/test/returnsClaims/services/returnClaimRemedy.service.test.js --runInBand`

```powershell
git add src/modules/returnsClaims src/test/returnsClaims
git commit -m "feat(returns-claims): add idempotent remedies"
```

### Task 5: Add Validated HTTP API

**Files:**
- Create: `src/modules/returnsClaims/validators/returnClaim.validator.js`
- Create: `src/modules/returnsClaims/controllers/requestValidation.js`
- Create: `src/modules/returnsClaims/controllers/returnClaim.controller.js`
- Create: `src/modules/returnsClaims/routes/index.js`
- Create: `src/modules/returnsClaims/index.js`
- Modify: `src/modules/index.js`
- Test: `src/test/returnsClaims/routes/index.test.js`

**Interfaces:**
- Produces the API surface approved in the spec: CRUD reads, evidence, review, decision, remedy, vendor claim, cancel, and timeline.

- [ ] **Step 1: Add route boundary tests**

For every route assert authentication, exact permission, scope enforcement, Joi rejection, HTTP status, and DTO response.

- [ ] **Step 2: Implement thin controllers**

Each controller validates request data, calls one service method, and returns the proper status. No repository/model import is allowed.

- [ ] **Step 3: Mount the module**

```js
const returnsClaims = require('./returnsClaims');
router.use('/returns-claims', returnsClaims.router);
```

Add it to the exported `modules` object.

- [ ] **Step 4: Verify and commit**

Run: `npm test -- src/test/returnsClaims --runInBand`

Run: `npm run test:architecture -- --runInBand`

```powershell
git add src/modules/returnsClaims src/modules/index.js src/test/returnsClaims
git commit -m "feat(returns-claims): expose RMA API"
```

### Task 6: Verify Reprint, Refund, and Vendor Claim E2E

**Files:**
- Create: `src/test/e2e/returnClaimFlow.e2e.test.js`

**Interfaces:**
- Consumes: public module APIs and approved product rules.
- Produces: end-to-end proof for three remedy outcomes.

- [ ] **Step 1: Add three deterministic scenarios**

Cover approved reprint through replacement shipment, approved refund through finance adjustment, and vendor claim acceptance through recovered vendor credit.

- [ ] **Step 2: Add replay assertions**

Repeat each command and assert one remedy execution, one replacement fulfillment identity, and one finance adjustment identity.

- [ ] **Step 3: Run full verification**

Run: `npm test -- src/test/returnsClaims src/test/e2e/returnClaimFlow.e2e.test.js --runInBand`

Run: `npm run test:architecture -- --runInBand`

Run: `npm test -- --runInBand`

- [ ] **Step 4: Commit**

```powershell
git add src/test/e2e/returnClaimFlow.e2e.test.js
git commit -m "test(returns-claims): verify RMA remedies"
```
