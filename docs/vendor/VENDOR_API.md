# Vendor API Guide

The `vendor` module owns vendor master data, vendor products, and vendor cost-center pricing rows. It does not own invoices, mapping, production tasks, vendor submissions, order enrichment, or vendor API sync in V1.

## Auth

All endpoints require:

```text
Authorization: Bearer <accessToken>
```

- Read routes require `VENDORS:READ`.
- Write routes require `VENDORS:WRITE`.

## Vendors

### GET `/api/vendors`

Query:

- `code`
- `providerKey`
- `fulfillmentType`: `FBM`, `FBA`, `POD`, `DROPSHIP`, `CUSTOM`
- `status`: `ACTIVE`, `INACTIVE`
- `q`
- `page`, `limit`

### POST `/api/vendors`

Body:

```json
{
  "code": "MERCHIZE",
  "name": "Merchize",
  "providerKey": "MERCHIZE",
  "fulfillmentType": "POD",
  "status": "ACTIVE",
  "metadata": {}
}
```

### GET `/api/vendors/:id`

Returns a single vendor.

### PATCH `/api/vendors/:id`

Allowed fields:

```json
{
  "name": "Merchize Updated",
  "providerKey": "MERCHIZE",
  "fulfillmentType": "POD",
  "status": "ACTIVE",
  "metadata": {}
}
```

`code` is immutable.

## Vendor Integration Credentials

These endpoints configure vendor API credentials for adapters. Secrets are encrypted in DB and never returned by API responses. Existing `.env` credentials remain fallback only.

### GET `/api/vendors/:vendorId/integration`

Requires `VENDORS:READ`.

Returns masked config:

```json
{
  "id": "...",
  "vendorId": "...",
  "providerKey": "PRINTWAY",
  "baseUrl": "https://apis.printway.io",
  "authType": "ACCESS_REFRESH",
  "status": "CONNECTED",
  "accessTokenConfigured": true,
  "refreshTokenConfigured": true,
  "usernameConfigured": false,
  "passwordConfigured": false
}
```

### PATCH `/api/vendors/:vendorId/integration`

Requires `VENDORS:WRITE`.

Body:

```json
{
  "providerKey": "PRINTWAY",
  "baseUrl": "https://apis.printway.io",
  "authType": "ACCESS_REFRESH",
  "accessToken": "{{printwayAccessToken}}",
  "refreshToken": "{{printwayRefreshToken}}",
  "expiresAt": null,
  "status": "CONNECTED",
  "metadata": {}
}
```

Supported `authType`:

- `API_KEY`: long-lived access token, e.g. Merchize in V1.
- `ACCESS_REFRESH`: access token plus refresh token, e.g. Printway.
- `LOGIN_PASSWORD`: username/password re-login flow, e.g. Lenful.

Lenful example:

```json
{
  "providerKey": "LENFUL",
  "baseUrl": "https://s-lencam.lenful.com/api",
  "authType": "LOGIN_PASSWORD",
  "accessToken": "{{lenfulAccessToken}}",
  "username": "{{lenfulUsername}}",
  "password": "{{lenfulPassword}}",
  "metadata": {
    "storeId": "{{lenfulStoreId}}"
  }
}
```

### POST `/api/vendors/:vendorId/integration/refresh`

Requires `VENDORS:WRITE`.

Body:

```json
{
  "providerKey": "PRINTWAY"
}
```

Refresh support in V1:

- `PRINTWAY`: calls refresh-token flow when `refreshToken` is configured.
- `LENFUL`: calls login flow when `username/password` are configured.
- `MERCHIZE`: no refresh flow known in V1; uses configured access token.

### POST `/api/vendors/:vendorId/integration/test-connection`

Requires `VENDORS:WRITE`. The endpoint runs a read-only provider probe using the configured Native adapter, updates `status`, `lastCheckedAt`, and a redacted `lastError`, then returns the normal integration DTO. Manual and Generic API modes are rejected until a provider-specific probe is available.

The probe never returns plaintext credentials. Providers without a registered adapter return `PROVIDER_NOT_IMPLEMENTED` as a validation error.

## Vendor Products

### GET `/api/vendors/products`

Query:

- `vendorId`
- `productTypeGroupId`
- `code`
- `externalProductId`
- `status`
- `q`
- `page`, `limit`

### POST `/api/vendors/products`

Body:

```json
{
  "vendorId": "{{vendorId}}",
  "productTypeGroupId": "{{productTypeGroupId}}",
  "code": "ZIPLVN",
  "name": "All-over Print Zip Polo Shirt",
  "externalProductId": "ZIPLVN",
  "imageUrl": "https://example.com/product.jpg",
  "productUrl": "https://example.com/product",
  "designTemplateUrl": "https://example.com/template.zip",
  "minProductionDays": 2,
  "maxProductionDays": 5,
  "baseCostAmount": 1205,
  "currency": "USD",
  "status": "ACTIVE",
  "metadata": {}
}
```

