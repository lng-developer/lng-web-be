# Small order search and index batch

Scope accepted from the index audit: optimize full Amazon order IDs in the dedicated orderId filter, keeping partial/general searches unchanged in both source and workbench projection repositories. Add four global list indexes (production updatedAt; shipments/vendor submissions updatedAt + _id; finance calculatedAt + _id). Retain all existing indexes. Synchronize four known missing dev indexes already present in production (finance requests, fulfillment requests x2, refund allocations).

1. Add regression tests for full IDs, whitespace, partial IDs and source/projection filter parity.
2. Add model declarations and an explicit additive, dry-run-by-default maintenance script. Check ordered keys and options, preflight all definitions, require the exact database name, preserve existing indexes, and report rollback commands only for indexes actually created.
3. Test script with temporary Mongo: dry-run, apply, repeat apply, mismatched target/definition and execution plans. Run affected npm tests and architecture checks.
4. Apply only this eight-index batch to lng_web_be_develop, compare executionStats before/after and preserve the receipt. No production mutation or index deletion.
5. Open PR into develop, verify CI; await authorization before merging. No manual deploy from PR. Test vendor retry behavior through automated tests without real outbound calls.

Production promotion and removal of redundant indexes are separate steps. Broad text search and other marketplace ID heuristics are not changed.

## Operations and measured dev result

Dry-run: `APP_ENV=development node tools/scripts/maintenance/applyOrderListIndexes.js --database=lng_web_be_develop`

Apply: append `--apply`. Capture stdout as a receipt. It emits database-qualified rollback commands only for indexes created by this invocation. Do not execute rollback against another cluster; the receipt identifies the database, not the server. Existing index definitions are never replaced. A rerun skips matching definitions. If a later index build fails, earlier successful builds remain and their rollback lines are already in the receipt.

Applied the eight-index batch on 2026-11-25 to lng_web_be_develop only, using the reviewed standalone script without deploying the PR code. ExecutionStats at limit 50, without hints:

| List | Documents examined before | After | Returned |
| --- | ---: | ---: | ---: |
| Production | 506 | 50 | 50 |
| Shipments | 392 | 50 | 50 |
| Finance | 548 | 50 | 50 |
| Active vendor submissions | 380 | 53 | 50 |

All four use IXSCAN without blocking SORT after the batch. Full-order-ID equality reads 1 document compared with 484 for the existing regex on dev; this query comparison does not imply the search code is deployed. Dataset is small; no load benchmark or production mutation was performed.
