# Report Module

`report` owns read-only dashboard APIs. It does not own source data and does not create cached report snapshots in V1.

## Ownership

- `report` composes compact dashboard responses.
- `finance` owns revenue, cost, profit, and margin snapshots.
- `order` owns order item status.
- `production` owns production task status and blockers.
- `vendorSubmission` owns vendor handoff state.
- `shipment` owns tracking and shipment status.

## Boundaries

- `report` may call source modules through `public.js` only.
- `report` must not import source module models, repositories, services, validators, DTOs, or controllers.
- Report routes use `REPORTS:READ`.
- Shop-scoped report access is applied before calling source module summary ports.

## V1 Non-Goals

- No report cache tables.
- No export jobs.
- No ads allocation to order profit.
- No vendor invoice reconciliation.
