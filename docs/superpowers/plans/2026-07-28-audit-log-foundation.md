# Audit Log Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a transaction-aware, searchable central audit trail and connect the highest-risk security and operations mutations to it.

**Architecture:** Extend the existing Audit module instead of adding infrastructure. Business services record explicit events through `audit/public.js`; existing domain timelines remain intact. Audit writes join existing Mongo sessions where available, while read APIs use `AUDIT:READ` and stored scope fields for authorization.

**Tech Stack:** Node.js, Express, CommonJS, Mongoose, Joi, Jest, MongoDB transactions.

## Global Constraints

- Work on branch `feat/auditlig` based on `develop`.
- Preserve the user's existing `.codegraph/.gitignore` modification.
- Cross-module calls use only the target module's `public.js`.
- No Kafka, Elasticsearch, OpenTelemetry, SIEM, new runtime dependency, TTL index, or generic audit-all-requests middleware.
- Never persist passwords, tokens, secrets, raw payroll amounts, or unnecessary PII.
- Keep MappingRuleAudit, OrderTimeline, and VendorSubmission status history.
- Use TDD: add a focused failing test, observe the expected failure, implement the minimum behavior, then rerun.
- Stage and commit only files owned by the current task.

---

### Task 1: Audit event contract, sanitization, transactions, and production indexes

**Files:**
- Modify: `src/modules/audit/models/auditEvent.model.js`
- Modify: `src/modules/audit/repositories/auditEvent.repository.js`
- Modify: `src/modules/audit/services/auditEvent.service.js`
- Modify: `src/modules/audit/dtos/auditEvent.dto.js`
- Modify: `src/modules/audit/public.js`
- Create: `src/modules/audit/validators/auditEvent.validator.js`
- Create: `src/modules/audit/scripts/ensureAuditIndexes.js`
- Modify: `package.json`
- Modify: `src/test/audit/audit.persistence.test.js`
- Create: `src/test/audit/auditEvent.service.test.js`
- Create: `src/test/audit/ensureAuditIndexes.test.js`

**Interfaces:**
- Produces: `auditPublic.record(payload, { session } = {}) -> AuditEventDto`.
- Produces: sanitized top-level event fields from the approved design spec.
- Produces: `npm run indexes:audit -- --proof` for idempotent index verification/creation.

- [ ] **Step 1: Write failing contract tests**

Cover valid `ACCOUNT`, `SYSTEM`, and `ANONYMOUS` events; rejection of invalid enums/IDs; removal of keys matching `password`, `token`, `secret`, `authorization`, `cookie`, `__proto__`, `constructor`, and `prototype`; bounded metadata depth/serialized size; duplicate-key replay; and repository receipt of the supplied Mongoose session.

```js
await expect(auditPublic.record({
  actorType: 'ACCOUNT', actorAccountId, action: 'ACCOUNT_UPDATED',
  entityType: 'AUTH_ACCOUNT', entityId: String(actorAccountId),
  outcome: 'SUCCEEDED', source: 'HTTP', deduplicationKey: 'auth:account:1:updated',
  metadata: { password: 'remove-me', safe: 'keep-me' },
})).resolves.toMatchObject({ metadata: { safe: 'keep-me' } });
```

- [ ] **Step 2: Run focused tests and observe expected failures**

Run: `npx jest src/test/audit/auditEvent.service.test.js src/test/audit/audit.persistence.test.js --runInBand`

- [ ] **Step 3: Implement the minimum validated contract**

Use Joi and a small recursive sanitizer. Keep frequently filtered fields top-level, set `timestamps: { createdAt: true, updatedAt: false }`, and pass `{ session }` only through the Audit repository.

```js
async function record(payload, { session } = {}) {
  const value = validateAndSanitizeAuditEvent(payload);
  return toAuditEventDto(await repository.create(value, { session }));
}
```

- [ ] **Step 4: Add and test the index lifecycle script**

The script must preflight duplicate deduplication keys before creating the unique index, compare required definitions, produce safe proof output without event contents, and never delete or rebuild a conflicting index automatically.

- [ ] **Step 5: Verify and commit**

Run: `node -c` for every changed JS file, the three focused Audit tests, and `git diff --check`.

Commit: `feat(audit): harden audit event persistence`

---

### Task 2: Authorized cursor-paginated Audit read API

**Files:**
- Modify: `src/modules/audit/repositories/auditEvent.repository.js`
- Modify: `src/modules/audit/services/auditEvent.service.js`
- Modify: `src/modules/audit/dtos/auditEvent.dto.js`
- Modify: `src/modules/audit/routes/index.js`
- Create: `src/modules/audit/controllers/auditEvent.controller.js`
- Create: `src/modules/audit/validators/auditEventQuery.validator.js`
- Create: `src/test/audit/auditEvent.query.test.js`
- Create: `src/test/audit/audit.routes.test.js`

**Interfaces:**
- Consumes: `auditPublic.record(payload, { session })` from Task 1 without changing it.
- Produces: `GET /api/audit/events` and `GET /api/audit/events/:eventId` guarded by `authenticate` and `AUDIT:READ`.

