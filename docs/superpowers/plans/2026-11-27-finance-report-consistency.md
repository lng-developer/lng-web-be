# Finance, Order Cost & Reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This document does not authorize production writes, merges, or deployment.

**Goal:** Finance, Order Cost và Reports dùng cùng số tài chính, giải thích được nguồn số và đối chiếu được từ item đến báo cáo tổng.

**Architecture:** Finance sở hữu bộ tính và snapshot tài chính chuẩn ở cấp item. Vendor Submission cung cấp chi phí và chứng cứ phân bổ qua Finance public port; Reports tổng hợp snapshot, bổ sung ads/vận hành ở cấp phù hợp. FE chỉ trình bày dữ liệu chuẩn, không chọn lại nguồn chi phí hoặc tính lại lợi nhuận.

**Tech Stack:** Node.js/CommonJS, Mongoose, BullMQ, Jest; React, TypeScript, Ant Design, TanStack Query, Vitest.

**Spec:** Phần “Approved scope and financial contract” trong tài liệu này ghi lại chiến lược đã được người dùng đồng ý sau audit UI ngày 27/11/2026. Không mở rộng sang hệ thống kế toán mới.

## Global Constraints

- BE root: `C:/lng_system/lng-web/lng-web-be`; FE root: `C:/lng_system/lng-web/lng-web-fe`. Các đường dẫn dưới đây tương đối theo repo được ghi.
- Strict modular monolith: cross-module chỉ qua `public.js`; truy vấn trong repository; DTO không trả raw documents; query chỉ đọc dùng `.lean()`.
- Không thêm dependency; giữ cơ chế queue, guard, retry, audit và recalculation hiện có.
- Tiền lưu minor units nguyên; không cộng khác currency; không làm tròn trung gian bằng floating-point.
- FE dùng shared UI, i18n EN/VI và tokens hiện có; tests dưới `src/test/`.
- Giữ nguyên giao dịch/chứng từ gốc. Không chạy seed hoặc recalculate production trong lúc viết code/test.
- Bảo toàn dirty work hiện có; không stage chung. Branch `EC/*`, PR vào develop; chỉ promote develop lên main khi được yêu cầu. Không đi tắt hotfix vào main.
- Triển khai local ngày 27/11/2026; production chỉ dry-run. Không coi dữ liệu ngày 27/11 là đã khóa sổ.

## Review Focus

1. Retry/webhook đến lặp hoặc sai thứ tự không được nhân đôi chi phí hay ghi đè phiên bản mới bằng bản cũ (Task 2, 4).
2. Hủy/hoàn sau sản xuất vẫn giữ chi phí đã phát sinh; credit vendor chỉ trừ khi có chứng cứ (Task 1, 2).
3. Một đơn có item thuộc nhiều seller: filter chỉ cộng item thuộc phạm vi, order count là distinct trong phạm vi; không lấy seller đầu tiên để gán toàn bộ đơn (Task 3).
4. Thiếu snapshot, chi phí, ads hoặc currency mismatch không biến thành lợi nhuận hoàn chỉnh hoặc số 0 giả (Task 1, 3, 6).
5. Đổi trang, filter, timezone hoặc drill-down không làm đổi nghĩa và phạm vi số tổng (Task 3, 5, 6).

## Approved scope and financial contract

### Evidence baseline (audit, not a permanent fixture of production totals)

- BE audited main `5990e459`; FE audited main `d317bfce`.
- J2503, purchase date 21–27/11/2026, Asia/Ho_Chi_Minh: 60 orders / 78 items; 46 item fee estimates.
- Order `114-3015741-1650603`: stored vendor response total 3564 cents for 3 items, incorrectly copied to each item (10692 cents).
- Order Cost profit 4749 vs Finance detail -2129; detail waterfall shows estimated cost 3814 despite profit using actual 10692.
- Refund card shows 0 from current page vs 5185 across filter. Source: `ReportOrderCostPage.tsx` reduces `rows`.
- Order Cost calls pre-ads profit “Net profit”; sales report uses that label after ads. `report.service.js` also changes meaning of `grossProfitAmount` when adding ads/refunds.
- Single-item/order recalculation invalidates Finance queries but not Reports; bulk recalculation invalidates both.

### Canonical values

Add explicit fields rather than silently redefining existing fields during mixed BE/FE rollout:

