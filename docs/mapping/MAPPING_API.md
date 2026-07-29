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
2. Lookup an active, approved catalog listing by ASIN, then canonical SKU, then raw SKU fallback.
3. Parse config code from canonical SKU.
4. Resolve product type through SKU config rules and customer product type signal.
5. Normalize customer size/color/product options.
6. Rank vendor cost centers by SKU/lngCode, size/color, vendor priority, then cost.
7. Preview may return `autoMatch`.
8. Resolve auto-saves a `READY` plan only when `autoMatch` is confident.
9. Select saves a `READY` plan from an explicit manual vendor/cost-center choice.

Preview never persists a `FulfillmentPlan`. Resolve and select are the write paths.

When resolve/select creates a `READY` plan, mapping triggers production recheck through
`production/public.js` using a system handoff context. Mapping still does not own
`OrderItem.status`; production decides the next item status from task blockers.

## Summary

```http
GET /api/mapping/summary
```

Query:

- `shopId`
- `salesChannelCode`
- `marketplaceCode`
- `dateFrom`, `dateTo`
- `limit`: max `100`, used for blocked preview sampling.

Response:

```json
{
  "readyPlanCount": 40,
  "confirmedPlanCount": 0,
  "totalPlanCount": 40,
  "blockedSampleCount": 12,
  "missingSkuConfigCount": 3,
  "missingSemanticRuleCount": 2,
  "missingVendorProductCount": 1,
  "missingVendorCostCenterCount": 6,
  "ambiguousSkuConfigCount": 1,
  "byStatus": {},
  "bySelectionMode": {}
}
```

The persisted counts come from `FulfillmentPlan`. Blocked counts are sampled by
running read-only preview against recent unmatched order items; preview still
does not persist blocked plans.

## Rule Safety And Audit

```http
GET  /api/mapping/authorable-shops
POST /api/mapping/rule-preview
POST /api/mapping/rule-conflicts
GET  /api/mapping/:ruleType/:id/history
```

`authorable-shops` requires `MAPPING:WRITE`. Preview/conflict/history operations
enforce global or exact shop-scoped access without changing rules. Supported
history types are `normalization`, `semanticRules`, `valueAliases`,
`vendorRouting`, `skuConfig`, and `skuNormalize`.

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

Operator-friendly aliases:

```http
GET    /api/mapping/semantic-rules
POST   /api/mapping/semantic-rules
GET    /api/mapping/semantic-rules/:id
PATCH  /api/mapping/semantic-rules/:id

GET    /api/mapping/value-aliases
POST   /api/mapping/value-aliases
GET    /api/mapping/value-aliases/:id
PATCH  /api/mapping/value-aliases/:id
```

These aliases use the same `MappingNormalizationRule` records. `semantic-rules` defaults to label matching, for example `Select Your Choose Size -> SIZE`. `value-aliases` defaults to value matching and requires `normalizedValue`, for example `XXL -> 2XL` or `Pack 50pcs -> 50 PCS`.

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

## Unmatched Items And Vendor Search

```http
GET  /api/mapping/order-items/unmatched
POST /api/mapping/order-items/:orderItemId/vendor-candidates/search
```

The unmatched queue is shop-scoped and returns preview blockers plus recommended
fix types. Candidate search accepts optional `q`, `vendorId`, `vendorProductId`,
`productTypeGroupId`, `size`, `color`, `sku`, `lngCode`,
`includeDifferentProductType`, `page`, and `limit`. Explicit size/color values
override normalized customer-input signals for that search only.

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

Selecting the same `READY` choice re-applies the plan and downstream recheck. A
different automatic selection returns `409 PLAN_ALREADY_RESOLVED`.

A manual selection may replace a different existing `READY` plan after Production
prepares the item for the override. A `CONFIRMED` plan cannot be replaced. A valid
selection may also be persisted when `CUSTOMIZATION_NOT_READY` is the only blocker;
the OrderItem is not marked fulfillment-ready until that blocker clears.

Compatibility alias:

```http
POST /api/mapping/order-items/:orderItemId/confirm
```

This currently calls the same manual select handler for older clients.
It does not transition the stored plan to `CONFIRMED`.

Read the active plan:

```http
GET /api/mapping/order-items/:orderItemId/plan
```

## Live Handoff Check

Use the script below to inspect real imported orders without writing by default:

```powershell
node src\modules\mapping\scripts\verifyOrderFulfillmentHandoff.js --file="C:\Users\admin\Downloads\report\163152591987020634.txt"
```

Useful options:

```text
--orderItemIds=<id1,id2>
--orderIds=<id1,id2>
--externalOrderIds=113-7180016-0704235,114-5128345-1267462
--limit=20
--write=true
```

Default mode is dry-run. It reports preview match, existing plan, and production task state.
`--write=true` only runs mapping auto-resolve for items with a safe `autoMatch`; it does not reset orders or import files.

Common unmatched reasons:

```text
LISTING_NOT_FOUND
SKU_CONFIG_AMBIGUOUS
CUSTOMIZATION_NOT_READY
NO_VENDOR_PRODUCT_CANDIDATE
NO_VENDOR_COST_CENTER_CANDIDATE
NO_AUTOMATCH
```

## Operator Workbench

```http
GET /api/mapping/config-workbench
```

Query:

```text
shopId, salesChannelCode, marketplaceCode, configCode, productTypeGroupId, dateFrom, dateTo, sampleLimit
```

Returns rule counts/pages plus recent unmatched order item samples. Samples include `blockingReasons`, `skuNormalization`, `skuMapping`, `normalizedInputs`, and `recommendedFixTypes` so operators know which rule/data screen to fix.

## Recheck

```http
POST /api/mapping/order-items/:orderItemId/recheck
POST /api/mapping/recheck-unmatched
```

`recheck` is an operator-friendly alias for auto resolve. It persists a READY plan only when a safe auto-match exists; otherwise it returns the blocked preview.

Batch body:

```json
{
  "shopId": "{{shopId}}",
  "salesChannelCode": "AMAZON",
  "marketplaceCode": "AMAZON_US",
  "limit": 50
}
```

Batch is capped at `100` items and skips order items that already have a READY/CONFIRMED plan.
