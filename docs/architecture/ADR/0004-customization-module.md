# ADR 0004: Customization Module Ownership

## Status

Accepted

## Context

Marketplace orders can contain customization data and asset references. This data needs its own lifecycle because parsing, downloading, retry, and review are not order persistence concerns.

## Decision

The `customization` module owns:

- raw customization payloads
- raw payload hashes
- parsed customization data
- customization asset references
- retry metadata
- manual review status

Import sources should hand customization data to:

```js
customization.public.createPendingPayload(payload)
```

## Consequences

- `integration` stores source evidence and hands off customization payloads.
- `order` stores normalized order state and references readiness through module contracts.
- `customization` must not own vendor selection, production task creation, catalog mapping, or shipment behavior.
- Downstream modules should use customization public ports to check readiness or parse status.
