# Background flow implementation and measured limits

The new execution paths are opt-in. `RUNTIME_ROLE=combined` remains the default;
tracking queue, durable finance recalculation and durable mapping side effects default
to false. Implementation and local tests do not authorize production activation.
See [cutover and rollback](background-flow-cutover.md) before enabling any flag.

## Tracking

`VENDOR_TRACKING_QUEUE_ENABLED=true` changes the enabled scheduler into bounded
discovery/dispatch every 30 seconds. MongoDB polling state owns the next eligible time,
attempt and lease; an unchanged response remains due after 60 minutes. Invalid references
back off for a day, transient failures use jittered backoff, and 429 honors Retry-After.
Actual vendor quotas still need validation before activation.

API manual checks and workers share Redis admission: one in-flight call per provider/client
identity and two globally. Credential identifiers are hashed in lock keys. Verify providers'
credential metadata identifies the true quota-sharing client before rollout. The guard
covers applying the result; worker shipment writes also update the poll lease within the
same MongoDB transaction, preventing a reclaimed poll from committing stale shipment data.
A canonical pending result survives interruption between shipment persistence and order/timeline effects. Retries repair the committed state without refetching the vendor result or overwriting newer manual tracking. Manual checks can still refresh already-shipped items. Discovery summaries report queued counts; actual execution duration remains in worker logs.

## Finance

`FINANCE_DURABLE_RECALCULATION_ENABLED=true` persists a requested version before queue
notification. The worker uses an order-level MongoDB transactional guard shared with manual
whole-order/item recalculation and actual-cost updates. Snapshot, audit, request completion
and import-batch progress commit together. Concurrent refund allocations reread and validate the balance on each transaction retry, and commit their audit and recalculation requests together. Updates that race execution remain pending or
cause a transaction retry. Batch-item completion/failure is counted once.

The scheduler recovers pending signals and visits 100 order items per minute through a
persisted cursor. It compares snapshot calculation time with order-item, fee/refund and
fulfillment-plan updates, recovering missing notifications even for existing snapshots.
After terminal job failure, that version remains blocked with failure metadata; a newer
source request can retry it. The rolling scanner does not silently reactivate failed work.

Shipment-only changes, seller-dimension changes and deleted/reassigned sources without a
revision/tombstone still use a seven-day safety refresh plus cursor traversal when their
normal recalculation notification is missing. This is an explicit freshness limit; the
implementation does not promise immediate repair for every unversioned source mutation.
No financial formulas or shared-session parallel writes were introduced.

## Mapping and import

`MAPPING_DURABLE_SIDE_EFFECTS_ENABLED=true` saves requested item effects in a MongoDB
document keyed by order before sending a Redis signal. The worker claims that order,
executes item transitions sequentially and refreshes cost/PSD projections once. An
update arriving during processing keeps the request pending for another pass. Claims
expire after 120 seconds and renew every 40 seconds; a stale owner cannot acknowledge
or remove a newer owner's request. Existing production-task idempotency and status
guards remain authoritative. This is at-least-once execution, not exactly once.

Redis failure after the request is saved returns a durable outcome and does not execute
the heavy fallback inside HTTP. The scheduler scans at most 100 due orders every 30
seconds and signals groups of 10 through BullMQ addBulk. Three failed runs block the
request with lastErrorCode; it remains available in the request collection for diagnosis.
A new authorized source request resets the failure state. No vendor submission retries
are performed by this flow. A failure before request persistence is still an API failure,
not successfully accepted background work.

Before each listing-image eligibility check, post-import asks whether any imported
record remains unfinished using an existing import-job index and an ID-only query.
It loads the full import only when eligible, and retains the final status check to
handle concurrent changes. Listing/image enqueue idempotency is unchanged.

## Deterministic fixture measurements

These are calls made by real service functions with fixture-backed repository spies,
not measured production timings or a claimed throughput percentage.

| Same workload | Previous path | New path |
| --- | ---: | ---: |
| Ten item side effects: order-item context reads | 20 | 1 per claimed batch |
| Ten item side effects: bulk plan reads for statuses | 20 | 1 per claimed batch |
| Ten item side effects: order projection writes | 20 | 1 per claimed batch |
| Twenty eligibility checks while import unfinished: full import loads | 20 | 0 (20 bounded existence checks) |
| Recovery signals for 100 due mapping orders | 100 add calls | 10 addBulk calls |

The final statuses on the ten-item fixture remain PRESENT for both cost center and PSD.
If items arrive in separate worker batches, each batch refreshes once; no time-window
coalescing or latency guarantee is claimed. Independent order jobs retain the existing
worker concurrency of five. No import concurrency increase is included.

## Remaining operational gates

Collect one complete production day including an import burst before activating faster
tracking concurrency or splitting processes. Confirm provider quotas, API p95, MongoDB
latency, queue age and restart recovery. Retain and inspect failed business-data jobs;
do not blindly retry vendor submissions. The metrics endpoint remains disabled.

## Verification

Final local Jest: 462 suites and 3,926 tests passed; three suites and 23 tests skipped. Startup smoke passed. Jest still reports the pre-existing forced worker teardown warning. Focused Mongo replica-set and isolated Redis tests passed; the three-process local restart/outage rehearsal passed. Production activation and performance measurements remain unverified.
