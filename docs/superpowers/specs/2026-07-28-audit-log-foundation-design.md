# Audit Log Foundation Design

## Goal

Provide one append-only, searchable audit trail that answers who performed a security-sensitive or business-significant action, on which entity and scope, when it happened, and whether it succeeded. Keep existing domain histories for their current UI use while making important events discoverable across modules.

## Chosen approach

Use the existing MongoDB `audit` module as the central write and read boundary. Business services explicitly record meaningful events through `audit/public.js`; HTTP middleware only supplies request context and does not infer business events. Existing Mapping history, OrderTimeline, and VendorSubmission status history remain in place.

This is preferred over:

- Auditing every mutating HTTP request in middleware, which cannot reliably identify the entity, before/after state, transaction result, or background work.
- Introducing Kafka, Elasticsearch, or a separate audit service before MongoDB query volume proves they are needed.

## Event contract

An audit event contains:

- `actorType`: `ACCOUNT`, `SYSTEM`, or `ANONYMOUS`.
- `actorAccountId`: account identifier when known.
- `actorSnapshot`: sanitized display identity captured at event time.
- `action`: stable uppercase action code.
- `entityType` and `entityId`: stable target identity.
- `scopeType` and `scopeId`: authorization scope when applicable, including shop scope.
- `outcome`: `SUCCEEDED` or `FAILED`.
- `source`: `HTTP`, `WORKER`, `SYSTEM`, or `IMPORT`.
- `requestId`, `ipAddress`, and `userAgent`: sanitized request context when available.
- `changes`: optional sanitized before/after or changed-field information.
- `metadata`: bounded, sanitized supporting context that must never contain passwords, access tokens, refresh tokens, secrets, raw payroll amounts, or unnecessary PII.
- `deduplicationKey`: globally unique, namespaced idempotency key.
- `createdAt`: immutable occurrence timestamp.

Frequently filtered values remain top-level fields. Optional detail belongs in `metadata`; no speculative per-module schema is introduced.

## Validation and sanitization

The audit service validates every public-port write before persistence. It rejects malformed action/entity/scope/outcome/source values, oversize metadata, and invalid identifiers. A small recursive sanitizer removes explicitly forbidden secret keys and dangerous object keys before storage.

Audit callers remain responsible for selecting business-safe before/after fields. The central sanitizer is a final safety boundary, not permission to serialize complete Mongo documents.

## Consistency

`auditPublic.record(payload, { session })` supports an existing Mongoose session. When a business mutation already uses a Mongo transaction, its audit event is written inside the same transaction.

For critical single-document mutations that currently commit before audit, the service flow is changed to use one transaction for the mutation and event where practical. Existing idempotency keys make safe retries deterministic. Background actions identify `SYSTEM` or `WORKER` origin instead of silently using a null actor.

No outbox is added in this phase. Add one only if a required event must cross database or external-service transaction boundaries.

## Production indexes

Provide an idempotent audit index script because production disables Mongoose `autoIndex`. The script verifies conflicting indexes before creating the required definitions:

- Unique `{ deduplicationKey: 1 }`.
- Entity timeline `{ entityType: 1, entityId: 1, createdAt: -1, _id: -1 }`.
- Actor timeline `{ actorAccountId: 1, createdAt: -1, _id: -1 }`.
- Scope timeline `{ scopeType: 1, scopeId: 1, createdAt: -1, _id: -1 }`.
- General time/action query `{ action: 1, createdAt: -1, _id: -1 }`.

No TTL index is created. Retention and archival require a separate business decision.

## Read API and authorization

Add these authenticated routes:

- `GET /api/audit/events`: cursor-paginated list filtered by actor, action, entity, scope, outcome, source, request ID, and date range.
- `GET /api/audit/events/:eventId`: one event detail.

Both require the existing `AUDIT:READ` permission. Non-global scoped readers may only query events whose stored scope is within their authorized scopes. Responses use DTOs and never expose raw Mongo documents.

The first phase does not add an API to update or delete audit events. Audit export is deferred until the list API and permission model are proven.

## Coverage rollout

Coverage is implemented in this order:

1. Auth and RBAC: login success/failure, logout/session revocation, account lifecycle, password/email changes, access assignments, scoped permissions, roles, and permissions.
2. Finance: imports, reprocessing, and recalculation.
3. Order and Production: case transitions, fulfillment/cancellation/address or assignment changes, production assignment/QC/vendor transitions.
4. Vendor, VendorSubmission, and Shipment: vendor configuration changes, submission lifecycle, tracking and shipment state changes.
5. Remaining HR gaps: employee profiles, attendance corrections, balances, schedules, calendars, announcements, and intermediate approval steps.

Preview-only calls and notification read markers are not audited. Sensitive data reads are audited only where they expose or export payroll, finance, credentials, or PII.

## Existing histories

- MappingRuleAudit remains the transactional before/after history for mapping rules and mirrors significant changes to the central audit trail.
- OrderTimeline remains the operator-facing order history and mirrors significant human actions to central audit.
- VendorSubmission status history remains embedded for aggregate behavior and mirrors lifecycle transitions.

These stores are not migrated or deleted in this phase.

## Failure behavior

- A validation failure prevents the audit write and surfaces an operational error before persistence.
- A duplicate deduplication key returns the previously stored event.
- A transaction-scoped audit failure rolls back the associated business mutation.
- Failed authentication attempts create `FAILED` events without storing passwords or raw tokens.
- Read endpoints reject invalid filters and enforce bounded page size and date range.

## Testing

Each task follows test-first development:

- Unit tests for validation, sanitization, DTOs, filter authorization, and idempotency.
- Persistence tests for unique indexes, cursor ordering, transaction rollback, and scoped queries.
- Route tests for authentication, `AUDIT:READ`, validation, pagination, and scope restrictions.
- Service tests for every newly audited business action, including failure and retry behavior.
- Architecture tests continue enforcing cross-module access through `audit/public.js`.

Production verification includes syntax checks, focused Audit/Auth/module tests, the architecture suite, index-script proof output, and the broad Jest suite when dependencies are available.

## Non-goals

- No Kafka, Elasticsearch, OpenTelemetry, SIEM integration, hash chain, or blockchain-style integrity mechanism.
- No automatic audit of every HTTP request.
- No frontend implementation in this backend phase.
- No destructive migration of existing histories.
- No TTL or retention deletion policy without explicit approval.