| Field | Meaning |
|---|---|
| `estimatedFulfillmentCostAmount` | Historical rate-card estimate, nullable |
| `actualVendorTotalAmount` | Actual vendor charge attributable to this item, nullable |
| `effectiveFulfillmentCostAmount` | Vendor actual plus applicable non-overlapping internal costs; otherwise estimate; nullable |
| `profitBeforeAdsAmount` | Recognized net revenue minus marketplace fee minus effective fulfillment cost; nullable |
| `costSource` | `ACTUAL`, `ESTIMATED`, `MISSING` |
| `feeConfidence` | Preserve `ACTUAL`, `ALLOCATED`, `ESTIMATED`; separate from cost source |
| `profitStatus` | `ACTUAL`, `ESTIMATED`, `INCOMPLETE_COST`; ACTUAL requires sufficient fee and cost evidence |
| `calculationVersion` | New formula version: 2 |
| `calculatedAt` | Time the whole canonical snapshot was computed |

- Canonical revenue breakdown: product + customer shipping, minus discount once, minus refund once, with canceled revenue treatment explicit. Confirm each import adapter's amounts are gross/net before mapping; retain legacy `netRevenueAmount` semantics during transition and expose an explicit canonical net-revenue field if different.
- Taxes/gift-wrap: map their existing source semantics before including/excluding amounts; add fixtures proving no double counting. Do not assume marketplace-collected tax is merchant revenue.
- `effectiveFulfillmentCostAmount` must equal its displayed component sum. Internal markup/service fee is a separate component, not hidden by reducing vendor shipping.
- A vendor order total is allocated once. Prefer vendor item amounts; allocate common fees by item cost weight. When only total exists, use stored positive estimate weights; if unavailable use fulfillment quantities; reject ambiguous membership/currency rather than guess. Distribute residual cents deterministically by remainder and stable item ID.
- Store allocation provenance: vendor order identity, original total/currency, item shares, basis, source time/version. Reuse existing submission source response as evidence; no new general ledger.
- `ALLOCATED` means known order-level fee with estimated attribution; show it separately and conservatively keep item profit ESTIMATED.
- Missing cost => final profit null, known partial totals explicitly labeled. Confirmed zero is valid. Missing ads coverage is not confirmed zero spend.
- Reports: `profitAfterAdsAmount = SUM(profitBeforeAdsAmount) - adSpendAmount`; `profitAfterOperatingCostsAmount = profitAfterAdsAmount - operatingCostAmount`. Refund is already deducted and must not be deducted again.
- Money summaries are per currency, based on all filtered items; order count distinct, item count explicit. Margin = total profit / agreed gross-sales denominator, not average item margins.
- Profit reports use purchase date and Asia/Ho_Chi_Minh, half-open ranges. Cash Flow/Settlement use their respective event dates and remain separate.
- Snapshot is a current materialized calculation with history, not an immutable accounting-period close. Historical refund/cost changes can restate purchase-date reports.

### UI responsibilities

- Order Cost: estimate, vendor actual, effective cost, variance, allocation and evidence. Profit is a linked Finance value if retained.
- Finance Order P&L: one order row, expandable item rows; canonical revenue/fee/refund/cost/profit waterfall and provenance.
- Reports: aggregate by day/seller/shop/team; separate pre-ads, ads, operating costs and post-cost profit; drill-down carries filter.
- Keep Settlement/Payouts, Cash Flow/Exceptions and Transaction Ledger as distinct existing workflows. No payout/bank reconciliation rewrite.

## Task 1: One canonical Finance calculation

**Files (BE):**
- Create `src/modules/finance/services/financeCalculation.service.js` (pure money calculation).
- Modify `src/modules/finance/services/financeSnapshot.service.js`, `models/financeSnapshot.model.js`, `dtos/financeSnapshot.dto.js` under Finance.
- Test `tests/finance/services/financeCalculation.service.test.js` (new), `tests/finance/services/financeSnapshot.service.test.js`.

**Interfaces:** `calculateFinancials({ revenue, fee, estimate, actualVendorCost, internalCosts, financialStatus })` returns canonical amounts, cost components, sources and profit status above. Define the normalized input in JSDoc alongside the function; no database calls. All writer/read DTO paths use this one calculation contract.

- [ ] Add red tests: net revenue 9240, fee 677, vendor cost 3564, no internal cost => pre-ads profit 4999; unknown cost => null; actual 0 remains 0; estimated fee + actual cost => ESTIMATED.
- [ ] Add fixtures for discount already net vs separately reported, fee credits, partial/full refunds, cancellation after production retaining actual cost, and tax/gift-wrap semantics from import adapters.
- [ ] Run `npm test -- --runInBand tests/finance/services/financeCalculation.service.test.js` and capture failing assertions.
- [x] Implement the pure calculator and version-2 snapshot fields. Route initial calculation, vendor update, recalculation and DTO breakdown through it; preserve order guards and original source values.
- [x] Assert displayed breakdown components sum to effective cost and waterfall ends at the exact stored profit.
- [ ] Run both affected service suites; inspect diff, commit only task files: `refactor(finance): centralize canonical item profitability`.

