# Order API Guide

The `order` module owns normalized order, order item, and order timeline read models. External imports must enter through `order.public.importExternalOrder()`. The HTTP API exposes order reads plus the small operator actions needed after import: fix shipping address, revalidate address, check item readiness, and mark an item fulfillment-ready.

## Boundary Rules

Order owns:

- normalized order documents
- normalized order item documents
- order and order item lifecycle timeline events
- idempotent normalized-order import through the public port

Order must not own:

- marketplace credentials or SP-API state
- source file parsing
- deep customization parsing
- vendor selection
- production task creation

Source-specific import belongs to `integration`. Raw customization handling belongs to `customization`.

## Auth And RBAC

All non-health endpoints require:

```text
Authorization: Bearer <accessToken>
```

Rules:

- `GET /api/orders/*` requires `ORDERS:READ`.
- `PATCH /api/orders/:orderId/shipping-address`, `PATCH /api/orders/:orderId/assigned-staff`, `POST /api/orders/:orderId/validate-address`, and `POST /api/orders/items/:orderItemId/mark-fulfillment-ready` require `ORDERS:WRITE`.
- Global `ORDERS:READ` can read all orders.
- Scoped `ORDERS:READ` can read only orders whose `shopId` is present in `req.auth.scopes` with `scopeType = shop`.
- If a scoped user filters by a shop outside their scope, list endpoints return an empty page.

## Endpoints

### GET `/api/orders/health`

No auth required.

Response:

```json
{
  "module": "order",
  "status": "ok"
}
```

### GET `/api/orders`

Query:

- `tab`: `ALL`, `NEW_ORDER`, `NO_COST_CENTER`, `NO_PSD`, `PAYMENT_PENDING`, `IN_PROGRESS`, `SHIPPED`, `DELIVERED`, `CANCELLED`, `OPEN_CASE`
- `orderId`: partial match against marketplace order id
- `shopId`: Mongo ObjectId
- `seller`: external account id
- `assignedStaffId`: Mongo ObjectId
- `status`: `IMPORTED`, `ON_HOLD`, `PROCESSING`, `PARTIALLY_SHIPPED`, `SHIPPED`, `CANCELLED`, `REFUNDED`, `FAILED`
- `salesChannelCode`: `AMAZON`, `ETSY`, `SHOPIFY`, `TIKTOK_SHOP`, `WALMART`, `CUSTOM`
- `marketplaceCode`: uppercase string, max 80 chars
- `dateFrom`, `dateTo`: ISO date, maps to `orderedAt`
- `shipByDateFrom`, `shipByDateTo`: ISO date
- `sort`: comma-separated fields, for example `-orderedAt,externalOrderId`
- `page`: default `1`
- `limit`: max `100`

