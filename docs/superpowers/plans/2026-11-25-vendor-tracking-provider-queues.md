# Vendor tracking provider queues implementation plan

**Goal:** Fair provider dispatch and observable tracking progress, with no production activation in this change.
**Architecture:** Reuse Mongo poll leases and pending updates. One BullMQ worker per provider in the existing process, concurrency one each; retain the shared two-request admission guard. Keep a legacy consumer for already queued jobs. Existing global tracking-config endpoint returns aggregated poll state without order/customer identifiers.
**Spec:** User-approved audit and rollout proposal in this chat.

- [x] Provider queues, provider-indexed due selection, isolated discovery errors, legacy drain; tests for dispatch fairness and duplicate work.
- [x] Worker reads enabled/interval settings before claiming; shared client pacing and Retry-After; tests for disabled mode and configured cadence.
- [x] Read-only provider statistics on tracking-config response; FE compact table with due/processing/scheduled/error/completed counts and last attempt. Poll every five seconds only in visible UI. Keep legacy results when queue is disabled.
- [x] Run shipment/architecture tests, FE focused tests/lint/build; review both diffs, open PRs targeting develop.

## Constraints and rollout

Do not modify staged RBAC/deployment documents or the unrelated Finance design. Do not enable outbound on dev, enable queue on prod, or merge PRs. Run the existing background index maintenance with the explicitly verified target database before activation. New index: provider, nextCheckAt, _id. Queue state counts are durable poll records, not cumulative API request counts. Errors remain visible until a later successful attempt. Pacing is a configurable conservative floor, not a claim about vendor quotas. Verify real quota before production activation.

## Verification focus

Disabled scheduling must stop queued vendor calls; provider failure must not prevent other providers' dispatch; retry and lease loss retain pending writes; old queue jobs can drain; monitoring failure is unavailable, never fake zero; UI must distinguish queued discovery from actual checked work.

## Verification and release notes

- Shipment/runtime/architecture run passed 245 tests before final pacing changes; final pacing/worker/shipment targeted run passed 93 tests and final DTO/architecture run passed 26 tests. Independent review reran worker/Redis guard: 13 passed.
- FE lint: zero errors, two pre-existing warnings outside this change. Production build passed. Shipment page: five tests passed; new card: three tests passed.
- Redis/Mongo test services are isolated locally. No live vendor requests or production mutations.
- VENDOR_TRACKING_MIN_INTERVAL_MS defaults to 1000ms pause after each request for the same provider credential. Manual calls wait at most two seconds for admission; longer contention is explicitly skipped. Workers retain the same delayed job while waiting for admission.
- Queue monitor counts describe discovered Mongo poll state, not cumulative requests. Errors overlap waiting/scheduled retries. Global counts require global SHIPMENTS:WRITE. Manual requests are not included.
- Before activation, verify database name and run npm run indexes:background-flow on the approved release. Keep a legacy queue consumer until previous jobs/poll records drain. Do not delete poll records or Redis queues on rollback. Turn queue flag off and restart to use legacy polling; turn Tracking sync off to prevent new queued vendor calls (in-flight requests may finish).
- Test dev with mocked vendor adapters or controlled credentials; keep outbound isolation. Confirm quotas before production activation; no vendor quota is assumed by this patch.
