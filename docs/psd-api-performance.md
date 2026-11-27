# PSD Tasks API performance

## Local measurement

Run: `node tools/benchmark-psd-local.js`. Baseline design service: `5990e459`.

Synthetic fixture: 500 tasks/listings, one shop, one customer file and five submission revisions per task. Real MongoDB on 127.0.0.1; isolated process-named scratch database, removed after the run. No .env or remote database access. HTTP harness calls the actual service/repositories with a fixed permitted context; it excludes auth middleware, Redis, proxies, compression and real HR/media workloads. Schema indexes are not auto-created. This is not a production latency estimate.

Five interleaved warm runs per variant, after one warmup. Request: 50 Amazon PSD_TEMPLATE tasks sorted by urgency. After uses `view=table`. The harness asserts identical pagination, row order, file totals and visible data, excluding intentionally deferred history.

| Metric | Before | After |
|---|---:|---:|
| ttfb (ms) | 153.9 | 73.07 |
| download (ms) | 1.84 | 2.46 |
| server (ms) | 151.90549999999985 | 71.05509999999958 |
| bytes | 113998 | 80998 |
| reads | 156 | 9 |

Median stages after (ms): {"list":8.431700000000092,"listAsinGroups":4.798300000000381,"scaleFiles":42.723399999999856}

## Findings and changes

- Urgency match/sort occurs before pagination. No sort/index semantics changed; measured query time did not justify a new index from this small fixture. File totals already use batched aggregation; no per-task count queries were introduced.
- Blocked-order enrichment uses three bulk reads instead of three reads per listing; preserves historical/current listing memberships and deduplicates task IDs.
- Optional table response omits history. Default/detail responses remain compatible. Only the current visible submission assets are enriched in table mode; download and approval asset metadata remain available.
- PSD history loads on explicit click with its own loading/error/retry state. Assignment options load when the modal opens and share the existing query key/cache. The table remains independent of summary/assignment requests.
- Notification polling belongs to the AppShell watcher, not each inbox observer. Polling pauses while hidden and stops when the socket is ready. Chat polling explicitly uses the same hidden-tab rule.
- Auth /me and HR profile /me serve different purposes. HR menu/modal share hrKeys.myProfile and a five-minute cache; shops already use shopKeys.list; no auth checks were removed.
- Avatar response uses private revalidation, ETag and 304 after permission checking. FE avatar data becomes stale after 60 seconds instead of staying fresh forever. No thumbnail/resizing dependency added, per user preference; first-download image bytes are unchanged.

## Verification

- BE: 78 suites / 963 tests passed across design, production, order, HR avatar controller and architecture.
- FE: 24 files / 122 tests passed across design, notifications, media, chat and account/profile UI.
- FE full lint: zero errors; existing unrelated vendor useMemo warning. Build/typecheck checked separately.
- No merge or deployment performed.
