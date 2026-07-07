# Module Boundaries

This repository uses strict module ownership. A module may freely use its own internals, but another module may only call its `public.js` port.

## Allowed Dependency Direction

```text
controller -> service -> repository -> model
service -> sameModule/repository
service -> otherModule/public.js
route -> sameModule/controller
public.js -> sameModule/service
```

## Forbidden Dependency Direction

```text
controller -> model
service -> model
service -> otherModule/models/*
service -> otherModule/repositories/*
controller -> otherModule/services/*
shared -> modules/*
```

## Public Port Rule

Use another module through its public port:

```js
const orderPort = require('../../order/public');
```

Do not import another module's internals:

```js
const Order = require('../../order/models/order.model');
```

Public ports should expose behavior, not database structures. Prefer method names that describe module capabilities:

```js
importExternalOrder(payload)
syncScopeRegistry(payload)
createPendingPayload(payload)
```

## Layer Responsibilities

| Layer | Owns | Must not own |
| --- | --- | --- |
| Route | Express path/middleware wiring | Business rules |
| Controller | Request parsing, validation result use, response code | Mongoose queries, cross-module orchestration |
| Service | Domain rules, idempotency, transactions, public-port orchestration | Raw HTTP `req`/`res`, raw response shape |
| Repository | Mongoose query details | Business decisions |
| Model | Schema, indexes, validation | Service logic |
| DTO | API response shape | Persistence rules |

## Shared Directory

`src/shared/` is technical-only. It may contain:

- `AppError`
- error code constants
- logger
- crypto helpers
- pagination helpers
- HTTP/status constants
- generic utilities

Business modules may import these technical utilities from `src/shared/`.

It must not contain:

- business models
- business schemas
- module-specific DTOs
- module-specific business rules
- imports from `src/modules/`

## Module Ownership Notes

- `auth` owns accounts, roles, permissions, scoped access, and scope registry.
- `organization` owns department/team membership state and calls `auth/public.js` for auth sync.
- `shop` owns internal business shop/store data. It is not a marketplace account, Amazon account, external store account, or platform connection.
- `shop` must not own platform credentials, external account IDs, marketplace IDs, tokens, sync cursors, or integration state.
- Shop access is Auth scoped RBAC, not a shop membership table.
- `integration` owns import boundaries and external source handling.
- `order` owns normalized order persistence.
- `customization` owns customization payload lifecycle when implemented.
- `catalog` owns `ProductTypeGroup`, shop-scoped `Listing`, and internal system `InternalTemplate` metadata. See `docs/architecture/CATALOG_MODULE.md`.
- `catalog` stores only `mediaAssetId` references for design assets and may call `media/public.js`; it must not import media internals or store binary files.
- `design` owns designer task workflow and QC approval for listing/template assets. See `docs/architecture/DESIGN_MODULE.md`.
- `vendor` owns vendor master data, vendor products, and vendor cost centers.
- `mapping` owns fulfillment plan resolution and vendor/cost-center selection.
- `production` owns production task state and QC readiness.
- `vendorSubmission` owns vendor handoff state and safe submission snapshots. It may call `production/public.js`; it must not import production internals or call vendor APIs in V1.
- `shipment` owns manual tracking state. It may call `vendorSubmission/public.js` and `order/public.js`; it must not import order/vendorSubmission internals or call carrier APIs in V1.
- `finance` owns financial snapshots and manual recalculation. It may call `order/public.js`, `mapping/public.js`, and `shipment/public.js`; it must not import internals or own vendor invoices in V1.

## Order Import Boundary

- The system does not use Amazon SP-API.
- Supported order sources are `AMAZON_EXTENSION_REPORT` and `MANUAL_EXCEL`.
- `externalOrderImport` belongs under `src/modules/integration/externalOrderImport`.
- `externalOrderImport` normalizes source records to `ExternalOrderDTO`.
- Order creation must go through `order.public.importExternalOrder()`.
- Customization handoff must go through `customization.public.createPendingPayload()`.
- Cross-module calls must go through `public.js`.

## Architecture Test Expectations

Architecture tests should prevent:

- cross-module internal imports
- controllers importing models directly
- `src/shared/` importing from `src/modules/`
- reintroduction of removed legacy persistence files
- SP-API clients or terminology in import code