- [ ] **Step 1: Write failing service and route tests**

Test descending `{ createdAt, _id }` cursor order; `limit` bounded to `1..100`; actor/action/entity/scope/outcome/source/requestId/date filters; invalid ranges; global readers; scoped readers; out-of-scope detail returning not found/forbidden according to existing authorization conventions; and raw Mongo documents never escaping DTOs.

```js
await request(app).get('/api/audit/events?entityType=ORDER&limit=25')
  .set('Authorization', bearer)
  .expect(200)
  .expect(({ body }) => expect(body.data).toEqual(expect.objectContaining({ items: expect.any(Array) })));
```

- [ ] **Step 2: Run focused tests and observe expected failures**

Run: `npx jest src/test/audit/auditEvent.query.test.js src/test/audit/audit.routes.test.js --runInBand`

- [ ] **Step 3: Implement lean repository queries and scope enforcement**

Build Mongo filters only from validated values. Use `.lean()`, deterministic cursor pagination, DTO mapping, and `authPublic.canAccessScope`/auth-context scope data rather than role-name branching.

- [ ] **Step 4: Verify and commit**

Run focused Audit tests, `npm run test:architecture -- --runInBand`, syntax checks, and `git diff --check`.

Commit: `feat(audit): add authorized audit event queries`

---

### Task 3: Authentication and session security events

**Files:**
- Modify: `src/modules/auth/controllers/auth.controller.js`
- Modify: `src/modules/auth/services/authManager.service.js`
- Modify: `src/test/auth/services/authManager.service.test.js`
- Modify or create: focused Auth route tests for request context.

**Interfaces:**
- Consumes: `auditPublic.record(payload, { session })`.
- Produces events: `AUTH_LOGIN_SUCCEEDED`, `AUTH_LOGIN_FAILED`, `AUTH_SESSION_REFRESHED`, `AUTH_LOGOUT`, and `AUTH_SESSIONS_REVOKED` where the operation exists.

- [ ] **Step 1: Write failing tests**

Assert successful login records account/request/IP/user-agent context; unknown-account and wrong-password failures use `ANONYMOUS`, store no raw identifier/password/token, and cannot turn an expected authentication rejection into success; logout never stores the refresh token.

```js
expect(auditPublic.record).toHaveBeenCalledWith(expect.objectContaining({
  actorType: 'ANONYMOUS', action: 'AUTH_LOGIN_FAILED', outcome: 'FAILED', source: 'HTTP',
  metadata: expect.not.objectContaining({ password: expect.anything() }),
}), expect.any(Object));
```

- [ ] **Step 2: Observe RED, then implement minimal request-context plumbing**

Pass `{ requestId: req.id, ipAddress: req.ip, userAgent: req.get('user-agent') }` explicitly from controllers. Keep auth context separate from HTTP context.

- [ ] **Step 3: Verify and commit**

Run focused Auth tests, `npm run test:auth -- --runInBand`, syntax checks, architecture tests, and `git diff --check`.

Commit: `feat(auth): audit authentication security events`

---

### Task 4: Auth administration and RBAC mutation events

**Files:**
- Modify: `src/modules/auth/controllers/authAdmin.controller.js`
- Modify: `src/modules/auth/services/authAdmin.service.js`
- Modify repositories only where an existing transaction session must be threaded through.
- Modify: `src/test/auth/services/authAdmin.service.test.js`
- Modify focused Auth admin route tests.

**Interfaces:**
- Consumes: Task 1 Audit public port.
- Produces successful events for account create/status/email/password/session/access/archive, scope create/update/deactivate, access assignment create/update/deactivate, scoped-role permission changes, role create/update/delete and role-permission changes, and permission create/update/delete.

- [ ] **Step 1: Write one table-driven failing test per mutation family**

Each assertion includes actor, target entity, stable action, sanitized changed fields, scope when applicable, and a namespaced deduplication key. Password reset events record only that a reset occurred.

- [ ] **Step 2: Observe RED, then add a small local `recordAdminAudit` helper**

Do not create a generic cross-module abstraction. Reuse existing before/after DTO-safe projections and include the audit write in the same Mongo transaction where the service already owns one.

- [ ] **Step 3: Verify and commit**

Run all Auth tests, architecture tests, syntax checks, and `git diff --check`.

Commit: `feat(auth): audit account and rbac administration`

---

### Task 5: Finance import and recalculation events

**Files:**
- Modify: `src/modules/finance/services/financeImport.service.js`
- Modify: `src/modules/finance/services/financeSnapshot.service.js`
- Modify controllers only to pass request context when necessary.
- Modify: focused Finance service tests.

**Interfaces:**
- Produces: `FINANCE_TRANSACTIONS_IMPORTED`, `FINANCE_SETTLEMENTS_IMPORTED`, `FINANCE_ADS_IMPORTED`, `FINANCE_IMPORT_REPROCESSED`, `FINANCE_ORDER_ITEM_RECALCULATED`, and `FINANCE_ORDER_RECALCULATED`.

- [ ] **Step 1: Write failing tests for successful, dry-run, replay, and failed imports**

