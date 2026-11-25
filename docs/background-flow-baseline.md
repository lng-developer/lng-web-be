# Background flow baseline

This change measures existing execution. It does not change concurrency, tracking cadence,
queue retries, worker placement or the disabled metrics endpoint.

## Read-only queue snapshot

Run from the backend checkout with its existing environment:

```sh
node tools/scripts/diagnostics/snapshotBackgroundQueues.js > queue-snapshot.json
```

The script reads eight order/tracking-adjacent integration, mapping and finance queues,
disables BullMQ metadata updates, closes connections and exits nonzero on failure.
It never retries jobs, changes retention, or prints job payloads/Redis errors.
`failed` and `completed` counts are retained history, not a rate or pending backlog.
Counts and samples are read separately, so this is not an atomic snapshot.

`oldestSampledWaitingJobAgeMs` is age since creation of the oldest timestamp among
at most 100 jobs per waiting/paused/prioritized state; null means no sampled timestamp.
It is not an exact global oldest age when the queue is larger, and does not represent
time spent exclusively waiting on retries. Delayed and waiting-children jobs are counted
separately but not sampled. No user identifiers or job data appear in the output.

## Runtime logs after rollout

`background_job_finished` contains queue, jobId, outcome, attempt, durationMs and
jobAgeAtStartMs. Duration measures an execution attempt; job age includes retry delays
since original creation. Missing timestamps are null. Completion events use info level,
failures warn; LOG_LEVEL must allow info to collect successful executions. Each event
adds one small log line, so monitor existing log rotation/disk use during the baseline.
Existing business logs and error handling remain in place.

`vendor_tracking_recheck_completed` and `vendor_tracking_recheck_failed` include
startedAt, finishedAt and durationMs. Tracking settings store actual run boundaries and
lastRunSummary.durationMs for successful runs. Older records are not backfilled; legacy
recordRun callers without timing report null duration.

## Gate before throughput changes

After authorized deployment, collect one full business day including an import burst.
Sample queue counts/age periodically and correlate runtime logs with existing API and
database diagnostics: tracking duration, finance freshness, execution duration, retries,
provider 429s, API p95 and MongoDB latency. This PR alone does not measure all those
signals or prove a throughput improvement. Resolve actual per-client vendor quotas
before enabling the tracking concurrency work in the implementation plan.

Rollback is reverting this instrumentation; no schema migration or data repair is needed.
