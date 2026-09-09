# Finance Extension Sync Configuration Design

## Goal

Run the already-proven manual Amazon Transaction and Settlement imports from the system, using the existing extension-command lifecycle. The system queues work; the connected Chrome extension claims, executes, and reports it. Manual import remains available for backfill and recovery.

## Scope

- Transactions and Settlements only. Orders and Ads behavior remains unchanged.
- One daily configuration per source and extension agent; interval is fixed at 24 hours.
- The system owns authorization, due scheduling, command state, and one-active-import protection.
- The extension owns Amazon page inspection, opening the required Seller Central context when absent, and file download. It never stores Amazon credentials in the backend.

## Command contract

Add `IMPORT_TRANSACTIONS` and `IMPORT_SETTLEMENTS` to the existing extension-command enum. Both commands use the existing lease, start, complete, result, error, and `activeOrderKey` mechanism. Despite its legacy name, `activeOrderKey` is an agent-wide unique lock, so all Amazon import types share it and cannot run concurrently.

The command poller receives two explicit handlers:

- `IMPORT_TRANSACTIONS` calls the existing `runImportTransactions({ dateFrom, dateTo })` flow.
- `IMPORT_SETTLEMENTS` calls the existing settlement flow after it discovers one eligible closed statement.

Completion reports the finance import batch id and its imported/failed counts when the finance endpoint returns them. An unavailable download link, an Amazon sign-in redirect, or a cooldown skip is a controlled failed command with a human-readable reason; it is not retried by the extension loop.

## Scheduling and checkpoints

Create `ExtensionFinanceSchedule` inside the existing `integration/extensionCommand` module. A row is unique by `{ agentId, source }`, where source is `TRANSACTIONS` or `SETTLEMENTS`. It stores `enabled`, fixed `intervalMinutes: 1440`, `nextRunAt`, `lastQueuedAt`, `lastCompletedAt`, `lastError`, and the transaction watermark.

The existing one-minute extension scheduler dispatches both Order schedules and Finance schedules. It atomically advances `nextRunAt` before queuing, checks the same 90-second online threshold, and defers 15 minutes when an agent is offline or any import command is active. Missed runs coalesce into one command; no backlog is created.

For Transactions, the first automatic run starts with the prior completed UTC day. A successful command advances the watermark to that day. A failed command leaves the watermark unchanged, so the next eligible run retries the same day. Manual import is the supported path for historical backfill.

For Settlements, there is no date-derived watermark because Amazon settlement periods are irregular. On each daily command, the extension inspects Amazon All Statements, excludes the open `Present` statement, and selects at most one newest closed Flat File V2 row. It passes that exact period to the existing import function. The existing reference-id/idempotency protection makes repeated delivery harmless. If no closed row is available, the command fails once with an actionable message and waits until the next scheduled run.

### Seller Central context bootstrap

Settlement discovery first reuses an existing `/payments/past-settlements` tab. If none exists, it opens exactly one background tab at Amazon All Statements using `chrome.tabs.create`, waits for the tab to finish loading, then gives the page a short settle period before inspecting it. The tab remains open for later daily runs; the extension does not create a new tab per retry or close a user-owned tab.

If Amazon redirects the new tab to sign-in, account selection, or an unsupported marketplace, the command ends with `SELLER_CENTRAL_AUTH_REQUIRED` and a prompt for the operator to sign in on the VPS. It performs no download in that state. A page-load timeout or an unavailable All Statements page produces one failed command and waits for the next daily run. This bootstrap is invoked only after the backend has issued the single daily Settlement command, so it cannot cause background tab spam.

## API and UI

Keep Order schedule endpoints untouched. Add finance schedule endpoints under the same extension-command route:

- `GET /finance-schedules`
- `PUT /finance-schedules/:agentId/:source`

They require `FINANCE:READ`/`FINANCE:WRITE` for the agent shop. Command listing must also permit Finance readers, so finance operators can see Transaction and Settlement command history.

The Integration > Extension > Automation tab gains two compact source rows per agent: Transactions and Settlements. Each shows enabled/disabled, fixed daily cadence, next run, last successful run, and last error. The sole action toggles the source. There is no free-form cron or lookback control: manual import covers backfill, while a fixed daily policy protects the seller account.

## Error handling and safety

- The backend validates source values and shop-scoped Finance permissions.
- The scheduler never invokes Amazon itself; it only queues a command for an online extension.
- The shared command lock prevents Orders, Ads, Transactions, and Settlements from racing in the same browser profile.
- Settlement context reuses a matching tab; otherwise it opens one background All Statements tab only for the scheduled command.
- Settlement discovery downloads at most one closed statement per scheduled command and never selects `Present`.
- Existing client-side settlement cooldown and server-side idempotency remain in force.
- Commands that cannot find the required Seller Central context record a diagnostic error rather than creating a retry loop.

## Verification

1. Backend unit tests prove source validation, finance authorization, due dispatch, offline/active deferral, transaction watermark advancement only after success, and one settlement command per day.
2. Extension contract tests prove the poller recognizes both finance command types, settlement discovery rejects `Present`, an absent All Statements tab opens once, and a scheduled task invokes no more than one Amazon download.
3. FE UI tests prove Finance schedules render per agent and toggle through the new endpoint.
4. Run affected backend Jest tests, extension Node contract tests, FE UI test/typecheck, then the existing lint/build checkpoints.

## Delivery order

1. Merge the existing extension manual-import branch `EC/extension-command-phase-1`, which contains the actual transaction and settlement handlers.
2. Merge the Finance Sync Config BE and FE changes.
3. Merge the extension Finance Sync Config change, based on the manual-import branch, then deploy all three together.
