# Finance and Report Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make order profitability, Amazon settlement cash flow, and reports explicit about date basis, actual versus estimated money, and incomplete data.

**Architecture:** Finance owns imported source facts and per-order-item snapshots. Report only aggregates those facts. The release adds business-date/confidence fields, null-safe P&L aggregation, a cash-only settlement boundary, deterministic import validation, then updates the existing React pages.

**Tech Stack:** Node.js, Express, MongoDB/Mongoose, BullMQ/Redis, Jest, React, TypeScript, TanStack Query, Ant Design, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-08-finance-report-integrity-design.md`

## Global Constraints

- Do not execute until the five approval gates in the design spec are accepted.
- Money remains integer minor units.
- Preserve raw source provenance: `sourceAssetId`, `sourceRef`, and `importBatchId`.
- Do not allocate Ads to individual order items.
- Do not run a migration with `--apply` until a reviewed dry-run and explicit approval.
- Existing worktrees are dirty; create isolated worktrees before execution.

---

### Task 1: Persist ordered date and profitability confidence

**Files:**
- Modify: `src/modules/finance/constants/finance.constants.js`
- Modify: `src/modules/finance/models/financeSnapshot.model.js`
- Modify: `src/modules/finance/services/financeSnapshot.service.js`
- Modify: `src/modules/finance/dtos/financeSnapshot.dto.js`
- Test: `tests/finance/services/financeSnapshot.service.test.js`
- Test: `tests/finance/models/financeSourceModels.test.js`

**Interfaces:**
- `profitStatuses = { ACTUAL, ESTIMATED, INCOMPLETE_COST }`.
- `costBases = { RATE_CARD, VENDOR_INVOICE, MISSING }` and `feeConfidences = { ACTUAL, ESTIMATED }`.
- `FinanceSnapshot` gains `orderedAt`, `profitStatus`, `costBasis`, and `feeConfidence`.
- Snapshot DTO exposes both fields.

- [ ] **Step 1: Write failing tests**

```js
expect(result).toMatchObject({
  orderedAt: new Date('2026-09-01T12:00:00.000Z'),
  profitStatus: 'ESTIMATED',
  costBasis: 'RATE_CARD',
  feeConfidence: 'ACTUAL',
});
expect(estimatedFee.result).toMatchObject({ profitStatus: 'ESTIMATED', feeConfidence: 'ESTIMATED' });
expect(missingCost.result.profitStatus).toBe('INCOMPLETE_COST');
```

- [ ] **Step 2: Prove the tests fail**

Run: `npx jest tests/finance/services/financeSnapshot.service.test.js tests/finance/models/financeSourceModels.test.js --runInBand`

Expected: FAIL because the fields do not exist.

- [ ] **Step 3: Implement minimal derivation**

```js
function profitabilityConfidenceFor({ costStatus, feeSource, costBasis }) {
  if (costStatus !== financeCostStatuses.PRESENT) return profitStatuses.INCOMPLETE_COST;
  if (costBasis !== costBases.VENDOR_INVOICE
      || feeSource === marketplaceFeeSources.ESTIMATED_15_PERCENT) {
    return profitStatuses.ESTIMATED;
  }
  return profitStatuses.ACTUAL;
}
```

Load `Order.orderedAt` during snapshot recalculation. Current rate-card cost maps to `costBasis: RATE_CARD`; current imported fee maps to `feeConfidence: ACTUAL`. Keep the current `snapshotStatus` unchanged for compatibility.

- [ ] **Step 4: Verify and commit**

Run: `npx jest tests/finance/services/financeSnapshot.service.test.js tests/finance/models/financeSourceModels.test.js --runInBand`

Commit: `git add src/modules/finance/constants/finance.constants.js src/modules/finance/models/financeSnapshot.model.js src/modules/finance/services/financeSnapshot.service.js src/modules/finance/dtos/financeSnapshot.dto.js tests/finance/services/financeSnapshot.service.test.js tests/finance/models/financeSourceModels.test.js; git commit -m "feat(finance): persist business date and profit confidence"`

### Task 2: Make Finance and Report aggregates null-safe

**Files:**
- Modify: `src/modules/finance/repositories/financeSnapshot.repository.js`
- Modify: `src/modules/finance/services/financeSnapshot.service.js`
- Modify: `src/modules/report/dtos/report.dto.js`
- Modify: `src/modules/report/services/report.service.js`
- Test: `tests/finance/repositories/financeSnapshot.repository.test.js`
- Test: `tests/finance/services/financeSnapshot.service.test.js`
- Test: `tests/report/services/report.service.test.js`

**Interfaces:**
- Aggregate rows add `profitStatus`, `missingCostCount`, and `estimatedFeeCount`.
- When `missingCostCount > 0`, gross profit, net profit, and their margins are null.
- Ads and operating cost remain visible as independent amounts.

- [ ] **Step 1: Write failing aggregate tests**

```js
expect(row).toMatchObject({
  missingCostCount: 1,
  profitStatus: 'INCOMPLETE_COST',
  grossProfitAmount: null,
  netProfitAmount: null,
});
expect(estimated).toMatchObject({ estimatedFeeCount: 2, profitStatus: 'ESTIMATED_FEE' });
```

- [ ] **Step 2: Prove current aggregation fails**

Run: `npx jest tests/finance/repositories/financeSnapshot.repository.test.js tests/finance/services/financeSnapshot.service.test.js tests/report/services/report.service.test.js --runInBand`

Expected: FAIL because null gross profit is currently summed as zero.

- [ ] **Step 3: Implement null-safe projections**

```js
grossProfitAmount: {
  $cond: [{ $eq: ['$missingCostCount', 0] }, '$grossProfitAmount', null],
},
profitStatus: {
  $cond: [
    { $gt: ['$missingCostCount', 0] }, 'INCOMPLETE_COST',
    { $cond: [{ $gt: ['$estimatedFeeCount', 0] }, 'ESTIMATED_FEE', 'ACTUAL'] },
  ],
},
```

Change `applyOperatingCost` so null gross profit produces null net profit, not a negative or zero result.

- [ ] **Step 4: Verify and commit**

Run: `npx jest tests/finance/repositories/financeSnapshot.repository.test.js tests/finance/services/financeSnapshot.service.test.js tests/report/services/report.service.test.js --runInBand`

Commit: `git add src/modules/finance/repositories/financeSnapshot.repository.js src/modules/finance/services/financeSnapshot.service.js src/modules/report/dtos/report.dto.js src/modules/report/services/report.service.js tests/finance/repositories/financeSnapshot.repository.test.js tests/finance/services/financeSnapshot.service.test.js tests/report/services/report.service.test.js; git commit -m "fix(report): preserve incomplete profitability totals"`

### Task 3: Add explicit P&L date basis and guarded data backfill

**Files:**
- Modify: `src/modules/report/validators/report.validator.js`
- Modify: `src/modules/finance/repositories/financeSnapshot.repository.js`
- Create: `tools/scripts/maintenance/backfillFinanceSnapshotOrderedAt.js`
- Modify: `package.json`
- Test: `tests/report/routes/index.test.js`
- Test: `tests/finance/repositories/financeSnapshot.repository.test.js`

**Interfaces:**
- Report query accepts `dateBasis: ORDERED_AT | CALCULATED_AT`.
- P&L UI uses `ORDERED_AT`; technical audit can use `CALCULATED_AT`.
- Dry-run command returns `{ scanned, eligible, missingOrderDate, wouldUpdate }` without writes.

- [ ] **Step 1: Write failing filter and migration tests**

```js
expect(buildFilter({ dateBasis: 'ORDERED_AT', dateFrom, dateTo })).toEqual({
  orderedAt: { $gte: dateFrom, $lte: dateTo },
});
expect(dryRun).toEqual({ scanned: 3, eligible: 2, missingOrderDate: 1, wouldUpdate: 2 });
```

- [ ] **Step 2: Prove the date basis is absent**

Run: `npx jest tests/report/routes/index.test.js tests/finance/repositories/financeSnapshot.repository.test.js --runInBand`

Expected: FAIL because `dateBasis` and the guarded backfill do not exist.

- [ ] **Step 3: Implement whitelist and migration guard**

```js
const dateFieldByBasis = {
  ORDERED_AT: 'orderedAt',
  CALCULATED_AT: 'calculatedAt',
};
```

The migration updates only snapshots missing `orderedAt` when the parent Order has a real `orderedAt`. It must never substitute `createdAt` or `calculatedAt`.

- [ ] **Step 4: Verify dry-run and commit**

Run: `npx jest tests/report/routes/index.test.js tests/finance/repositories/financeSnapshot.repository.test.js --runInBand`

Run: `npm run backfill:finance-snapshot-ordered-at -- --dry-run`

Commit: `git add src/modules/report/validators/report.validator.js src/modules/finance/repositories/financeSnapshot.repository.js tools/scripts/maintenance/backfillFinanceSnapshotOrderedAt.js package.json tests/report/routes/index.test.js tests/finance/repositories/financeSnapshot.repository.test.js; git commit -m "feat(report): filter profitability by explicit date basis"`

### Task 4: Separate settlement cash flow from profitability

**Files:**
- Modify: `src/modules/finance/services/financeImport.service.js`
- Modify: `src/modules/finance/repositories/financeImport.repository.js`
- Modify: `src/modules/finance/dtos/financeSettlement.dto.js`
- Modify: `src/modules/finance/services/financeSettlement.service.js`
- Modify: `docs/finance/FINANCE_API.md`
- Test: `tests/finance/services/financeImport.service.test.js`
- Test: `tests/finance/services/financeSettlement.service.test.js`

**Interfaces:**
- Settlement batch recalculation is `NOT_REQUIRED`.
- Ledger summary adds `payoutAmount`, `ledgerNetAmount`, `cashVarianceAmount`, and `linkCoverageBps`.
- `cashVarianceAmount = payoutAmount - ledgerNetAmount`.

- [ ] **Step 1: Write failing boundary tests**

```js
expect(enqueueSnapshotRecalculation).not.toHaveBeenCalled();
expect(detail.ledger.summary).toMatchObject({
  payoutAmount: 96215,
  ledgerNetAmount: 95000,
  cashVarianceAmount: 1215,
  linkCoverageBps: 7500,
});
```

- [ ] **Step 2: Prove the current behavior fails**

Run: `npx jest tests/finance/services/financeImport.service.test.js tests/finance/services/financeSettlement.service.test.js --runInBand`

Expected: FAIL because settlements currently enqueue snapshot recalculation and diagnostics are absent.

- [ ] **Step 3: Implement cash-only behavior**

Call `scheduleSnapshotRecalculations` only for `TRANSACTIONS`. Keep settlement header and ledger storage unchanged. Calculate variance without allocating it to orders or P&L.

- [ ] **Step 4: Verify and commit**

Run: `npx jest tests/finance --runInBand`

Commit: `git add src/modules/finance/services/financeImport.service.js src/modules/finance/repositories/financeImport.repository.js src/modules/finance/dtos/financeSettlement.dto.js src/modules/finance/services/financeSettlement.service.js docs/finance/FINANCE_API.md tests/finance/services/financeImport.service.test.js tests/finance/services/financeSettlement.service.test.js; git commit -m "feat(finance): separate settlement cash flow from profit"`

### Task 5: Validate sources, align Ads scope, and show data quality

**Files:**
- Modify: `src/modules/finance/models/financeImportBatch.model.js`
- Modify: `src/modules/finance/repositories/financeImport.repository.js`
- Modify: `src/modules/finance/services/financeImport.parser.js`
- Modify: `src/modules/finance/services/financeImport.service.js`
- Modify: `src/modules/report/services/report.service.js`
- Modify: `C:/lng_system/lng-web/lng-web-fe/src/features/portal/reports/components/ReportAdsTab.tsx`
- Modify: `C:/lng_system/lng-web/lng-web-fe/src/features/portal/reports/pages/ReportWorkspacePage.tsx`
- Modify: `C:/lng_system/lng-web/lng-web-fe/src/features/portal/finance/pages/FinanceWorkspacePage.tsx`
- Modify: `C:/lng_system/lng-web/lng-web-fe/src/features/portal/finance/pages/SettlementWorkspacePage.tsx`
- Test: `tests/finance/services/financeImport.service.test.js`
- Test: `tests/report/services/report.service.test.js`
- Test: `C:/lng_system/lng-web/lng-web-fe/src/test/portal/reports/components/ReportAdsTab.test.tsx`

**Interfaces:**
- `FinanceImportBatch.contentHash` is a SHA-256 digest; duplicate upload lookup uses `{ shopId, sourceType, contentHash }`.
- Parser returns row validation errors instead of converting required missing fields to zero.
- Ads aggregate accepts permitted `sellerEmployeeCodes` for team/department scope.
- Ads UI groups each KPI/table by currency.
- UI displays actual/estimated/incomplete status, missing cost, estimated fee, cash variance, and link coverage.

- [ ] **Step 1: Write failing source, scope, and UI tests**

```js
expect(parseSettlementTxt('settlement-id\tamount\n\t12.00')).toMatchObject({
  rows: [],
  errors: [expect.objectContaining({ row: 2, field: 'settlement-id' })],
});
expect(financePublic.summarizeAdsBySeller).toHaveBeenCalledWith(
  expect.objectContaining({ sellerEmployeeCodes: ['J2501', 'J2502'] }),
  expect.any(Object),
);
expect(screen.getByText('Cash variance')).toBeVisible();
```

- [ ] **Step 2: Prove current contracts fail**

Run: `npx jest tests/finance/services/financeImport.service.test.js tests/report/services/report.service.test.js --runInBand`

Run: `npm run test:ui -- --run src/test/portal/reports/components/ReportAdsTab.test.tsx`

Expected: FAIL because malformed rows, team/dept Ads scoping, per-currency Ads grouping, and quality panels are absent.

- [ ] **Step 3: Implement exact constraints**

```js
const requiredSettlementHeader = ['settlement-id', 'settlement-start-date', 'settlement-end-date'];
const requiredSettlementActivity = ['settlement-id', 'transaction-type', 'amount'];
const requiredTransaction = ['date/time', 'type', 'total'];
```

Hash each local file before storing it. A valid file with invalid rows becomes `PARTIAL_FAILED`; missing required headers becomes `FAILED`. Resolve HR/organization seller codes before Ads aggregation. Reuse existing `MetricCard`, `StatusTag`, `SectionCard`, `FeedbackAlert`, and i18n files; add no dependency.

- [ ] **Step 4: Run complete verification and stop before live writes**

Run: `npx jest tests/finance tests/report --runInBand`

Run: `npm run test:unit -- --run src/test/portal/finance src/test/portal/reports`

Run: `npm run test:ui -- --run src/test/portal/finance src/test/portal/reports`

Run: `npm run typecheck`

Run: `git diff --check`

Run: `npm run backfill:finance-snapshot-ordered-at -- --dry-run`

Expected: tests/typecheck pass, diff check is clean, and dry-run performs no writes. Stop for review before `--apply` or deployment.

Commit backend: `git add src/modules/finance src/modules/report tests/finance tests/report; git commit -m "fix(finance): validate financial reporting inputs"`

Commit frontend: `git add src/features/portal/finance src/features/portal/reports src/shared/i18n/locales src/test/portal/finance src/test/portal/reports; git commit -m "feat(reports): surface financial data quality"`

### Task 6: Preserve historical vendor rate-card cost

**Files:**
- Modify: `src/modules/vendor/models/vendorCostCenter.model.js`
- Modify: `src/modules/vendor/validators/vendor.validator.js`
- Modify: `src/modules/vendor/services/vendor.service.js`
- Modify: `src/modules/mapping/services/fulfillmentPlan.service.js`
- Modify: `src/modules/finance/models/financeSnapshot.model.js`
- Modify: `src/modules/finance/services/financeSnapshot.service.js`
- Create: `tools/scripts/maintenance/backfillVendorCostRateHistory.js`
- Modify: `package.json`
- Test: `tests/vendor/services/vendor.service.test.js`
- Test: `tests/mapping/services/fulfillmentPlan.service.test.js`
- Test: `tests/finance/services/financeSnapshot.service.test.js`

**Interfaces:**
- `VendorCostCenter.costRateHistory[] = { version, effectiveFrom, effectiveTo, baseCostAmount, unitSurchargeAmount, domesticShipping, internationalShipping, priorityShipping, importTaxAmount, additionalCosts, currency }`.
- `FinanceSnapshot.costRateVersion` and `FinanceSnapshot.costRateEffectiveFrom` identify the rate-card used to calculate its copied `costLines`.
- `selectCostRate(costCenter, orderedAt)` returns the single active rate; it throws `COST_RATE_NOT_FOUND` or `COST_RATE_AMBIGUOUS` instead of selecting an arbitrary price.

- [ ] **Step 1: Write failing tests for effective-dated costs**

```js
const overlappingRateA = { version: 1, effectiveFrom: '2026-01-01', effectiveTo: '2026-06-30', baseCostAmount: 800 };
const overlappingRateB = { version: 2, effectiveFrom: '2026-06-01', effectiveTo: null, baseCostAmount: 1000 };
expect(selectCostRate(costCenter, new Date('2026-05-31'))).toMatchObject({ version: 1, baseCostAmount: 800 });
expect(selectCostRate(costCenter, new Date('2026-06-01'))).toMatchObject({ version: 2, baseCostAmount: 1000 });
await expect(updateVendorCostCenter(productId, costCenterId, {
  costRateHistory: [overlappingRateA, overlappingRateB],
}, auth)).rejects.toMatchObject({ code: 'COST_RATE_OVERLAP' });
expect(snapshot).toMatchObject({ costRateVersion: 1, costRateEffectiveFrom: new Date('2026-01-01') });
```

- [ ] **Step 2: Prove the tests fail**

Run: `npx jest tests/vendor/services/vendor.service.test.js tests/mapping/services/fulfillmentPlan.service.test.js tests/finance/services/financeSnapshot.service.test.js --runInBand`

Expected: FAIL because the cost centre has one mutable rate and snapshots do not identify an applied rate.

- [ ] **Step 3: Implement the append-only rate-card path**

```js
function selectCostRate(costCenter, orderedAt) {
  const date = new Date(orderedAt);
  const matches = (costCenter.costRateHistory || []).filter((rate) =>
    new Date(rate.effectiveFrom) <= date
    && (!rate.effectiveTo || date <= new Date(rate.effectiveTo)));
  if (matches.length !== 1) {
    throw validationError(matches.length ? 'COST_RATE_AMBIGUOUS' : 'COST_RATE_NOT_FOUND');
  }
  return matches[0];
}
```

Treat the present `VendorCostCenter` money fields as the initial version-1 rate during migration. All new cost changes append a non-overlapping effective-dated rate; mapping selects it with the order date and Finance copies its version into the snapshot. Recalculation for an old order must reproduce the same rate. Keep vendor-invoice cost out of this task; its absence means `costBasis: RATE_CARD` and `profitStatus: ESTIMATED`.

- [ ] **Step 4: Verify and commit**

Run: `npx jest tests/vendor/services/vendor.service.test.js tests/mapping/services/fulfillmentPlan.service.test.js tests/finance/services/financeSnapshot.service.test.js --runInBand`

Run: `git diff --check`

Run: `npm run backfill:vendor-cost-rate-history -- --dry-run`

Expected: tests pass, formatting is clean, and dry-run reports the candidate cost centres without writes. Require explicit approval before `--apply`.

Commit: `git add src/modules/vendor src/modules/mapping src/modules/finance tools/scripts/maintenance/backfillVendorCostRateHistory.js package.json tests/vendor tests/mapping tests/finance; git commit -m "feat(finance): preserve effective-dated vendor costs"`

## P2: Decision-support and finance operations

P2 starts only after Tasks 1-6 are released and the P&L quality indicators are trusted. It improves explainability and operations; it must not redefine financial source-of-truth or silently change profit.

### P2-A: Finance workspace becomes the operational control plane

**Finance owns:** source-file health, import/reprocess history, order-item profitability evidence, settlement-period cash movement, and reconciliation state.

- Add an import-batch history table to `FinanceWorkspacePage`: source type, period, file hash, parsed/accepted/rejected counts, status, failure reason, imported time, and a reprocess action. Reprocess must reuse the stored source asset; it never re-downloads Amazon.
- Add a rate-card history view under the existing vendor cost centre: effective period, version, costs, currency, and usage count. A rate used by a snapshot is read-only; correction is a new effective-dated version with an audit event.
- Add a profit evidence drawer from an order item: customer payment, fee confidence, refund, discount, fulfillment cost, `costBasis`, rate-card version, `profitStatus`, source references, and last recalculation time. A missing cost must remain visibly incomplete, never appear as zero.
- Keep the existing settlement page as a cash-flow workspace: statement period, payout, ledger net, variance, link coverage, import batch, and ledger drill-down. Add `UNRECONCILED`, `MATCHED`, and `INVESTIGATE` only when a human can record a bank/deposit reference; do not imply that Amazon settlement equals bank cash before that source exists.
- Do not introduce journal entries, a general ledger, or automatic bank matching in this phase. Those need separate accounting and bank-source decisions.

### P2-B: Report becomes a decision view, not a second Finance engine

**Report owns:** read-only aggregation, comparability, filtering, drill-down links, export, and data-quality disclosure. It never imports files or recalculates snapshots.

- Make the chosen date basis prominent in the P&L filter and every exported report: order date for profitability, posted date for settlement cash, report date for Ads. Never combine those time bases in one total without a label.
- Add a compact coverage strip above P&L: actual-profit items, estimated-profit items with fee/cost reasons, incomplete-cost items, rows excluded for missing business date, and the latest import/recalculation timestamps.
- Add drill-downs from every KPI/table row to the existing Finance order-item evidence and settlement ledger views, preserving the selected shop, scope, date basis, currency, and filters.
- Keep Ads grouped by currency; a cross-currency total is forbidden until an approved FX-rate source and rate date are available.
- Add product profitability by SKU/product only from `FinanceSnapshot`: revenue, configured COGS, Amazon fee, refund, gross profit, margin, status/coverage, and currency. Do not add product-level Ads or net profit until an explicit allocation rule is approved.
- Keep a cash-position report unavailable until PingPong and bank movements are imported. Before that, show the settlement cash-flow page only; it is Amazon payable/deposit evidence, not total company cash.
- Exports must include selected filters, date basis, currency, generated time, and coverage counters so CSV totals remain auditable outside the UI.

### P2-C: UI contract

Use the existing Ant Design pages and shared `MetricCard`, `StatusTag`, `SectionCard`, `FeedbackAlert`, drawers, tables, and filter controls; do not create a second dashboard framework.

| Screen | Primary user question | Required UI elements |
| --- | --- | --- |
| Finance imports | “Did this source reach the system correctly?” | Batch table, row counts, hash, status/reason, reprocess from stored asset |
| Vendor cost history | “Which rate applied to this order date?” | Effective-dated rate table, version, source/audit, usage count; no edit-in-place after use |
| Finance profitability | “Why is this order profitable, estimated, or incomplete?” | Status chip, value breakdown, source-reference drawer, missing-cost action |
| Settlement cash flow | “What did Amazon settle and can it be explained?” | Period table, payout vs ledger net, variance, link coverage, ledger drill-down |
| Reports P&L | “What is the reliable profit for this business period?” | Date-basis label, per-currency totals, coverage strip, link to Finance evidence |
| Reports product profitability | “Which SKU/product is economically healthy?” | Revenue, configured COGS, fees, refunds, gross profit, margin, status/coverage, drill-down |
| Reports Ads | “What was advertising spend for my authorized sellers?” | Scope label, per-currency grouping, empty/error state, no mixed-currency grand total |

**P2 acceptance checks:** a user can trace any displayed value to an imported batch, source reference, and applied cost-rate version; a user cannot mistake estimated/incomplete profit for actual profit; scoped users cannot see cross-shop cash; every export states how its totals were computed; product reporting does not imply that unallocated Ads are product net profit.

## P3: Accounting-ready cash position (approval required)

Do not start P3 merely because a settlement exists. Start it when PingPong and bank movement sources are available and Finance has approved the account chart, transfer matching, FX rate source, and close/reopen policy.

- Finance adds account-scoped cash movements for `AMAZON_PAYABLE`, `PINGPONG`, `BANK`, and `OPERATING_EXPENSE`, each with immutable source reference, posted date, currency, amount, and reconciliation status.
- A transfer is two linked movements, never one duplicated amount: Amazon payout → PingPong, PingPong → Bank, then bank receipt. Matching is proposed by reference/amount/date tolerance and approved by a Finance user; it must not auto-post.
- Report adds cash position and cash conversion views by account/currency, separate from P&L. It may show unmatched Amazon/PingPong/bank amounts, but cannot call them revenue or profit.
- Do not create a generic `GeneralLedgerEntry` before these sources and policies exist. `MarketplaceSettlementLedgerLine` is already the Amazon subledger; a generic GL without account semantics would duplicate it and make reconciliation harder.

## Self-review

- Tasks 1-3 establish business-date and confidence semantics.
- Task 4 separates settlement cash flow from order profit.
- Task 5 prevents malformed/duplicate source handling gaps, scopes Ads, preserves currency, and gives users quality indicators.
- Task 6 prevents later vendor-rate changes from silently rewriting historical profitability.
- P2 turns corrected data into an auditable operational and decision-support experience; it adds SKU gross-profit analysis but not unallocated product net profit.
- P3 is deliberately deferred until PingPong/bank sources and accounting policy exist; it avoids an empty generic general ledger.
- The plan intentionally excludes bank reconciliation, double-entry accounting, and unapproved order-level Ads allocation.

## Execution Handoff

Plan complete. Execute Tasks 1-6 only after approval gates are accepted; use isolated worktrees and finish each task's test cycle before moving to the next task. Start P2 after their production readback is trusted; start P3 only after its account-source approvals are made.