Response:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "660000000000000000000301",
        "shopId": "660000000000000000000201",
        "salesChannelCode": "AMAZON",
        "marketplaceCode": "AMAZON_US",
        "externalOrderId": "113-1234567-1234567",
        "orderedAt": "2026-06-01T00:00:00.000Z",
        "buyer": {},
        "itemsCount": 2,
        "totalAmount": 3530,
        "customerPaidAmount": 3530,
        "status": "IMPORTED",
        "externalAccountId": "SELLER-1",
        "assignedStaffId": null,
        "actions": ["VIEW"]
      }
    ],
    "pagination": {
      "total": 1,
      "page": 1,
      "limit": 20
    },
    "tabCounts": {
      "ALL": 1,
      "NEW_ORDER": 1,
      "NO_COST_CENTER": 1,
      "NO_PSD": 1,
      "PAYMENT_PENDING": 0,
      "IN_PROGRESS": 0,
      "SHIPPED": 0,
      "DELIVERED": 0,
      "CANCELLED": 0,
      "OPEN_CASE": 0
    }
  }
}
```

### GET `/api/orders/summary`

Returns tab counts for the current filter set without returning table rows. It accepts the same filter query fields as `GET /api/orders`; `page`, `limit`, and `sort` are ignored by the count logic.

Response:

```json
{
  "success": true,
  "data": {
    "tabCounts": {
      "ALL": 1,
      "NEW_ORDER": 1,
      "NO_COST_CENTER": 1,
      "NO_PSD": 1,
      "PAYMENT_PENDING": 0,
      "IN_PROGRESS": 0,
      "SHIPPED": 0,
      "DELIVERED": 0,
      "CANCELLED": 0,
      "OPEN_CASE": 0
    }
  }
}
```

### GET `/api/orders/:orderId`

Returns one order if the caller can read the order shop.

### GET `/api/orders/:orderId/expanded`

Returns one order plus its order items for row expansion. Each item includes the customization DTO when a payload exists; otherwise `customization` is `null`.

Response:

```json
{
  "success": true,
  "data": {
    "order": {
      "id": "660000000000000000000301",
      "shopId": "660000000000000000000201",
      "salesChannelCode": "AMAZON",
      "marketplaceCode": "AMAZON_US",
      "externalOrderId": "113-1234567-1234567",
      "status": "IMPORTED",
      "orderedAt": "2026-06-01T00:00:00.000Z",
      "shipByDate": "2026-06-05T00:00:00.000Z",
      "addressValidationStatus": "VALID"
    },
    "platform": {
      "channel": "AMAZON",
      "marketplace": "AMAZON_US",
      "sellerAccountId": "SELLER-1",
      "flags": {
        "isPrime": false,
        "isBusinessOrder": false,
        "isReplacementOrder": false,
        "isExchangeOrder": false,
        "isBuyerRequestedCancellation": false
      }
    },
    "buyer": {
      "name": "Buyer",
      "emailMasked": "buyer@marketplace.amazon.com"
    },
    "shipping": {
      "address": {
        "city": "Harrison",
        "stateOrProvinceCode": "TN",
        "postalCode": "37341-9581",
        "countryCode": "US"
      },
      "service": {
        "level": "Standard",
        "name": "Std US D2D Dom"
      }
    },
    "items": [
      {
        "item": {
          "id": "660000000000000000000401",
          "externalItemId": "item-1",
          "sku": "MUG-BLACK-11OZ",
          "asin": "B000TEST01",
          "title": "Custom Mug",
          "quantity": 1,
          "status": "CUSTOMIZATION_PARSED"
        },
        "platform": {
          "channel": "AMAZON",
          "asin": "B000TEST01",
          "externalListingId": null,
          "externalProductId": null,
          "externalVariantId": null,
          "flags": {
            "hasGiftMessage": false,
            "giftWrapType": null
          }
        },
        "pricing": {
          "currency": "USD",
          "itemPriceAmount": 2500,
          "taxAmount": 180,
          "shippingAmount": 850,
          "giftWrapAmount": 0,
          "discountAmount": 0,
          "customerPaidAmount": 3530,
          "baseCostAmount": null
        },
        "customization": {
          "payloadId": "660000000000000000000501",
          "status": "PARSED",
          "needsReview": false,
          "errorCode": null,
          "errorMessage": null,
          "customerInputs": {},
          "imageAssets": [
            {
              "assetId": "660000000000000000000902",
              "secureUrl": "https://res.cloudinary.com/example/image/upload/front.jpg",
              "filename": "front.jpg",
              "mimeType": "image/jpeg",
              "size": 69071,
              "sha256": "..."
            }
          ],
          "failedImages": []
        }
      }
    ]
  }
}
```

### GET `/api/orders/:orderId/items`

Query:

- `status`: any order item status
- `page`: default `1`
- `limit`: max `100`

Common order item statuses:

- `NEW`
- `MAPPING_PENDING`
- `CUSTOMIZATION_PENDING`
- `CUSTOMIZATION_PARSED`
- `FULFILLMENT_PLANNING`
- `FULFILLMENT_READY`
- `NEED_PRODUCTION`
- `IN_PRODUCTION`
- `READY_TO_SEND_VENDOR`
- `SENT_TO_VENDOR`
- `TRACKING_PENDING`
- `SHIPPED`
- `FAILED`

Response item shape:

```json
{
  "id": "660000000000000000000401",
  "orderId": "660000000000000000000301",
  "shopId": "660000000000000000000201",
  "salesChannelCode": "AMAZON",
  "marketplaceCode": "AMAZON_US",
  "externalOrderId": "113-1234567-1234567",
  "externalItemId": "item-1",
  "asin": "B000TEST01",
  "sku": "MUG-BLACK-11OZ",
  "title": "Custom Mug",
  "quantity": 1,
  "variantRaw": {},
  "customizationRawSummary": {},
  "price": {},
  "status": "CUSTOMIZATION_PENDING",
  "importSources": ["AMAZON_EXTENSION_REPORT"],
  "externalData": {}
}
```

### GET `/api/orders/items/:orderItemId`

Returns one order item if the caller can read the item shop.

For customization review data, call `GET /api/customizations/order-items/:orderItemId`. Order item responses keep only `customizationRawSummary`; parsed customer inputs and Cloudinary images belong to the customization module.

### PATCH `/api/orders/:orderId/shipping-address`

Updates the shipping address embedded on the order. This resets `addressValidationStatus` to `NOT_CHECKED` and appends `SHIPPING_ADDRESS_UPDATED` to the order timeline.

Body:

```json
{
  "addressLine1": "102 Bluebonnet Cir",
  "addressLine2": null,
  "city": "Sunnyvale",
  "stateOrProvince": "TX",
  "postalCode": "75182-5007",
  "countryCode": "US"
}
```

### PATCH `/api/orders/:orderId/assigned-staff`

Sets or clears the staff account assigned to an order.

Body:

```json
{
  "assignedStaffId": "660000000000000000000901"
}
```

Use `null` to clear the assignment.

### POST `/api/orders/:orderId/validate-address`

Re-runs Smarty validation for the current shipping address. Valid US addresses are normalized on `shippingAddress`, and provider evidence is stored in `externalData.addressValidation`.

### GET `/api/orders/items/:orderItemId/readiness`

Returns a checklist for whether the item can move to fulfillment-ready.

Checks:

- parent order address must be `VALID`
- customization must be ready, or not required
- no open import issue may exist for the same `externalOrderId + externalItemId`
- item status must not be terminal or failed

Response:

```json
{
  "success": true,
  "data": {
    "orderItemId": "660000000000000000000401",
    "orderId": "660000000000000000000301",
    "ready": false,
    "targetStatus": "FULFILLMENT_READY",
    "checks": {
      "address": { "ok": true, "status": "VALID" },
      "customization": { "ok": false, "status": "NOT_READY" },
      "blockingIssues": { "ok": false, "count": 1 },
      "itemStatus": { "ok": true, "status": "CUSTOMIZATION_PARSED" }
    },
    "blockingReasons": ["CUSTOMIZATION_MISMATCH"]
  }
}
```

### POST `/api/orders/items/:orderItemId/mark-fulfillment-ready`

Runs the readiness checklist. If it passes, updates the item to `FULFILLMENT_READY` and appends `FULFILLMENT_PLAN_READY` to the timeline.

If readiness fails, returns `409 CONFLICT_ERROR` with the checklist in error details. This endpoint does not create production tasks.

### GET `/api/orders/:orderId/timeline`

Query:

- `page`: default `1`
- `limit`: max `100`

Timeline event types include:

- `ORDER_IMPORTED`
- `ORDER_REIMPORTED`
- `ORDER_STATUS_CHANGED`
- `SHIPPING_ADDRESS_UPDATED`
- `ADDRESS_VALIDATED`
- `ORDER_ITEM_IMPORTED`
- `CUSTOMIZATION_PAYLOAD_CREATED`
- `CUSTOMIZATION_PARSED`
- `CUSTOMIZATION_NEEDS_REVIEW`
- `MAPPING_PENDING`
- `FULFILLMENT_PLAN_READY`
- `PRODUCTION_TASK_CREATED`
- `VENDOR_SUBMISSION_SENT`
- `TRACKING_AVAILABLE`
- `SHIPMENT_CONFIRMED`

Response item shape:

```json
{
  "id": "660000000000000000000501",
  "orderId": "660000000000000000000301",
  "orderItemId": null,
  "shopId": "660000000000000000000201",
  "salesChannelCode": "AMAZON",
  "marketplaceCode": "AMAZON_US",
  "eventType": "ORDER_IMPORTED",
  "message": "Order imported",
  "fromStatus": null,
  "toStatus": "IMPORTED",
  "source": "IMPORT",
  "actorId": null,
  "metadata": {},
  "createdAt": "2026-06-01T00:00:00.000Z"
}
```

`metadata.rawRecordId` and `metadata.rawRecordIds` are removed from API responses.

### GET `/api/orders/items/:orderItemId/timeline`

Returns timeline events for one order item.

## Public Port

Other modules must import only:

```js
const orderPublic = require('../order/public');
```

Available functions:

- `importExternalOrder(externalOrderDto)`
- `findById(orderId)`
- `findItemById(orderItemId)`
- `appendTimeline(payload)`
- `validateAddress(orderId)`
- `updateShippingAddress(orderId, patch, authContext)`
- `listTimelineByOrder(orderId, query)`
- `listTimelineByOrderItem(orderItemId, query)`

## Postman

Use:

```text
docs/order/postman/LNG_Web_BE_Order_Customization.postman_collection.json
```

Run `Auth - Login` first, then run order requests.
