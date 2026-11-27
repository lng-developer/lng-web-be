# Transaction fee allocation and historical backfill

Transaction imports keep the original ledger and fee amounts. When a transaction has only an external order ID and matches an order with multiple items, the ledger links to the order and each fee row stores allocations instead of duplicating the original fee row.

Allocation uses itemPriceAmount less itemPromotionDiscountAmount (these are line totals, not unit prices). If any item value is missing, or all weights are zero, use marketplaceQuantity; legacy quantity is allowed only without a production quantity override. Currency mismatches, missing identities or unavailable weights are left unresolved. Signed fees/credits use integer cents and largest remainders, with item ID tie-breaking. Direct item fee rows retain precedence for their own transaction identity and are not rewritten by the backfill.

Snapshots sum the allocated share, record ALLOCATED confidence, and preserve source evidence. Profit remains estimated when fee attribution is allocated. The ledger and cash-flow totals retain the original full transaction amount. Existing order-item prices continue to supply revenue; the transaction net amount is not added as another revenue source.

## Release and backfill

Deploy the allocation-aware backend before applying the backfill: old workers cannot read allocations. Follow the normal approved develop -> main release flow. Create the declared finance indexes with `npm run indexes:finance-import` on the verified target environment.

Read-only preview (uses configured MongoDB, no auto index/schema creation):

```sh
node src/modules/finance/scripts/backfillTransactionFees.js --expect-database lng_web_be
```

The output reports the actual DB and cutoff ID. Retain that cutoff and preview output. Optional `--shop <ObjectId>` narrows to one shop. After deployment, apply the same preview scope:

```sh
node src/modules/finance/scripts/backfillTransactionFees.js --apply --expect-database lng_web_be --before <preview-cutoff-id>
```

The script scans order-only TRANSACTION ledger rows in cursor pages, conditionally writes fee allocations and order links atomically with audit evidence, then recalculates each affected order through the existing audited snapshot service. Existing explicit-item rows and all original amounts remain unchanged. A rerun does not create extra ledger/fee rows; it can retry failed recalculations. Import-batch counters remain the historical import result; the transaction Unlinked filter reflects current links.

Review `unresolved` and `failed` separately. Missing-order rows must first have their matching order imported; never distribute their money to an unrelated order. Check that per-fee allocation sums equal totalFeeAmount, affected snapshots have ALLOCATED confidence, and all requested recalculations succeed.

## Production preview, 2026-11-27

DB `lng_web_be`; cutoff `6b09340cf64a13eda701a52f`; all shops. 819 order-only transactions checked, 33 eligible fee rows across 30 orders / 71 items. 786 rows have no exact shop/channel/marketplace/order match; zero execution failures. No production writes performed during preview.