Money fields are integer minor units. `1205` means `$12.05`.

### GET `/api/vendors/products/:id`

Returns a single vendor product.

### PATCH `/api/vendors/products/:id`

Allowed fields:

```json
{
  "productTypeGroupId": "{{productTypeGroupId}}",
  "name": "Updated Product",
  "externalProductId": "ZIPLVN",
  "imageUrl": "https://example.com/product.jpg",
  "productUrl": "https://example.com/product",
  "designTemplateUrl": "https://example.com/template.zip",
  "minProductionDays": 3,
  "maxProductionDays": 6,
  "baseCostAmount": 1299,
  "currency": "USD",
  "status": "ACTIVE",
  "metadata": {}
}
```

`vendorId` and `code` are immutable.

## Vendor Cost Centers

Cost centers are vendor pricing rows for a product, usually by size/color/SKU.

### GET `/api/vendors/products/:productId/cost-centers`

Query:

- `code`
- `sku`
- `standardSize`
- `standardColor`
- `status`
- `q`
- `page`, `limit`

### POST `/api/vendors/products/:productId/cost-centers`

Body:

```json
{
  "code": "ZIPLVN000000AA01",
  "name": "S / ZIPLVN000000AA01",
  "sku": "ZIPLVN000000AA01",
  "lngCode": "ZIPLVN-S",
  "vendorSize": "S",
  "vendorColor": "Black",
  "standardSize": "S",
  "standardColor": "Black",
  "attributes": {
    "material": "polyester"
  },
  "weight": 120,
  "weightUnit": "G",
  "width": 10,
  "length": 12,
  "height": 1,
  "dimensionUnit": "IN",
  "baseCostAmount": 1205,
  "currency": "USD",
  "domesticShipping": {
    "economyAmount": 599,
    "additionalAmount": 299
  },
  "internationalShipping": {
    "economyAmount": 999,
    "additionalAmount": 499
  },
  "priorityShipping": {
    "economyAmount": 1299,
    "additionalAmount": 699
  },
  "importTaxAmount": 28,
  "additionalCosts": {
    "embroideryAmount": 0,
    "twoSidedPrintAmount": 0,
    "twoPositionPrintAmount": 0
  },
  "status": "ACTIVE",
  "metadata": {}
}
```

### PATCH `/api/vendors/products/:productId/cost-centers/:costCenterId`

Updates non-cost fields directly. `vendorProductId` and `code` are immutable. Cost fields are append-only: send a user-chosen `effectiveFrom` and at least one changed cost value inside `costRate`. The preceding rate closes at `effectiveFrom - 1ms`; backdated and no-op rates are rejected.

```json
{
  "name": "S / ZIPLVN000000AA01 Updated",
  "status": "ACTIVE",
  "costRate": {
    "effectiveFrom": "2026-09-08T00:00:00.000Z",
    "baseCostAmount": 1300,
    "importTaxAmount": 30
  }
}
```

## Standard Import Template

The stable import contract is three CSV files in one directory:

- `vendors.csv`
- `vendor_products.csv`
- `vendor_cost_centers.csv`

For operators, use **Portal → Vendors → Import catalog**. Upload all three files,
select **Validate**, then select **Import catalog** after validation succeeds. Products
without a Product Type Group appear in **Portal → Vendors → Product Type Migration**.

Use the minimal Product Migration template at
`docs/vendor/templates/vendor-import-product-migration/`. It intentionally does not
contain `productTypeGroupCode`: imported Vendor Products remain unassigned until an
operator assigns them in Product Migration.

Dry-run first:

```powershell
node src\modules\vendor\scripts\importVendorTemplate.js --dir="C:\path\to\template"
```

Run mutation only after reviewing dry-run output:

```powershell
node src\modules\vendor\scripts\importVendorTemplate.js --dir="C:\path\to\template" --dryRun=false --skipInvalidRows=true
```

Convert Merchize XLSX to the standard template:

```powershell
node src\modules\vendor\scripts\merchizeXlsx.mapper.js --input="C:\path\merchize.xlsx" --outDir="C:\path\template" --vendorCode=MERCHIZE --vendorName=Merchize
```

Convert ONOS XLSX to the standard template:

```powershell
node src\modules\vendor\scripts\onosXlsx.mapper.js --input="C:\path\onos.xlsx" --outDir="C:\path\template" --vendorCode=ONOSPOD --vendorName=ONOS
```

To retain the legacy strict behavior, pass `--allowUnassignedProductTypes=false`.

## Deferred

- EC-111 vendor finance invoice tracking.
- Vendor API sync.
- VendorProductTemplate.
- Mapping/FulfillmentPlan.
- ProductionTask.
- VendorSubmission.
- Order enrichment.
