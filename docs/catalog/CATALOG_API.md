# Catalog API Guide

The `catalog` module owns product type groups, shop-scoped listings, and internal templates. It does not own vendor products, mapping, orders, production tasks, or marketplace credentials.

## Auth

All endpoints require:

```text
Authorization: Bearer <accessToken>
```

- Product type group and internal template reads require `CATALOG:READ`.
- Product type group and internal template writes require `CATALOG:WRITE`.
- Listing reads require `CATALOG:READ` plus shop scope when the caller is scoped.
- Listing writes require `CATALOG:WRITE` plus shop scope when the caller is scoped.
- Direct listing PSD upload requires global `CATALOG:WRITE` and is admin/backfill only. Normal PSD workflow should use Design Task approval.

## Product Type Groups

### GET `/api/catalog/product-type-groups`

Query:

- `status`: `ACTIVE`, `INACTIVE`
- `search`: optional code/name search
- `page`, `limit`

### POST `/api/catalog/product-type-groups`

Body:

```json
{
  "code": "NAPKIN",
  "name": "Napkin",
  "sortOrder": 10,
  "status": "ACTIVE"
}
```

### PATCH `/api/catalog/product-type-groups/:id`

Body can update `name`, `sortOrder`, and `status`. `code` is not changed by PATCH.

## Internal Templates

### GET `/api/catalog/internal-templates`

Query:

- `code`
- `q`
- `productTypeGroupId`
- `status`
- `page`, `limit`

### POST `/api/catalog/internal-templates`

Body:

```json
{
  "code": "NAPKIN_MAIN",
  "name": "Napkin Main",
  "description": "Internal customer input template",
  "productTypeGroupId": "{{productTypeGroupId}}",
  "requiredFields": [
    {
      "key": "customName",
      "label": "Custom Name",
      "type": "TEXT",
      "required": true,
      "source": "CUSTOMER_INPUT",
      "sortOrder": 1
    }
  ],
  "artworkSlots": [
    {
      "key": "frontText",
      "label": "Front Text",
      "type": "TEXT",
      "required": true,
      "acceptedFieldKeys": ["customName"],
      "outputRole": "FRONT",
      "sortOrder": 1
    }
  ],
  "designAssets": [],
  "status": "ACTIVE"
}
```

### GET `/api/catalog/internal-templates/:id`

Returns the full internal template.

### PATCH `/api/catalog/internal-templates/:id`

Can update `name`, `description`, `productTypeGroupId`, `requiredFields`, `artworkSlots`, `designAssets`, and `status`. `code` is immutable in V1.

## Listings

### GET `/api/catalog/listings`

Query:

- `shopId`
- `salesChannelCode`: `AMAZON`, `ETSY`, `SHOPIFY`, `TIKTOK_SHOP`, `WALMART`, `CUSTOM`
- `marketplaceCode`
- `asin`
- `etsyListingId`
- `sku`
- `status`: `ACTIVE`, `INACTIVE`
- `qcStatus`: `DRAFT`, `APPROVED`, `REJECTED`
- `productTypeGroupId`
- `costCenterStatus`: `MISSING`, `PRESENT`
- `psdStatus`: `MISSING`, `PRESENT`
- `page`, `limit`

Use this as the No PSD queue:

```http
GET /api/catalog/listings?psdStatus=MISSING
```

### GET `/api/catalog/listings/summary`

Returns dashboard counts:

```json
{
  "totalListingCount": 10,
  "amazonListingCount": 6,
  "etsyListingCount": 4,
  "noPsdCount": 3,
  "draftCount": 5,
  "approvedCount": 4,
  "rejectedCount": 1
}
```

### POST `/api/catalog/listings`

Amazon listing body:

```json
{
  "shopId": "{{shopId}}",
  "salesChannelCode": "AMAZON",
  "marketplaceCode": "AMAZON_US",
  "sku": "NAPKIN-PINK-100",
  "asin": "B0TESTASIN",
  "title": "Personalized Birthday Napkins",
  "productTypeGroupId": "{{productTypeGroupId}}",
  "internalTemplateId": "{{internalTemplateId}}",
  "previewAssetId": "{{mediaAssetId}}",
  "baseCostAmount": 1200,
  "currency": "USD"
}
```

Etsy listing body:

```json
{
  "shopId": "{{shopId}}",
  "salesChannelCode": "ETSY",
  "marketplaceCode": "ETSY_US",
  "sku": "NAPKIN-PINK-100",
  "etsyListingId": "1234567890",
  "title": "Personalized Birthday Napkins",
  "productTypeGroupId": "{{productTypeGroupId}}",
  "internalTemplateId": "{{internalTemplateId}}",
  "baseCostAmount": 1200,
  "currency": "USD"
}
```

New listings default to:

- `status = ACTIVE`
- `qcStatus = DRAFT`
- `psdStatus = MISSING`

### GET `/api/catalog/listings/:id`

Returns listing detail.

### PATCH `/api/catalog/listings/:id`

Can update display/setup fields such as `title`, `asin`, `etsyListingId`, `productTypeGroupId`, `internalTemplateId`, `previewAssetId`, cost fields, `status`, `costCenterStatus`, and `psdStatus`.

`previewAssetId` is the listing thumbnail/mockup preview reference. The file must
already exist as a `MediaAsset`; Listing stores only the media asset id and DTOs
return `/api/media/assets/:assetId/download`.

Identity fields are immutable:

- `shopId`
- `salesChannelCode`
- `marketplaceCode`
- `sku`

### POST `/api/catalog/listings/:id/approve`

Approves a draft listing.

Rules:

- only `DRAFT` can be approved
- approved/rejected listings cannot transition again in V1

### POST `/api/catalog/listings/:id/reject`

Rejects a draft listing.

Body:

```json
{
  "rejectionReason": "Missing PSD template"
}
```

Rules:

- `rejectionReason` is required
- only `DRAFT` can be rejected

### POST `/api/catalog/listings/:id/psd-template`

Deprecated for normal operations. Use `POST /api/design/tasks` with `taskType=PSD_TEMPLATE`, then submit and approve the design task. This endpoint is kept for admin/backfill only and requires global `CATALOG:WRITE`.

Multipart form-data:

- field name: `file`
- allowed extensions: `.psd`, `.zip`, `.rar`
- max size: `200MB`

The file is streamed through `media.public.storeAsset()`. Catalog stores only `psdTemplateAssetId` and sets `psdStatus = PRESENT`.

FE should prefer:

- `GET /api/design/tasks/psd-template/candidates` to show selectable listings for PSD task creation.
- `POST /api/design/tasks/from-listings/:listingId/psd-template` to create/get an active PSD task.
- `POST /api/media/assets` + `PATCH /api/design/tasks/:taskId/submit` + `PATCH /api/design/tasks/:taskId/approve` for the normal upload/review flow.

## Verification

```powershell
npx jest src/test/catalog --runInBand
npx jest src/test/media --runInBand
npm run test:architecture -- --runInBand
Get-ChildItem -Path src\modules\catalog -Recurse -Filter *.js | ForEach-Object { node -c $_.FullName }
```
