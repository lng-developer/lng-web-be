# Finance calculation version 2

Finance owns persisted item calculations. Reports aggregates the same effective cost and profit; it does not select another cost source. All amounts are integer minor units and totals are separated by currency.

## Amounts and compatibility

- `totalCostAmount` on the stored snapshot remains the historical estimate. `estimatedFulfillmentCostAmount` exposes it in the revenue currency; explicit currency mismatches return null while raw estimate/currency evidence is preserved.
- `effectiveFulfillmentCostAmount` uses an evidenced vendor charge plus explicit internal LNG fees; otherwise it uses the estimate. Missing cost remains null. Confirmed zero and negative credits are valid.
- `recognizedNetRevenueAmount` is product plus customer shipping, less separately reported discount and refund. Cancelled revenue is zero. Tax and gift-wrap remain separate under the existing import policy; this release does not change their revenue treatment. Etsy imported net item totals are not discounted a second time.
- `profitBeforeAdsAmount` is recognized revenue less marketplace fees and effective fulfillment cost.
- `profitAfterAdsAmount` and `profitAfterOperatingCostsAmount` are explicit report stages. Missing coverage produces null. Account operating cost is configured in USD; unsupported shop/channel/currency allocation is unavailable rather than charged in full to each slice.
- `costComponents` sums to effective cost. Vendor shipping is not reduced by an implicit markup. Bundle shares conserve the original vendor total with deterministic residual-cent allocation and retain vendor order identity and membership.
- `feeConfidence=ALLOCATED` retains estimated item attribution even though the order fee is known. It is not `ACTUAL` item evidence.
- Legacy report `grossProfitAmount` / `netProfitAmount` are deprecated compatibility fields. New UI reads the explicit stages and their margins. Version-1 snapshot readers retain the persisted result and expose migration coverage until rebuilt.

Finance list `groupBy=ORDER` paginates internal order/currency groups with matching item children. Detail accepts the same shop, seller, team, currency and date filters. CSV exports item rows across repository pages. Order counts are distinct within a scope and are not additive across sellers when one order belongs to several sellers. Profit reports use purchase date and Asia/Ho_Chi_Minh; settlement and cash-flow event dates are unchanged.

## Scoped correction

Run from the backend root with the intended environment. The CLI prints the actual database and refuses a mismatched expected database. Default mode only reads source records and writes a private manifest.

```sh
APP_ENV=production BACKGROUND_JOBS_ENABLED=false node src/modules/finance/scripts/backfillCanonicalFinance.js \
  --seller J2503 --from 2026-11-21 --to 2026-11-27 \
  --expect-database lng_web_be --output /secure/new-preview.json
```

Review every READY/SKIPPED entry. Apply requires `--apply --resume /secure/new-preview.json --output /secure/apply.json` with the identical scope. It rebuilds sources again, compares the reviewed result, and uses the existing order guard plus revision CAS. Audit and calculation history accompany each write. An interrupted APPLYING entry is reconciled from the persisted revision. FAILED/CONFLICT entries require a fresh reviewed preview; they are not blindly retried.

Rollback uses `--rollback --resume /secure/apply.json --output /secure/rollback.json` with the identical scope. It restores the before-image only while the applied revision still matches, records an audit event, and resumes an interrupted rollback. Concurrent changes cause a conflict rather than being overwritten. Original fee/refund transactions and vendor responses are never rewritten. Derived vendor-submission costs converge through submission replay; this tool corrects Finance snapshots only.

## Production preview, 27 November 2026

Read-only preview on `lng-web-prod`, database `lng_web_be`: 78 READY item snapshots / 60 orders for J2503, purchase dates 21–27 November (Vietnam time). No production apply was performed.

Vendor order `114-3015741-1650603-R2`: original vendor total 3564 cents, three item shares of 1188; summed actual cost changes from 10692 to 3564. Correct pre-ads profit is 4999 cents.

Coverage still includes 46 estimated fees, 13 allocated fees and one missing cost. Known-profit subtotals are 101555 before and 107981 after; neither is a complete final-profit total while cost is missing. Private manifests stay on the host, outside Git.

Release BE first, review coverage and scoped dry-run, obtain approval for the production apply, then promote FE canonical readers. Browser UAT on deployed dev and production apply/verification remain release gates; passing local tests is not evidence of deployment.

## Completeness and concurrency

All snapshot writers use the order transaction guard independently of the durable-queue feature flag. Older vendor events are ignored; identical evidence preserves snapshot revision/history. A preview of an already-submitted vendor order performs no handoff or cost repair.

ORDERED_AT coverage compares snapshots with source order items through the Order public port in pages of 500. Missing snapshots are counted separately, exposed in order detail, and invalidate affected complete cost/profit totals. List pagination still lists existing snapshots; its warning identifies source items outside that list. CALCULATED_AT intentionally includes only items with a calculation timestamp. Snapshot-dependent filters cannot prove the final financial state of an uncalculated source item; missing coverage conservatively prevents claiming a complete total. Source-only groups have unavailable final profit; amounts from existing snapshots are known subtotals while the warning is present.

A read-only source coverage check on the reviewed candidate returned 78 items, zero missing snapshots and 78 version-1 snapshots for J2503 (412 ms). This is stored coverage, not a claim that version-1 calculations are correct. The reviewed dry-run independently rebuilt all 78 and found one missing cost. No production data was written.

Known limit: partial Order Cost subtotals currently sum complete orders; known items inside an incomplete order remain available in detail. Complete totals are null. Extend partial-subtotal semantics only with a clearly labeled UI contract.

Ads coverage requires every contributing seller and day. Team operating-cost allocation remains unavailable. Reports show separate currency totals and use Vietnam calendar boundaries regardless of browser timezone.