## Task 2: Allocate bundled vendor charges correctly

**Files (BE):**
- Modify `src/modules/vendorSubmission/services/vendorSubmission.service.js`, `models/vendorSubmission.model.js` and `repositories/vendorSubmission.repository.js` as needed for provenance.
- Create `src/modules/vendorSubmission/services/vendorCostAllocation.service.js` (pure allocation).
- Modify `src/modules/finance/public.js` only if the existing `updateActualVendorCost` payload needs additive allocation metadata; update all callers together.
- Tests: `tests/vendorSubmission/services/vendorCostAllocation.service.test.js` (new), `tests/vendorSubmission/services/vendorSubmission.service.test.js`.

**Interfaces:** `allocateVendorOrderCost({ vendorOrderId, currency, totalAmount, items, sourceVersion })` returns `{ allocations: [{ orderItemId, totalAmount, components }], provenance }`. Finance receives item shares through its public port, never the whole bundled total per sibling.

- [x] Before schema/public-port edits, use CodeGraph to enumerate all cost writers/callers, including retry, webhook and provider adapters.
- [x] Write tests: 3564 total / three equal weights => [1188,1188,1188]; 100 / three equal weights => [34,33,33] with stable tie-break; unequal weights preserve total; duplicate event does not increase cost.
- [x] Add negative tests for currency mismatch, missing bundle members, stale response, zero total, vendor credit and replacement/retry identity. Canceled attempts must not erase separately incurred charges.
- [ ] Run new allocation test red, replace copy-to-sibling behavior with one allocation, persist evidence and update all affected item snapshots.
- [x] Verify retry after partial failure converges without double charge and preserves existing provider submission/idempotency behavior.
- [ ] Run `npm test -- --runInBand tests/vendorSubmission/services/vendorCostAllocation.service.test.js tests/vendorSubmission/services/vendorSubmission.service.test.js`; commit `fix(vendor-submission): allocate bundled vendor costs per item`.

## Task 3: Canonical aggregation and response contract

**Files (BE):**
- Modify `src/modules/finance/repositories/financeSnapshot.repository.js`, `services/financeSnapshot.service.js`, `dtos/financeSnapshot.dto.js`.
- Modify `src/modules/report/services/report.service.js`, `dtos/report.dto.js`, relevant existing validators/controllers for additive filter fields only.
- Tests: `tests/finance/repositories/financeSnapshot.repository.test.js`, `tests/report/services/report.service.test.js`, `tests/finance/financeReportingConsistency.persistence.test.js` (new).

**Interfaces:** Existing Finance list/detail and Reports endpoints return canonical money fields, per-currency full-filter summary, order/item counts, coverage, date basis/timezone and calculation metadata. Order-level grouping uses matching item snapshots and shared Finance aggregation logic; Reports accesses it through Finance public ports.

- [ ] Add red persistence test: SUM matching item profit = order summary = daily = seller summary before ads; include multiple sellers in one order, two currencies, missing snapshot/cost and canceled/refunded items.
- [ ] Remove independent report profit formulas based on legacy `totalCostAmount`. Aggregate canonical effective cost/profit instead, and keep raw estimate separately.
- [x] Compute refund, fee, costs and profit summaries before pagination with identical filters. Fix status/count mappings through service/DTO, not just UI fallback labels.
- [ ] Add explicit pre/post ads fields; stop repurposing `grossProfitAmount`. Ads and operating cost must respect scope; unsupported allocation scope exposes unavailable post-ads result rather than subtracting unrelated full spend.
- [x] Make order summary/waterfall/CSV read the same fields. Keep additive legacy compatibility until FE migration; mark old fields deprecated in contract documentation.
- [x] Test page 1 vs page 2 has identical totals; timezone edges; report filters preserved; null propagation and partial totals; scoped RBAC unchanged.
- [ ] Run `npm test -- --runInBand tests/finance/repositories/financeSnapshot.repository.test.js tests/report/services/report.service.test.js tests/finance/financeReportingConsistency.persistence.test.js`; commit `fix(report): aggregate canonical finance snapshots`.

## Task 4: Reliable refresh and historical correction tool

