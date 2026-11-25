# Cancelled order estimated fees

Cancelled items have zero net revenue. Do not apply the fallback 15% marketplace fee to them. Imported/settlement fees (including zero and credits) and actual vendor costs remain authoritative. No change to active or refunded orders.

## November 2026 repair

Scope: order date in Asia/Ho_Chi_Minh, `[2026-10-31T17:00:00Z, 2026-11-30T17:00:00Z)`.

From the application root:

```sh
node tools/scripts/maintenance/backfillCancelledEstimatedFees.js --database=lng_web_be
node tools/scripts/maintenance/backfillCancelledEstimatedFees.js --database=lng_web_be --apply --backup=/secure/path/cancelled-fees-before.json
```

The dry-run lists candidates. Apply requires a new backup file, checks source item cancellation and absence of actual fee evidence, and updates eligible snapshots in one transaction with timestamp guards. It changes only the estimated fee, calculated profit/margin, and calculation timestamps. Re-running after repair finds no candidates.

Audit cancelled **source items** as well: stale ACTIVE snapshots are intentionally not included in this narrow repair. Recalculate these through `finance.public.recalculateOrderItem`, then repeat the dry-run.

On 2026-11-25, production had 437 November orders and 7 cancelled items, all with snapshots. Two cancelled snapshots had estimated fees; one additional cancelled item still had an ACTIVE snapshot. The latter was recalculated through the Finance public port. All three were repaired:

| Order | Removed estimated fee | Final profit |
| --- | ---: | ---: |
| 112-0753152-6887435 | $6.41 | $0.00 |
| 112-7066722-0835422 | $10.01 | $0.00 |
| 114-4626604-1629053 | $7.78 | $0.00 |

Four other cancelled orders retain settlement fees totalling $1.83. Backups on the host: `/tmp/cancelled-fee-backup-20261125.json`, `/tmp/cancelled-stale-snapshot-20261125.json`, `/tmp/cancelled-fee-backup-stale-20261125.json` (mode 0600).

The data repair does not deploy application code. Until this fix is released, recalculation by the old service can reintroduce the fallback fee. Recheck the dry-run after release. Browser/UI rendering and Seller Central were not verified by this repair.
