# System Overview

`lng-web-be` is the backend for an enterprise Print-on-Demand FBM platform. It is an API-first strict modular monolith built around marketplace ingestion, normalized order state, customization handoff, production execution, vendor submission, shipment tracking, finance, reporting, audit, shop management, organization management, and scoped RBAC.

## Runtime Stack

- Node.js and Express.js
- MongoDB through Mongoose
- Redis through ioredis
- BullMQ for queue-backed work
- Joi for request validation
- Jest for tests

## Architectural Style

The system is a strict modular monolith. Each module owns its internal model, repository, service, controller, route, validator, and DTO files. Cross-module communication is allowed only through the target module's `public.js` public port.

The default layer flow is:

```text
HTTP route -> controller -> service -> repository -> model
```

Cross-module service orchestration must use:

```text
service -> otherModule/public.js
```

## Current Module Map

| Module | Ownership |
| --- | --- |
| `audit` | Immutable activity and lifecycle evidence |
| `auth` | Accounts, authentication, RBAC, scope registry, access assignments |
| `catalog` | Product type groups, shop-scoped listings, and internal templates. See `docs/architecture/CATALOG_MODULE.md`. |
| `design` | Designer task workflow and QC approval for master listing/template assets. See `docs/architecture/DESIGN_MODULE.md`. |
| `finance` | Financial snapshots for order-item revenue, cost, and margin. See `docs/architecture/FINANCE_MODULE.md`. |
| `integration` | External adapters, webhooks, imports, and platform orchestration |
| `mapping` | SKU/product/listing/vendor mapping rules. See `docs/architecture/MAPPING_MODULE.md`. |
| `media` | Design files, generated assets, image references |
| `order` | Normalized order and order item lifecycle |
| `organization` | Departments, teams, team memberships |
| `production` | POD production tasks and workflow state. See `docs/architecture/PRODUCTION_MODULE.md`. |
| `report` | Operational and financial read models |
| `shipment` | Manual shipment lifecycle and tracking. See `docs/architecture/SHIPMENT_MODULE.md`. |
| `shop` | Internal business shop/store aggregate root |
| `vendor` | Vendor master data, products, and cost centers. See `docs/architecture/VENDOR_MODULE.md`. |
| `vendorSubmission` | Manual vendor handoff and submission state. See `docs/architecture/VENDOR_SUBMISSION_MODULE.md`. |

## Core Boundaries

- `shop` is the internal business shop/store aggregate root. It is not a marketplace account, Amazon account, external store account, or platform connection.
- `shop` must not own platform credentials, external account IDs, marketplace IDs, tokens, sync cursors, or integration state.
- Shop access is not modeled through `ShopMember`; it uses Auth scoped RBAC.
- `auth` owns scoped permissions through `AccessAssignment`, `ScopeRegistry`, and `ScopedRolePermission`.
- `organization` owns departments, teams, and team memberships. It calls Auth public ports when membership changes need auth assignment sync.
- `integration` owns import/adapters but must not create normalized orders directly through models.
- `order` owns normalized order persistence and import acceptance through its public port.
- `customization` is reserved for raw customization payloads, parsed customization data, assets, retry state, and review state.

## Order Import Contract

- No SP-API.
- Supported order sources are `AMAZON_EXTENSION_REPORT` and `MANUAL_EXCEL`.
- `externalOrderImport` belongs under `src/modules/integration/externalOrderImport`.
- `externalOrderImport` normalizes source records to `ExternalOrderDTO`.
- Order creation must go through `order.public.importExternalOrder()`.
- Customization handoff must go through `customization.public.createPendingPayload()`.
- Cross-module calls must go through `public.js`.

## Non-Goals

- No Amazon SP-API.
- No SP-API credentials, cursors, clients, polling, or terminology.
- No direct cross-module model imports.
- No business rules in `src/shared/`.
- No imports from `src/shared/` to `src/modules/`.
