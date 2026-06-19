# Order Import Pipeline

Order import is source-boundary work owned by the `integration` module. The pipeline accepts external source data, stores import evidence, normalizes records, and hands normalized orders to `order` through its public port.

## Supported Sources

Only these sources are allowed:

- `AMAZON_EXTENSION_REPORT`
- `MANUAL_EXCEL`

The system does not use Amazon SP-API. Do not add SP-API clients, credentials, cursors, polling, report APIs, or source names.

## Target Boundary

`externalOrderImport` belongs under:

```text
src/modules/integration/externalOrderImport/
```

It should own:

- import job state
- raw source records
- source file metadata
- import issues
- source-specific parsing and mapping
- normalized `ExternalOrderDTO` creation

It must not own:

- `Order` or `OrderItem` persistence
- deep customization parsing
- production task creation
- vendor selection
- shop membership

## Pipeline Flow

```text
source payload/file
  -> integration externalOrderImport source parser
  -> external raw record persistence
  -> source mapper
  -> ExternalOrderDTO
  -> order.public.importExternalOrder()
  -> customization.public.createPendingPayload() when customization data exists
  -> import result and issue records
```

## ExternalOrderDTO Contract

The normalized DTO should preserve source identifiers and contain enough data for `order` to perform idempotent import.

Minimum shape:

```js
{
  source: 'AMAZON_EXTENSION_REPORT',
  shopId: 'ObjectId',
  marketplaceCode: 'AMAZON_US',
  externalOrderId: 'string',
  orderedAt: 'Date',
  buyer: {},
  shippingAddress: {},
  items: [
    {
      externalItemId: 'string',
      asin: 'string',
      sku: 'string',
      quantity: 1,
      customization: {}
    }
  ],
  rawRecordIds: ['ObjectId']
}
```

The exact DTO can evolve with `order.public.importExternalOrder()`, but the import module must stay source-aware and the order module must stay normalized-order-aware.

## Idempotency Requirements

- Preserve external identifiers from source data.
- Hash raw records where practical.
- Use `(importJobId, rowNumber)` to avoid duplicate raw rows.
- Use source external order/item identifiers to allow safe retries.
- Retry paths must not create duplicate orders or customization payloads.

## Customization Handoff

If source data contains customization:

```text
integration -> customization.public.createPendingPayload()
```

`integration` may store raw source evidence, but it must not deeply parse customization business meaning. Parsing, asset references, retry state, and manual review belong to `customization`.

## Failure Handling

Import failures should be visible in issue records:

- normalize failed
- shop resolve failed
- order import failed
- duplicate record
- missing required field
- customization parse pending

Failures should not hide raw evidence. A partially failed import can still retain successful normalized imports and open issues for failed rows.
