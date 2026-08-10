# Notification Module Developer Guide

The Notification module provides a persistent per-account inbox and best-effort internal delivery port. It currently stores in-app notifications only; it does not send email, SMS, push, or websocket events.

Base path: `/api/notifications`.

## Boundary

Notification owns the inbox record, recipient isolation, unread state, idempotent creation, pagination, and legacy migration. Calling modules own the business event, recipient selection, message wording, and related-resource authorization.

Current producers include HR approvals/announcements/payroll, Order assignment, Production assignment, Vendor Submission failures, and Shipment delivery events. They import `src/modules/notification/public.js` rather than the model or service.

## Notification Record

```text
recipientAccountId
type
title
message
relatedResource: { type, id } | null
deduplicationKey
readAt
createdAt / updatedAt
```

The unique identity is `recipientAccountId + deduplicationKey`. `type` and related-resource values are intentionally open strings; there is no central notification-type enum or foreign-key validation.

## Delivery Semantics

The internal `notify()` service creates the record. On a duplicate-key race, it loads and returns the existing notification, making a repeated business event idempotent for that recipient.

The public port wraps delivery as best-effort:

```text
success -> { delivered: true, id }
failure -> { delivered: false, errorCode, correlationId }
```

It logs failures and does not throw them back to the business caller. This prevents a notification outage from rolling back the owning workflow.

`notifyMany()` deduplicates recipient ids and builds one key per recipient as `<deduplicationKeyPrefix>:<recipientAccountId>`. Delivery runs concurrently and returns one result per unique recipient. Callers must provide a stable, non-empty prefix; the port does not validate message shape before interpolating it.

## Inbox And Read State

All HTTP routes use the authenticated `req.auth.accountId`; clients cannot supply another recipient id.

`GET /` returns one account's inbox with optional `unreadOnly`, page, and limit. Unread rows sort first, then newest creation/id. Default limit is 20 and maximum is 100.

`GET /unread-count` counts only that account's rows with `readAt=null`.

`PATCH /:id/read` updates only a row matching both notification id and current recipient. A foreign or missing id returns the same 404. Calling it again writes a fresh `readAt`; it is not a no-op/idempotent timestamp operation.

`PATCH /read-all` updates only currently unread rows for the current recipient and returns `updatedCount`.

There are no create, delete, archive, preference, channel, or public administrator endpoints.

## Authorization

Inbox routes require authentication but no named permission. Isolation is account-owned in every repository read/update filter. Related-resource links do not grant access: the destination module must authorize the resource again when opened.

Notification acknowledgement is intentionally excluded from central Audit because it is low-risk per-user delivery state.

## Public Port

`src/modules/notification/public.js` exposes:

- `notify()` for one best-effort delivery;
- `notifyMany()` for fan-out with per-recipient deduplication;
- `migrateLegacyItems()` for controlled HR migration;
- `routeContracts` for readiness/audit tooling.

Legacy migration is dry-run by default at the repository boundary. Apply uses unordered bulk upserts by recipient and deduplication key, returning inserted/updated/unchanged/failed counts rather than throwing individual row failures.

## Endpoint Summary

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/` | List the current account's inbox. |
| `GET` | `/unread-count` | Return current unread count. |
| `PATCH` | `/read-all` | Mark every unread item read. |
| `PATCH` | `/:id/read` | Mark one owned item read. |

## Change Checklist

- Keep recipient identity server-derived for HTTP operations.
- Include `recipientAccountId` in every repository read/update filter.
- Give producers stable business deduplication keys.
- Preserve best-effort public-port behavior unless the owning workflow explicitly requires atomic delivery.
- Reauthorize related resources in their owning modules.
- Do not add transport/channel abstractions until a real non-inbox channel exists.
- Run `npm test -- --runInBand tests/notification` and `npm run test:architecture -- --runInBand`.
