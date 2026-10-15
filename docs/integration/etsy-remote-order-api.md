# Etsy remote Orders protocol v1

Base: `/api/integration/extension-commands`. All agent endpoints require a valid scoped Extension Bearer token and ORDERS:WRITE. Web creation uses the existing user permission and shop access checks.

Agent identity on every request: `clientId`, `label`, optional `version`/`apiBaseUrl`, `provider: "ETSY"`, `protocolVersion: 1`.

- `POST /agent/heartbeat`: returns agent DTO including provider/version. Clients must not claim remote Etsy work without this acknowledgement.
- `POST /commands` (web user): `{type:"IMPORT_NEW_ORDERS",shopId,agentId,maxOrders:1}`. Integer count 1–200; default 1. Server derives provider and WEB origin. Etsy schedules/other command types are rejected.
- `POST /agent/claim`: returns `{command,leaseToken}` or null. Etsy query accepts only WEB Orders with a valid count, atomically; unsupported queued tasks are not acquired.
- `POST /agent/commands/:commandId/start`: identity plus `leaseToken`; CLAIMED → RUNNING.
- `POST /agent/commands/:commandId/renew`: identity plus `leaseToken` and optional `importJobId`. Extends a matching, unexpired active lease by five minutes. Job must be authorized, same shop, salesChannelCode ETSY and idempotencyKey equal to commandId. Returns command DTO; no token/hash. Terminal leases cannot renew.
- `POST /agent/commands/:commandId/complete`: identity, leaseToken, success, optional importJobId, importedCount, failedCount, errorMessage. Clears active lock. Repeated completion for the same Etsy lease acknowledges the existing terminal result without reopening it. Only the hash remains server-side for this acknowledgement; expired leases have their hash removed.

Command DTO additions: provider, origin, maxOrders. Expired Etsy active tasks are presented as FAILED with `Extension lease expired`, even before reconciliation. Expired claims are not requeued. Job evidence is retained.

Order CSV and manifest routes remain unchanged. Use the exact command ID as CSV idempotency key and preserve the exact CSV bytes on resume. This protocol does not enable production/vendor submission.

The current generated integration collection only inventories the external-order-import nested router, not extension-commands. This document and the lease controller/service contract tests are the protocol source for this change; no broad inventory-generator expansion is included.
