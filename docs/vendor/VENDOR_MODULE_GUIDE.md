# Vendor Module Developer Guide

The Vendor module owns vendor master data, provider integration credentials, vendor products, and cost-center/SKU pricing rows. It is the reference-data boundary used by Mapping, Production, and Vendor Submission; it does not own routing rules, production tasks, submissions, shipments, or finance records.

Base path: `/api/vendors`.

## Data Model

```text
Vendor
  -> VendorProduct
       -> VendorCostCenter
  -> VendorIntegrationConfig
```

- `Vendor.code` is normalized to uppercase, unique, and immutable.
- A Vendor Product code is unique within one Vendor and must reference an active Catalog Product Type Group.
- A Cost Center code is unique within one Vendor Product. It stores the vendor SKU/LNG code, vendor and standard size/color, dimensions, base cost, shipping amounts, import tax, and supported additional costs.
- Vendor, Product, and Cost Center records use `ACTIVE`/`INACTIVE`; references exposed to other modules exclude inactive ancestors by default.
- Monetary amounts are integers in the stated currency's minor unit.

Vendor master data is global. It has no `shopId`; Shop access is not modeled inside this module.

## Provider Configuration

Each Vendor has at most one integration config per provider key. Supported auth shapes are `API_KEY`, `ACCESS_REFRESH`, and `LOGIN_PASSWORD`.

Secrets are encrypted with AES-256-GCM using `VENDOR_CREDENTIAL_SECRET` and are never returned by HTTP DTOs. Read responses expose only configured/not-configured flags. An internal credential lookup may refresh a token that expires within five minutes:

- `PRINTWAY` uses its refresh-token flow;
- `LENFUL` logs in again with username/password;
- other providers return the current configured token.

The API config remains the primary source; adapter environment variables are compatibility fallback. A config read is centrally audited because it crosses the credential boundary.

## Authorization

All routes require authentication. Reads require global `VENDORS:READ`; mutations require global `VENDORS:WRITE`. These are not Shop-scoped permissions.

## Public Port

`src/modules/vendor/public.js` exposes vendor and product lookup, active products by Catalog Product Type Group, active Cost Center lookup/search, and provider credential retrieval/refresh. Callers must use this port instead of importing Vendor models, repositories, or services.

## Audit And Failure Semantics

Master-data mutations emit central Audit events best-effort. An Audit write failure is logged and does not roll back the Vendor mutation. Duplicate vendor/product/cost-center codes are converted to stable conflict errors.

## Endpoint Groups

| Group | Paths |
|---|---|
| Vendor master data | `GET/POST /`, `GET/PATCH /:id` |
| Products | `GET/POST /products`, `GET/PATCH /products/:id` |
| Cost Centers | `GET/POST /products/:productId/cost-centers`, `PATCH /products/:productId/cost-centers/:costCenterId` |
| Provider config | `GET/PATCH /:vendorId/integration`, `POST /:vendorId/integration/refresh` |

Payloads, filters, provider keys, and import format are documented in [VENDOR_API.md](./VENDOR_API.md).

## Change Checklist

- Keep Vendor codes immutable and preserve the database uniqueness constraints.
- Reject Product creation against an inactive Vendor or Product Type Group.
- Reject Cost Center creation/listing against an inactive Product.
- Store money as integer minor units and never expose decrypted credentials in DTOs or logs.
- Keep global authorization explicit; do not invent Shop membership for Vendor data.
- Use `vendor/public.js` for every cross-module reference.
- Run `npm test -- --runInBand tests/vendor` and the architecture suite.