Events store batch/entity IDs, source type, accepted/rejected row counts, scope, and outcome. They never store uploaded file bytes, raw rows, settlement financial details, or secrets. Dry runs that do not mutate state use explicit preview metadata and do not masquerade as persisted imports.

- [ ] **Step 2: Observe RED and implement service-level events**

Join existing sessions where available; otherwise use stable operation IDs and preserve current idempotency behavior.

- [ ] **Step 3: Verify and commit**

Run focused Finance tests, architecture tests, syntax checks, and `git diff --check`.

Commit: `feat(finance): audit imports and recalculations`

---

### Task 6: Order and Production human-operation events

**Files:**
- Modify only mutation-owning services under `src/modules/order/services/`.
- Modify: `src/modules/production/services/productionTask.service.js`
- Modify focused Order and Production service tests.

**Interfaces:**
- Produces central events for case create/update/resolve/cancel/comment, fulfillment-ready/recheck/replacement/cancel, customer/shipping/assignment changes, production bulk/single assignment, claim, notes/status, file checks, QC, and sent-to-vendor transitions.

- [ ] **Step 1: Inventory mutation functions and write table-driven failing tests**

Exclude read-only preview/validation operations unless they persist state. Reuse entity IDs, shop scope, actor IDs, and stable outcomes already available in services.

- [ ] **Step 2: Observe RED and add explicit Audit public-port calls**

Keep OrderTimeline intact. When an operation already appends a timeline, use the same normalized event inputs but do not make Audit import Order internals.

- [ ] **Step 3: Verify and commit**

Run focused Order and Production suites, architecture tests, syntax checks, and `git diff --check`.

Commit: `feat(operations): audit order and production actions`

---

### Task 7: Vendor, submission, and shipment lifecycle events

**Files:**
- Modify: `src/modules/vendor/services/vendor.service.js`
- Modify: `src/modules/vendorSubmission/services/vendorSubmission.service.js`
- Modify: `src/modules/shipment/services/shipment.service.js`
- Modify: `src/modules/shipment/services/shipmentWebhook.service.js` only for trusted source/system context.
- Modify focused Vendor, VendorSubmission, and Shipment tests.

**Interfaces:**
- Produces vendor configuration/cost/product changes, submission create/submit/fail/retry/cancel transitions, and shipment/tracking/status events with shop scope and actor/source classification.

- [ ] **Step 1: Write failing lifecycle tests**

Assert human actions use `ACCOUNT`; schedulers/webhooks use `SYSTEM` or `IMPORT`; vendor credentials, outbound payload secrets, webhook signatures, and raw responses are never stored.

- [ ] **Step 2: Observe RED and mirror significant domain-history transitions**

Keep embedded status history and OrderTimeline unchanged. Use their existing actor/status/reason inputs to construct sanitized central events.

- [ ] **Step 3: Verify and commit**

Run focused module tests, architecture tests, syntax checks, and `git diff --check`.

Commit: `feat(operations): audit vendor and shipment lifecycles`

---

### Task 8: Remaining HR high-risk gaps

**Files:**
- Modify mutation services under `src/modules/hr/services/employeeProfile.service.js`, `attendance.service.js`, `schedule.service.js`, `calendarPolicy.service.js`, `leave.service.js`, `overtime.service.js`, and `announcement.service.js`.
- Modify focused HR service/lifecycle tests.

**Interfaces:**
- Produces events for employee create/update/delete/restore, attendance check-in/out/manual correction, leave balance administration, schedules/calendars, announcements, request creation/attachments, and intermediate approval steps.

- [ ] **Step 1: Write failing tests for each mutation family**

Exclude ordinary self-service reads. Audit sensitive HR exports/reads already identified by the design. Do not store compensation, contact/address, DOB, attachment contents, or unrelated employee PII.

- [ ] **Step 2: Observe RED and extend existing HR audit helpers**

Write transaction-scoped events inside existing leave transactions. Preserve existing actor snapshots and domain history. Use operation-specific deduplication keys so multi-level approvals and partial refunds remain distinct.

- [ ] **Step 3: Verify and commit**

Run HR tests, architecture tests, syntax checks, and `git diff --check`.

Commit: `feat(hr): complete high-risk audit coverage`

---

### Task 9: Whole-branch verification and coverage proof

**Files:**
- Create: `docs/audit/AUDIT_EVENT_CATALOG.md`
- Create or modify only verification tests required to close discovered coverage gaps.

**Interfaces:**
- Produces a catalog mapping action codes to actor/source/entity/scope/metadata rules and owning module.

- [ ] **Step 1: Generate a source-backed coverage ledger**

List every mutation route, classify it as audited/domain-history-only/intentionally skipped, and link it to a test. No route may remain unclassified.

- [ ] **Step 2: Run full verification**

Run all changed-file syntax checks, focused module suites, `npm run test:architecture -- --runInBand`, `npm test -- --runInBand`, `git diff --check`, and the Audit index script proof against an isolated test database only.

- [ ] **Step 3: Independent final review and commit**

Resolve every Critical/Important reviewer finding, rerun affected tests, inspect `git diff develop...HEAD`, and commit documentation/tests as:

`docs(audit): document audit event coverage`
