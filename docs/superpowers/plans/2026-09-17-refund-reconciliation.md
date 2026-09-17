# Refund Reconciliation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Correct refund fee reversals, safely allocate multi-item refunds, and reconcile settlement refund evidence without double counting.

**Architecture:** Finance imports retain signed source evidence. Refund allocations become the only source summed into an order-item snapshot; legacy linked refund records are represented as their full amount. Settlement rows remain ledger evidence and receive a reconciliation status only.

**Tech Stack:** Node.js, Express, Mongoose, Joi, Jest, React, Ant Design, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-17-refund-reconciliation-design.md`

## Global Constraints

- All money is integer minor units.
- Cross-module order reads use `order/public` only.
- No automatic allocation from an order-level refund to multiple order items.
- Existing linked refunds retain their current P&L result until deliberately reallocated.

---

### Task 1: Signed marketplace-fee import

**Files:**
- Modify: `src/modules/finance/services/financeImport.service.js`
- Modify: `src/modules/finance/models/marketplaceFeeLine.model.js`
- Test: `tests/finance/services/financeImport.service.test.js`

**Interfaces:**
- Produces signed `totalFeeAmount` values consumed by `sumFeesByOrderItem`.

- [ ] Write a failing import-service test for a `Refund` row with positive selling fees and assert a negative fee-line amount.
- [ ] Run `npx jest tests/finance/services/financeImport.service.test.js --runInBand` and confirm the assertion fails under absolute-value handling.
- [ ] Preserve the transaction-row fee sign when creating a fee line and permit signed fee values in its schema.
- [ ] Re-run the focused test and all finance import tests.

### Task 2: Explicit refund allocation

**Files:**
- Create: `src/modules/finance/models/refundAllocation.model.js`
- Modify: `src/modules/finance/repositories/financeImport.repository.js`
- Modify: `src/modules/finance/services/financeImport.service.js`
- Modify: `src/modules/finance/controllers/financeImport.controller.js`
- Modify: `src/modules/finance/routes/index.js`
- Modify: `src/modules/finance/validators/financeSnapshot.validator.js`
- Modify: `src/modules/finance/dtos/financeImport.dto.js`
- Test: `tests/finance/services/financeImport.service.test.js`
- Test: `tests/finance/repositories/financeImport.repository.test.js`

**Interfaces:**
- `allocateRefund(refundId, { allocations: [{ orderItemId, amount }] }, authContext, httpContext)` validates ownership, writes allocations idempotently, and recalculates affected items.
- `sumRefundsByOrderItem(orderItemId)` sums explicit allocations and treats a legacy linked record as one full allocation only when no explicit allocations exist.

- [ ] Write failing service tests for a split allocation, over-allocation rejection, and an order-level row remaining unlinked automatically.
- [ ] Run those tests and confirm the new API is unavailable.
- [ ] Add the allocation model, repository methods, service validation, route/controller/DTO/validator, and audit event.
- [ ] Re-run focused finance tests.

### Task 3: Settlement reconciliation and operator UI

**Files:**
- Modify: `src/modules/finance/repositories/financeImport.repository.js`
- Modify: `src/modules/finance/services/financeSettlement.service.js`
- Modify: `C:\lng_system\lng-web\lng-web-fe\src/features/portal/finance/api/financeApi.ts`
- Modify: `C:\lng_system\lng-web\lng-web-fe\src/features/portal/integrations/components/FinanceImportSection.tsx`
- Test: `tests/finance/services/financeSettlement.service.test.js`
- Test: `C:\lng_system\lng-web\lng-web-fe\src/test/portal/integrations/pages/IntegrationWorkbenchPage.test.tsx`

**Interfaces:**
- Settlement refund rows expose whether linked transaction refund evidence exists; no settlement row writes a buyer-refund allocation.
- The transaction import dialog shows unlinked refunds and lets finance writers submit explicit allocations.

- [ ] Write failing settlement and UI tests for reconciliation-only refund evidence and an allocation action.
- [ ] Run those focused tests and confirm they fail for missing behavior.
- [ ] Implement the smallest settlement comparison and allocation UI using existing finance endpoints.
- [ ] Run focused backend and frontend tests, then typecheck the frontend.
