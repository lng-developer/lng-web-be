# HR Batch 4 Attendance Import Edge Cases Design

## Goal

Make attendance imports race-safe and assign overnight punches to the correct shift work date without changing manual attendance or historical snapshots.

## Scope

- Atomically claim an attendance import batch by `sourceBatchId`.
- Reject another request while the same batch is `PROCESSING`.
- Preserve idempotent replay for a `COMPLETED` batch.
- Allow a `FAILED` batch to be claimed for retry.
- Resolve every valid punch through the canonical schedule path before grouping it.
- Attach an after-midnight punch to the preceding overnight shift when that shift window contains the instant.
- Cache repeated employee and schedule lookups within one import request.

## Batch Claim State Machine

```text
missing -> PROCESSING -> COMPLETED
                      -> FAILED
FAILED  -> PROCESSING
```

- A missing batch may be created as `PROCESSING` by exactly one request.
- A `FAILED` batch may be atomically changed back to `PROCESSING` by exactly one retry.
- A `PROCESSING` batch returns `409 CONFLICT_ERROR`.
- A `COMPLETED` batch returns `{ inserted: 0, updated: 0, unchanged: punchCount, failed: 0 }` for the incoming request and performs no attendance writes or mutation audit.
- Concurrent insert races rely on the existing unique `sourceBatchId` constraint. The losing request reads the winning state and applies the rules above.

## Punch Resolution Flow

Validate punch -> resolve Employee Profile by normalized employee code -> resolve work context for the instant -> select preceding overnight context when applicable -> otherwise select the local calendar-date context -> group by `(profileId, resolved workDateKey)` -> merge punches into Attendance Daily.

The existing `resolveContextForInstant(profileId, occurredAt)` behavior is reused rather than duplicated:

- It checks candidate work dates around the UTC date.
- A preceding overnight context wins only when the instant lies between its planned start and end.
- Otherwise a context whose Work Location local date matches `workDateKey` wins.
- No valid context produces `SCHEDULE_UNRESOLVED`; that punch is counted as failed and is not guessed into a date.

## Request-Local Caching

- Cache Employee Profile lookup by normalized `employeeCode`, including missing results.
- Cache canonical schedule contexts by `profileId` plus candidate `workDateKey`; each punch still performs its own instant-to-window selection over those cached contexts.
- Do not introduce Redis, persistent caches, or cross-request state.

Do not cache the final instant decision by local date because different instants on the same date can resolve to different overnight work dates.

## Attendance Merge Rules

- Preserve an existing `scheduleSnapshot`; never rebuild it from a later Shift or Work Location edit.
- Preserve `leaveSegments` and `manualAdjustments`.
- An `isManualEdited` record remains unchanged.
- A record already containing the same `sourceBatchId` remains unchanged.
- The earliest known instant is check-in and the latest later instant is check-out.
- One group failure increments `failed` by that group's punch count without stopping other groups.
- Any failed punch or group makes the batch `FAILED`; a zero-failure result makes it `COMPLETED`.

## Repository Contract

Replace the non-atomic `start()` behavior with a claim operation that returns whether the caller acquired ownership. Repository code owns the conditional Mongoose writes; service code maps the observed state to idempotent completion or conflict.

No transaction spans the entire import. The unique batch key and conditional claim provide ownership without holding a long MongoDB transaction across profile, schedule, and attendance processing.

## Error Contract

- Missing `sourceBatchId` or an empty punches array remains `400 VALIDATION_ERROR`.
- A batch already `PROCESSING` returns `409 CONFLICT_ERROR`.
- Invalid individual punches, unknown employees, and unresolved schedules are counted in `failed`.
- A duplicate batch claim is not reported as an individual punch failure.

## Audit

- Only the request that owns the batch records the existing import completion/failure audit.
- `PROCESSING` conflicts and `COMPLETED` replays do not create another mutation audit.
- Audit metadata remains aggregate counts only and contains no employee or punch data.

## Testing

- Repository tests cover claiming a missing batch and retrying only a `FAILED` batch.
- Persistence tests prove two concurrent requests for the same `sourceBatchId` cannot both process attendance.
- Service tests cover `PROCESSING` conflict and `COMPLETED` replay.
- Import tests cover an overnight pair split across midnight resolving into one Attendance Daily row for the shift start date.
- Import tests cover unresolved schedules as failed without guessing a date.
- During implementation run changed test files only. At the Batch 4 gate run the HR suite. Do not run the full repository suite until PR or merge preparation.

## Out Of Scope

- Manual attendance adjustment changes.
- Leave reconciliation changes.
- Self-service check-in/check-out behavior changes.
- Recalculating existing Attendance Daily snapshots.
- Redis locks or queue orchestration.
- Frontend changes.
