# ADR 0003: External Order Import Source Boundary

## Status

Accepted

## Context

External order data can arrive from more than one operator-controlled source, but normalized order persistence belongs to the `order` module.

## Decision

The `integration` module owns `externalOrderImport` source handling. It accepts:

- `AMAZON_EXTENSION_REPORT`
- `MANUAL_EXCEL`

Source data must normalize into `ExternalOrderDTO` and then call:

```js
order.public.importExternalOrder(payload)
```

`externalOrderImport` must not create `Order` or `OrderItem` documents directly.

## Consequences

- Source-specific parsing remains in `integration`.
- Normalized order lifecycle remains in `order`.
- Retries and idempotency can be reasoned about at the import boundary.
- Raw source evidence can be retained without leaking source concerns into normalized order services.
