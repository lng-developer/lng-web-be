# Vendor Product Canonicalization Design

## Goal

Prevent staff from selecting vendor products that do not match an order's resolved ListingVariant, and safely consolidate cost-center data duplicated across legacy and canonical VendorProducts.

## Current Evidence

- 193 VendorProducts exist in `lng_web_be`.
- 55 vendor-product identity groups span multiple Product Type Groups.
- 110 VendorProducts are affected.
- 7 identity groups have cost centers on more than one product.
- 4 identity groups have fulfillment or historical references.

VendorProduct identity is `vendorId + externalProductId`. Product names are display data and must not be used as migration identity.

## Runtime Contract

The order workbench exposes the resolved Product Type Group at:

```text
item.mapping.listingVariant.productTypeGroup.id
```

Vendor-product search accepts that value as `productTypeGroupId` and returns only active products belonging to the same group. The backend selection guard continues rejecting any mismatched product.

## Canonicalization

Canonical Product Type Groups come from an explicit legacy-to-canonical mapping. The migration must not infer canonical groups from product names.

For each `vendorId + externalProductId` identity:

1. Resolve the canonical Product Type Group.
2. Find the VendorProduct belonging to that group.
3. Copy/upsert legacy cost centers into the canonical VendorProduct.
4. Match cost centers by stable code.
5. Skip identical target rows.
6. Report differing size, color, price, shipping, tax, surcharge, status, or vendor ownership as conflicts; never overwrite them automatically.
7. Mark a legacy VendorProduct inactive only after all its cost centers are represented on the canonical product and no unresolved conflict remains.

Copy/upsert is used instead of moving rows so historical references remain valid during migration.

## Historical Data

Finance snapshots and vendor submissions are immutable and are not rewritten. Existing fulfillment plans are not bulk-repointed blindly. Blocked plans are rechecked after canonical data becomes available; active plans may be migrated only when product and cost-center equivalence is exact.

## Migration Safety

The migration is idempotent and supports:

```text
--dry-run
--apply
```

Both modes return counts for identities, copied rows, skipped rows, conflicts, deactivated products, affected active plans, and unchanged historical records. Apply stops before mutation when canonical mapping is missing or a target cost-center conflict exists.

## Prevention

- FE always sends the ListingVariant Product Type Group when loading vendor products.
- BE always applies the Product Type Group filter.
- Vendor imports upsert against canonical Product Type Group identity.
- A reusable audit command reports duplicate identities and unresolved conflicts.
- `SELECTED_VENDOR_PRODUCT_INVALID` remains the final integrity guard.

## Verification

- Unit tests cover API filtering, FE query parameters, canonical cost-center copying, idempotent reruns, conflicts, historical preservation, and legacy deactivation.
- Architecture tests confirm cross-module access remains through public ports.
- A DB dry-run must be reviewed before apply.
- After apply, recheck order `111-5676843-8053015` and verify manual selection reaches `READY` with canonical VendorProduct `6a5757dc002c71ac0195b510`.
