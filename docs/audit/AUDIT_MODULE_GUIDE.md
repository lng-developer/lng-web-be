# Audit Module Developer Guide

The Audit module stores centralized, append-only evidence for selected high-risk platform actions. It is a compliance timeline, not a replacement for every domain's own history.

Base path: `/api/audit`.

## Boundary And Ownership

Audit owns `AuditEvent`, event validation/sanitization, deduplicated recording, scoped reads, and cursor pagination. Domain services decide when an event belongs in the central ledger and call `src/modules/audit/public.js`.

`MappingRuleAudit`, Order timelines, Vendor Submission status history, payroll email jobs, and other domain histories remain authoritative in their modules. The source-backed coverage decision for every mutation family is maintained in [AUDIT_EVENT_CATALOG.md](./AUDIT_EVENT_CATALOG.md).

## Event Contract

| Group | Fields |
|---|---|
| Actor | `actorType`, optional `actorAccountId`, safe `actorSnapshot` |
| Action | `action`, `entityType`, `entityId`, `outcome`, `source` |
| Scope | paired `scopeType` and `scopeId` |
| HTTP provenance | `requestId`, `ipAddress`, `userAgent` |
| Details | sanitized `changes`, `metadata` |
| Identity | required unique `deduplicationKey`, immutable `createdAt` |

Actors are `ACCOUNT`, `SYSTEM`, or `ANONYMOUS`; an account actor requires `actorAccountId`. Outcomes are `SUCCEEDED` or `FAILED`. Sources are `HTTP`, `WORKER`, `SYSTEM`, or `IMPORT`.

Action, entity type, and scope type use uppercase code syntax. Entity/scope ids are bounded strings so Audit can represent Mongo ids and stable external/domain identifiers without importing their models.

## Append-Only And Idempotency

`record()` validates the event and performs `findOneAndUpdate` with `$setOnInsert` on `deduplicationKey`. A replay returns the existing event without modifying it. The model has no `updatedAt`, update service, or delete route.

The deduplication key is a server-owned business operation identity, not an HTTP request id. Domain services may pass a Mongo session so the event commits or rolls back with the owning mutation.

## Data Safety

Before Joi validation, Audit recursively sanitizes actor snapshot, changes, and metadata:

- maximum depth is 5;
- total serialized detail size is 16 KiB;
- password/token/secret/authorization/cookie-like keys are removed;
- prototype-control and serialization-hook keys are removed;
- getters, setters, circular values, non-plain objects, non-finite numbers, and malformed arrays are rejected;
- Date and ObjectId values are copied safely.

Sanitization is defense in depth. Callers must still send allowlisted identifiers, status changes, counts, and bounded provenance rather than raw rows, file contents, free-form secrets, credentials, or unnecessary PII.

## Read Authorization

Global `AUDIT:READ` or Super Admin can read the full ledger. Otherwise, readable scope pairs are derived from authenticated scopes on which `AUDIT:READ` is effective.

Scoped readers:

- receive a repository `$or` constraint before the query runs;
- receive no results when they have no readable scope;
- cannot explicitly request a different `scopeType + scopeId`;
- cannot read an event by id outside their scopes.

Unscoped events are visible only to global readers.

## Query And Pagination

`GET /events` supports actor, action, entity, scope, outcome, source, request id, date range, cursor, and limit filters. Limits are 1-100, default 20. Date filtering requires both endpoints and permits at most 366 days.

Results sort by `createdAt DESC, _id DESC`. `nextCursor` is an opaque base64url payload containing that pair; clients must return it unchanged.

`GET /events/:eventId` applies the same scope rules. `/health` is unauthenticated; both event routes require authentication plus `AUDIT:READ` at the route boundary.

## Index Lifecycle

The model defines unique deduplication and timeline indexes for entity, actor, scope, action, and default chronological reads. `ensureAuditIndexes.js` verifies/creates the required indexes; its proof mode must target only a disposable isolated database. `migrateLegacyAuditEvents.js` supports dry-run-first migration.

## Public Port

The public port exposes only `record(payload, { session })`. Read APIs are owned by Audit's HTTP service and are not general cross-module query ports.

## Change Checklist

- Add central events only when the coverage catalog classifies the mutation as audited.
- Keep the event in the same transaction as the owning write when atomic evidence is required.
- Use stable server-owned deduplication keys.
- Never bypass the sanitizer or store secrets/raw payloads.
- Keep scoped filters inside repository queries.
- Preserve append-only schema and cursor ordering.
- Update the event catalog and executable evidence together.
- Run `npm test -- --runInBand tests/audit` and `npm run test:architecture -- --runInBand`.