**Files (BE):**
- Modify Finance recalculation service/worker paths discovered through `financeSnapshot.worker.js`; reuse existing request/queue infrastructure.
- Create `src/modules/finance/scripts/backfillCanonicalFinance.js` and `tests/finance/backfillCanonicalFinance.test.js`.
- Extend `tests/finance/workers/financeSnapshot.worker.test.js`, `tests/finance/financeSnapshot.audit.persistence.test.js`.

**Interfaces:** CLI defaults to dry-run; flags `--seller`, `--from`, `--to`, `--expect-database`, `--apply`, `--resume`, `--output`. Produces per-order before/after canonical differences, source IDs, skipped reasons and failed/retry counts. Version-2 writes are guarded and idempotent.

- [x] Add tests for fee/refund/vendor updates triggering affected snapshots, stale event rejection, retry convergence and audit version/time updates.
- [x] Add dry-run tests proving zero DB mutations, wrong expected database rejection, resumable batches, already-correct no-op, and source ambiguity => skip/report.
- [x] Implement scoped source repair plus recalculation through established services; preserve original transaction amounts and vendor responses. Never infer every repeated amount is a duplicate without bundle evidence.
- [x] Store restorable before-images and change manifest; rollback restores source-derived corrections only if current revision still matches the applied revision, then recalculates with the chosen formula version.
- [ ] Run `npm test -- --runInBand tests/finance/backfillCanonicalFinance.test.js tests/finance/workers/financeSnapshot.worker.test.js tests/finance/financeSnapshot.audit.persistence.test.js`; commit `feat(finance): add scoped canonical snapshot backfill`.

## Task 5: Finance and Order Cost consume the same values

**Files (FE):**
- Modify `src/features/portal/finance/api/financeApi.ts`, `api/financeKeys.ts`, `hooks/useFinanceWorkspace.ts`, `hooks/useFinanceMutations.ts`.
- Modify `pages/FinanceWorkspacePage.tsx`, `components/FinanceCurrencySummary.tsx`, `components/FinanceOrderDetailModal.tsx`, `components/FinanceItemSnapshotModal.tsx` under Finance.
- Modify `src/features/portal/reports/api/reportApi.ts`, `pages/ReportOrderCostPage.tsx`.
- Update finance/report EN+VI locale files and related source-local styles only as necessary.
- Tests: existing `src/test/portal/finance/pages/FinanceWorkspacePage.test.tsx`; create `src/test/portal/finance/components/FinanceOrderDetailModal.test.tsx`, `src/test/portal/reports/pages/ReportOrderCostPage.test.tsx`, `src/test/portal/finance/hooks/useFinanceMutations.test.tsx`.

**Interfaces:** Consume Task 3 canonical fields; use existing detail drawer for both entry points. Shared display types stay in Finance's existing API domain, not a new generic money framework.

- [ ] Add failing UI fixtures: list and detail show identical pre-ads profit; waterfall adds up; 5185 refund appears even if refunded order is on page 2; unknown differs from zero; all currencies visible.
- [x] Finance default becomes order grouping with item expansion. Preserve item-specific inspect/recalculate actions, scoped permissions and direct order links.
- [x] Order Cost displays estimate/actual/effective cost and variance with provenance tooltip/drawer; remove duplicated formula and unqualified “All costs captured”.
- [x] Show fee ACTUAL/ALLOCATED/ESTIMATED separately from cost source; label profit “Lợi nhuận trước ads” / “Profit before ads”.
- [x] Make single, item and bulk recalculation invalidate Finance list/detail and Reports consistently; handle async job completion before claiming freshness.
- [x] Preserve selected filters in URL and carry them on drill-down; add shop/marketplace parity where missing and explicit date/timezone labels.
- [ ] Run `npm run test:ui -- src/test/portal/finance src/test/portal/reports/pages/ReportOrderCostPage.test.tsx`; commit `fix(finance): align order cost and pnl displays`.

## Task 6: Reports semantics and reconciliation navigation

**Files (FE):**
- Modify `src/features/portal/reports/pages/ReportWorkspacePage.tsx`, `hooks/useReportData.ts`, `components/ReportCoverageStrip.tsx`, `components/ReportSalesTab.tsx`, `components/ReportTeamTab.tsx`, relevant charts/formatters and report locales.
- Extend `src/test/portal/reports/pages/ReportWorkspacePage.test.tsx`, `src/test/portal/reports/api/reportApi.test.ts`, related component tests.

**Interfaces:** Reports uses Task 3 pre-ads/post-ads/post-operating fields and coverage; drill-down opens Finance with the same filter and currency. Transactions/settlements remain event-date views, not a second P&L.

