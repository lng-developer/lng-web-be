# Reconcile the legacy unique listing SKU index

Production retained a unique `(shopId, salesChannelCode, marketplaceCode, sku)` index although the listing schema defines it as non-unique. Distinct Etsy listing IDs may share a SKU. Reusing a different listing by SKU would attach the wrong product/design identity.

Run the targeted script from the repository:

```
node tools/scripts/maintenance/reconcileListingSkuIndex.js --database=lng_web_be
node tools/scripts/maintenance/reconcileListingSkuIndex.js --database=lng_web_be --apply
```

Dry run is the default. Apply requires the exact canonical unique Etsy listing-ID and Amazon ASIN indexes. It builds a temporary covering lookup, replaces only the legacy SKU index and verifies the result. It does not change listing documents. Do not use broad syncIndexes on production.

After distinct listings share a SKU, restoring the obsolete unique index is not a valid rollback. Preserve canonical identities and fix forward; never merge/delete listings to recreate that constraint.

On 2026-11-25 this repaired order 4245997877: five failed records were retried through the existing import service, all five linked to Etsy listing 4581523210, while listing 4577661878 was preserved. The other three successful records were unchanged. All eight post-import records completed and the original duplicate issue was resolved with an operator note. The extension command remains a historical failed attempt; no new vendor submission was requested.

Validation: 75 tests across targeted real MongoDB migration, catalog service and Etsy end-to-end persistence suites.
