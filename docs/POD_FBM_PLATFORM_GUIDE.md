# POD FBM Platform Guide

This document defines the starting domain rules for Amazon, Etsy, Shopify, and future marketplace integrations.

## Fulfillment Model

- FBM is the default fulfillment model.
- Orders are imported from marketplace shops, normalized into the `order` module, mapped to catalog/vendor data, processed through production, submitted to vendors, shipped, audited, and reconciled.
- Platform-specific behavior must stay in `integration`; normalized business state belongs in domain modules such as `order`, `production`, `shipment`, and `finance`.

## Platform Boundary

Use the `integration` module for:

- Marketplace API clients.
- Webhook controllers.
- Import jobs.
- Platform payload parsing.
- Platform authentication and token refresh.
- Platform-specific retry/rate-limit handling.

Do not let platform payload shapes leak directly into core modules. Convert platform payloads into normalized DTOs before calling another module's public port.

Use the `shop` module for:

- Marketplace store/account configuration.
- Platform marketplace identifiers.
- Connection status and operational settings.
- Non-secret references to credentials managed outside source code.

Use the `vendor` module for:

- Vendor master data.
- Vendor capabilities and supported product types.
- Supported countries and shipping methods.
- Production SLA and routing priority.
- Cost configuration and price card references.

## Idempotency Keys

Every ingestion, webhook, import, and transaction write path must use a stable unique business key.

Recommended keys:

| Platform | Key |
| --- | --- |
| Amazon | `amazonOrderId`, `amazonOrderItemId`, `feedSubmissionId`, `settlementId` |
| Etsy | `etsyReceiptId`, `etsyTransactionId`, `etsyShopId`, `webhookEventId` |
| Shopify | `shopifyOrderId`, `shopifyLineItemId`, `shopifyShopDomain`, `webhookId` |
| Internal import | `importKey`, `sourceFileHash`, `sourceRowHash` |

## Normalized Flow

```text
shop -> integration -> order -> mapping -> catalog -> vendor -> production -> vendorSubmission -> shipment -> finance -> audit/report
```

Cross-module calls must use public ports only.

## Data Rules

- Keep raw platform payloads in integration-owned records or audit logs when needed for traceability.
- Store normalized order state in the `order` module.
- Store marketplace shop/account state in the `shop` module.
- Store vendor master data and vendor capabilities in the `vendor` module.
- Store production state in the `production` module.
- Store vendor submission state in the `vendorSubmission` module.
- Store shipment state in the `shipment` module.
- Store settlement, cost, fee, and profit data in the `finance` module.
- API responses must use DTOs and never expose raw database documents.

## Queue Rules

- Create queues through `src/config/queue.js`.
- Use separate job names for import, webhook processing, sync, reconciliation, and retry workflows.
- Jobs must be retry-safe and idempotent.
- Job payloads should contain IDs and stable keys, not full raw documents.