- [x] Add tests for pre-ads 4999, ads 1000, operating 200 => displayed 4999 / 3999 / 3799; refund already deducted is not deducted a second time.
- [x] Replace ambiguous gross/net labels in cards, daily matrix, seller/team rows, charts, tooltips and CSV labels.
- [x] Show missing/estimated coverage and updated-at; missing ads is unavailable, confirmed zero is 0. Do not show partial matrix totals as complete.
- [ ] Add drill-down tests preserving seller/shop/date/currency and ensuring UI totals equal exported values across page sizes.
- [x] Keep existing settlement/bank distinction and Transaction Ledger source data unchanged; add explanatory links only where needed.
- [ ] Run `npm run test:ui -- src/test/portal/reports` and `npm run test:unit -- src/test/portal/reports`; commit `refactor(reports): clarify profit stages and drilldown`.

## Task 7: Integrated verification and controlled release

- [ ] BE: `npm test -- --runInBand tests/finance tests/report tests/vendorSubmission` and `npm run test:architecture -- --runInBand`. Run changed JS syntax checks. Full required CI suites must pass before merge.
- [ ] FE: `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:ci`. Review shared-contract callers with CodeGraph and inspect both diffs.
- [ ] Browser UAT on dev: same seller/date/shop/currency in Finance, Order Cost, Reports; open detail, change page, export, recalculate and revisit. Validate labels, nulls, EN/VI, dense layout and scoped seller permissions.
- [ ] Stage migration: deploy backward-compatible BE first; shadow-calculate v2 and compare on dev. New readers must not silently mix v1/v2 amounts; incomplete migration exposes pending coverage or uses one consistent compatibility path.
- [ ] Production gate: present exact host/database, candidate counts and dry-run before/after report for J2503 to user. Do not apply until production backfill is authorized. Existing earlier backfill authorization does not cover this new correction.
- [ ] Once authorized, apply scoped correction for J2503 then independently verify original totals unchanged, cost allocations conserved and all views equal. Broaden only to the reviewed affected population; log skips and failures.
- [ ] Promote FE canonical readers after BE/data readiness; roll out wider rebuild in bounded resumable batches. Do not report completion while mixed-version coverage remains unexplained.
- [ ] Release via develop PR then develop → main PR after explicit merge authorization; monitor final CI and deployment SHAs for both repos.
- [ ] Rollback: preserve v1/source fields through rollout. Revert readers if needed, stop the backfill, and use guarded manifest restoration; code rollback alone does not undo money corrections.
- [ ] Clean up only merged task branches/worktrees after verifying containment and preserving unrelated work.

## Acceptance checklist

- [ ] Vendor order 3564 cents remains 3564 summed allocated vendor cost, with no duplicate charge across siblings/retries.
- [ ] Each snapshot satisfies its displayed waterfall; internal costs are separate and not lost.
- [ ] With the same scope/currency/date basis, item sum = order sum = day sum = seller sum = CSV before ads; distinct-order counts are explicitly non-additive across seller groups when one order spans sellers.
- [ ] No page-dependent summary, mixed-currency total, hidden estimated fee or false zero from missing data.
- [ ] Single-item recalculation refreshes dependent views, and jobs report pending/failed status honestly.
- [ ] Original imported fee/refund/vendor source totals and settlement cash data remain unchanged; all corrections have evidence and a rollback manifest.
- [ ] J2503 baseline is independently re-audited after application, not merely compared against earlier buggy totals.

## Execution boundaries and handoff

Tasks 1–4 establish BE contract/data correctness, Tasks 5–6 migrate FE, Task 7 gates integration and production. Commit boundaries are reviewable chunks, not permission to deploy partial incompatible states. Reuse current checkouts when safe; no new worktree required for this plan. No runtime implementation, commit, push, merge or production mutation is part of the plan-writing request.

## Implementation checkpoint — 27 November 2026

Local BE/FE implementation and one final review fix pass are recorded in the task ledger. Runtime contract and the reviewed production preview are documented in `docs/finance-canonical-contract.md`. Task commits are consolidated per repository because the canonical contract, readers and allocation are interdependent.

The revised candidate dry-run is 78 READY snapshots / 60 orders; target vendor total is conserved at 3564 cents and pre-ads profit is 4999 cents. Production still has 78 version-1 snapshots; no apply, merge, deploy or browser UAT has occurred. Production/release checkboxes intentionally remain open.

Compatibility ruling: legacy report fields stay deprecated during staged rollout; new readers use explicit stages. Source coverage warnings invalidate complete totals; existing snapshot list pagination is retained. Known partial Order Cost subtotals in incomplete orders remain deferred and documented.
