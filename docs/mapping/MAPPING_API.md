# Mapping API

Mapping resolves an imported order item into a fulfillment plan result. Preview is read-only; resolve/select can persist the selected vendor product and cost center.

Base path:

```text
/api/mapping
```

Auth:

- Read endpoints require `MAPPING:READ`.
- Write endpoints require `MAPPING:WRITE`.
- Shop-scoped rules require access to that shop.
- Global rules require global/admin write access.

## Workflow

1. Normalize SKU with SKU normalize rules.
2. Lookup catalog listing by canonical SKU first, then raw SKU fallback.
3. Parse config code from canonical SKU.
4. Resolve product type through SKU config rules and customer product type signal.
5. Normalize customer size/color/product options.
6. Rank vendor cost centers by SKU/lngCode, size/color, vendor priority, then cost.
7. Preview may return `autoMatch`.
8. Resolve auto-saves a `READY` plan only when `autoMatch` is confident.
9. Select saves a `READY` plan from an explicit manual vendor/cost-center choice.

Preview never persists a `FulfillmentPlan`. Resolve and select are the write paths.

## SKU Normalize Rules

Endpoints:

```http
GET    /api/mapping/sku-normalize-rules
POST   /api/mapping/sku-normalize-rules
GET    /api/mapping/sku-normalize-rules/:id
PATCH  /api/mapping/sku-normalize-rules/:id
```

Create body:

```json
{
  "shopId": null,
  "salesChannelCode": "AMAZON",
  "marketplaceCode": "AMAZON_US",
  "configCode": "TS1S",
  "patternType": "SEGMENT",
  "segmentIndex": 2,
  "segmentRole": "COUNTRY",
  "appliesWhenValues": ["US"],
  "outputAction": "REMOVE_SEGMENT",
  "priority": 100,
  "status": "ACTIVE"
}
```

Replace segment example:

```json
{
  "patternType": "SEGMENT",
  "segmentIndex": 1,
  "segmentRole": "CONFIG",
  "appliesWhenValues": ["TS1S"],
  "outputAction": "REPLACE_SEGMENT",
  "replacementValue": "TS2S"
}
```

Examples:

```text
J2504-TS1S-US-050226-1 -> J2504-TS1S-050226-1
J2508-TS1S-25022026-666 -> J2508-TS2S-25022026-666
```

## SKU Config Rules

Endpoints:

```http
GET    /api/mapping/sku-config-rules
POST   /api/mapping/sku-config-rules
GET    /api/mapping/sku-config-rules/:id
PATCH  /api/mapping/sku-config-rules/:id
```

Use these to map `configCode + product type signal` to a `productTypeGroupId`.

Create body:

```json
{
  "configCode": "TS1S",
  "productTypeAliases": ["UNISEX T-SHIRT", "UNISEX TSHIRT"],
  "platformProductType": "Unisex T-Shirt",
  "countryCode": "US",
  "productTypeGroupId": "{{productTypeGroupId}}",
  "internalTemplateId": "{{internalTemplateId}}",
  "priority": 100,
  "status": "ACTIVE"
}
```

If multiple active rules match the same config code and the customer product type signal is missing, preview returns `SKU_CONFIG_AMBIGUOUS`.

## Semantic Normalization Rules

Endpoints:

```http
GET    /api/mapping/normalization-rules
POST   /api/mapping/normalization-rules
GET    /api/mapping/normalization-rules/:id
PATCH  /api/mapping/normalization-rules/:id
```

Supported `semanticRole` values include:

```text
SIZE, COLOR, PRODUCT_TYPE, STYLE, MATERIAL, CUSTOM_TEXT, CUSTOMER_IMAGE, OTHER
```

Supported `matchType` values:

```text
EXACT, CONTAINS
```

`REGEX` is not supported in V1.

## Vendor Routing Rules

Endpoints:

```http
GET    /api/mapping/vendor-routing-rules
POST   /api/mapping/vendor-routing-rules
PATCH  /api/mapping/vendor-routing-rules/reorder
GET    /api/mapping/vendor-routing-rules/:id
PATCH  /api/mapping/vendor-routing-rules/:id
```

Vendor priority is a tie-breaker only. A ranked vendor without a matching size/color cost center must not beat a lower-ranked vendor that has a valid cost center.

## Preview

```http
POST /api/mapping/order-items/:orderItemId/preview
```

Response includes:

```json
{
  "ready": true,
  "skuNormalization": {
    "originalSku": "J2508-TS1S-25022026-666",
    "canonicalSku": "J2508-TS2S-25022026-666",
    "appliedRuleIds": ["..."],
    "removedSegments": [],
    "replacedSegments": [
      { "index": 1, "from": "TS1S", "to": "TS2S", "role": "CONFIG" }
    ]
  },
  "skuMapping": {
    "employeeCode": "J2508",
    "configCode": "TS2S",
    "dateCode": "25022026",
    "sequence": "666"
  },
  "normalizedInputs": [],
  "vendorProductCandidates": [],
  "costCenterCandidates": [],
  "autoMatch": null
}
```

## Resolve

```http
POST /api/mapping/order-items/:orderItemId/resolve
```

Runs preview server-side. If there is exactly one high-confidence `autoMatch`, the API persists a `FulfillmentPlan` with:

```json
{
  "status": "READY",
  "selectionMode": "AUTO"
}
```

If auto-match is not safe, the API returns the preview result without creating/updating a plan.

## Manual Select

```http
POST /api/mapping/order-items/:orderItemId/select
```

Body:

```json
{
  "vendorProductId": "{{vendorProductId}}",
  "vendorCostCenterId": "{{vendorCostCenterId}}"
}
```

Select re-runs preview server-side and persists a `FulfillmentPlan` with:

```json
{
  "status": "READY",
  "selectionMode": "MANUAL"
}
```

Existing `READY` plan with the same selection returns the existing plan. A different selection returns `409 PLAN_ALREADY_RESOLVED`.

Compatibility alias:

```http
POST /api/mapping/order-items/:orderItemId/confirm
```

This currently calls the same manual select handler for older clients.
