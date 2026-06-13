# Shop API Guide

The `shop` module owns internal business shop units. A shop is not an Amazon, Etsy, or Shopify connection. It is the core business aggregate used by downstream modules as a stable `shopId` boundary for listings, orders, production, finance, reporting, and scoped access.

## Boundary Rules

Shop contains only core business fields:

- `name`
- `currency`
- `status`

Shop must not contain platform or integration state:

- no Amazon seller ID
- no marketplace ID
- no OAuth/API token
- no sync cursor
- no webhook state
- no listing mapping or order import state

Platform connection data belongs in future integration/channel modules.

## Demo Seed

Run the full demo seed:

```bash
npm run seed:demo:full
```

Run only shop demo data:

```bash
npm run seed:shop:demo
```

Re-sync shop scopes into Auth `ScopeRegistry`:

```bash
npm run seed:shop:scopes
```

Demo shops:

| Name | ID | Currency | Status |
|---|---|---|---|
| Football US Shop | `660000000000000000000201` | USD | ACTIVE |
| Pet Memorial Shop | `660000000000000000000202` | USD | ACTIVE |
| Nurse Gift Shop | `660000000000000000000203` | USD | ACTIVE |
| Family Custom Shirt Shop | `660000000000000000000204` | USD | INACTIVE |
| Compliance Hold Shop | `660000000000000000000205` | USD | SUSPENDED |

Creating or updating a shop syncs Auth scope:

```json
{
  "scopeType": "shop",
  "scopeId": "<shopId>",
  "name": "Football US Shop",
  "status": "active"
}
```

Shop status maps to Auth scope status:

| Shop Status | ScopeRegistry Status |
|---|---|
| ACTIVE | active |
| INACTIVE | inactive |
| SUSPENDED | inactive |

## Auth And RBAC

All endpoints require:

```text
Authorization: Bearer <accessToken>
```

Rules:

- `POST /api/shops` requires global `SHOPS:WRITE`.
- `GET /api/shops` returns all shops only with global `SHOPS:READ`.
- Without global `SHOPS:READ`, `GET /api/shops` returns only shops from `req.auth.scopes` where `scopeType = shop` and permissions include `SHOPS:READ`.
- `GET /api/shops/:shopId` requires global or scoped `SHOPS:READ` for that shop.
- `PATCH /api/shops/:shopId/status` requires global or scoped `SHOPS:WRITE` for that shop.

Admin can grant shop access through Auth `AccessAssignment`:

```json
{
  "accountId": "660000000000000000000231",
  "roleId": "<roleId>",
  "scopeType": "shop",
  "scopeId": "660000000000000000000201"
}
```

The `Role` must include the relevant permissions, such as `SHOPS:READ` or `SHOPS:WRITE`.

## Endpoints

### GET `/api/shops`

Query:

- `status`: `ACTIVE`, `INACTIVE`, or `SUSPENDED`
- `search`: prefix search by shop name
- `page`: default `1`
- `limit`: default `20`, max `100`

Response:

```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "660000000000000000000201",
        "name": "Football US Shop",
        "currency": "USD",
        "status": "ACTIVE"
      }
    ],
    "pagination": {
      "total": 1,
      "page": 1,
      "limit": 20
    }
  }
}
```

### POST `/api/shops`

Requires global `SHOPS:WRITE`.

Body:

```json
{
  "name": "Veteran Gift Shop",
  "currency": "USD"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "id": "507f1f77bcf86cd799439011",
    "name": "Veteran Gift Shop",
    "currency": "USD",
    "status": "ACTIVE"
  }
}
```

### GET `/api/shops/:shopId`

Requires `SHOPS:READ` globally or scoped to the target shop.

Business flow detail only returns active shops. If the shop is `INACTIVE` or `SUSPENDED`, the public port blocks it with `409 CONFLICT`.

### PATCH `/api/shops/:shopId/status`

Requires `SHOPS:WRITE` globally or scoped to the target shop.

Body:

```json
{
  "status": "INACTIVE"
}
```

Allowed values:

- `ACTIVE`
- `INACTIVE`
- `SUSPENDED`

The updated status is synced to Auth `ScopeRegistry`.

## Public Port

Other modules must import only:

```js
const shopPublic = require('../shop/public');
```

Use:

```js
await shopPublic.assertShopIsActive(shopId);
```

This is the required guard before creating new operational records such as orders, listings, production tasks, vendor submissions, sync jobs, and reports.
