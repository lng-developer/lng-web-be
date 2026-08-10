# Catalog Module

`catalog` owns internal product master data used by later mapping and production phases. It does not own orders, customer customization payloads, vendor products, fulfillment plans, or production tasks.

## Current Scope

Implemented V1 concepts:

- `ProductTypeGroup`: product family/group metadata.
- `Listing`: shop/channel/marketplace scoped sellable listing metadata.
- `InternalTemplate`: internal system template for customer input fields, artwork slots, validation rules, and design asset references.

Deferred concepts:

- `VendorProduct`
- `VendorProductTemplate`
- `Mapping` / `FulfillmentPlan`
- `ProductionTask`
- order enrichment from catalog
- catalog CSV/Excel import

## Ownership

| Concept | Owner | Notes |
| --- | --- | --- |
| `ProductTypeGroup` | `catalog` | Global product grouping metadata. Must stay vendor-neutral. |
| `Listing` | `catalog` | Scoped by `shopId + salesChannelCode + marketplaceCode + sku`. |
| `InternalTemplate` | `catalog` | Internal template for customer inputs, artwork slots, validation, and design asset references. |
| Binary design files | `media` | Catalog stores only `mediaAssetId` references. |
| Vendor products/templates | future `vendor` | Vendor-specific IDs, payload rules, print areas, and file requirements do not belong in catalog V1. |
| Mapping/FulfillmentPlan | future `mapping` | Resolves order item + catalog + customization + vendor data later. |

## Boundary Rules

- Catalog may call `media/public.js` only to validate or read media references.
- Catalog must not import media models, repositories, services, controllers, validators, routes, or DTOs.
- Catalog must not import `order`, `customization`, `vendor`, `mapping`, `production`, `vendorSubmission`, or `shipment` internals.
- `media` must not import catalog internals.
- Cross-module calls must go through `public.js`.
- No Amazon SP-API concepts belong in catalog.

Allowed:

```js
const mediaPublic = require('../../media/public');
```

Forbidden:

```js
const MediaAsset = require('../../media/models/mediaAsset.model');
```

## Listing Rules

`Listing.sku` is not globally unique. It is unique only within:

```text
shopId + salesChannelCode + marketplaceCode + sku
```

`catalog.public.findListingBySku()` must use the full identity:

```js
catalog.public.findListingBySku({
  shopId,
  salesChannelCode,
  marketplaceCode,
  sku,
});
```

Rules:

- return `ACTIVE` listing only.
- return `null` for missing or inactive listing.
- normalize `salesChannelCode`, `marketplaceCode`, and `sku` before lookup.
- listing APIs must enforce `CATALOG:READ` / `CATALOG:WRITE` and shop-scoped RBAC.
- `PATCH Listing` must not change identity fields: `shopId`, `salesChannelCode`, `marketplaceCode`, `sku`.

`baseCostAmount` is only a V1 internal estimate in integer minor units. Future `VendorProduct` cost becomes source of truth.

## InternalTemplate Rules

`InternalTemplate` is an internal system template, not a vendor template.

It may define:

- required customer fields
- artwork slots
- validation metadata
- design asset references by `mediaAssetId`

It must not define:

- vendor product IDs
- vendor-specific payload fields
- vendor print area mapping
- vendor file submission requirements
- production task state

Design assets:

- store only `mediaAssetId`.
- never store binary content.
- never store local filesystem paths.
- never expose `localPath` in API responses.
- validate referenced media through `media.public`.

`InternalTemplate.productTypeGroupId` must reference an active `ProductTypeGroup` on create/update. If a `Listing.internalTemplateId` is set, the template product type group must match the listing product type group.

## Public Ports

Current catalog public ports:

```js
findListingBySku({ shopId, salesChannelCode, marketplaceCode, sku })
getListingById(listingId)
getProductTypeGroupById(productTypeGroupId)
getInternalTemplateById(internalTemplateId)
findInternalTemplateByCode(code)
getInternalTemplateForListing(listingId)
```

Public lookup methods should return `null` for missing or inactive catalog resources unless the HTTP API requires a controlled `404`.

## API Routes

Current routes:

```text
GET    /api/catalog/product-type-groups
POST   /api/catalog/product-type-groups
PATCH  /api/catalog/product-type-groups/:id

GET    /api/catalog/listings
GET    /api/catalog/listings/summary
GET    /api/catalog/listings/:id
POST   /api/catalog/listings
POST   /api/catalog/listings/:id/approve
POST   /api/catalog/listings/:id/reject
POST   /api/catalog/listings/:id/psd-template
PATCH  /api/catalog/listings/:id

GET    /api/catalog/internal-templates
GET    /api/catalog/internal-templates/:id
POST   /api/catalog/internal-templates
PATCH  /api/catalog/internal-templates/:id
```

`POST /api/catalog/listings/:id/psd-template` is admin/backfill only and requires global `CATALOG:WRITE`. Normal PSD creation must go through `design` task submit/approve.

## File Organization

Catalog code should stay split by domain:

```text
constants/
controllers/
dtos/
models/
repositories/
services/
validators/
```

Keep aggregate files such as `catalog.service.js`, `catalog.dto.js`, `catalog.validator.js`, and `catalog.constants.js` as compatibility barrels only. Put domain logic in focused files like `listing.service.js` or `internalTemplate.validator.js`.

## Next Phase Order

Recommended order:

1. Catalog Listing and InternalTemplate stability.
2. VendorProduct and VendorProductTemplate in `vendor`.
3. Mapping/FulfillmentPlan in `mapping`.
4. ProductionTask in `production`.
5. Order enrichment only after mapping has a clear public contract.

Do not collapse these phases into catalog.

## Verification

For catalog changes, run:

```powershell
npx jest tests/catalog --runInBand
npx jest tests/media --runInBand
npm run test:architecture -- --runInBand
Get-ChildItem -Path src\modules\catalog,src\modules\media -Recurse -Filter *.js | ForEach-Object { node -c $_.FullName }
```
