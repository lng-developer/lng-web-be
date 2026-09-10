# Amazon finance schedule catch-up design

## Goal

Make scheduled Amazon finance imports recover safely after downtime without treating settlement reports as arbitrary date-range exports.

## Scope

- Transaction schedules remain daily and import at most seven UTC days in one command.
- Settlement schedules remain daily and only act on a closed Amazon statement identified by its `referenceId`.
- A settlement already completed by LNG is skipped before downloading it from Amazon, even if extension local storage was cleared.
- The Automation UI explains these fixed safeguards; it does not expose interval or batch-size configuration.

## Design

### Transaction command window

`transactionWindow(schedule, now)` will calculate the first unimported UTC date from `lastSuccessfulDate + 1`, or yesterday for a schedule with no checkpoint. The command ends on the earlier of seven days after that start or yesterday. The scheduler queues at most one command per enabled schedule per daily cadence. Completing a successful command advances the checkpoint to the command's `dateTo`.

This avoids a retry loop that could issue repeated Amazon downloads in one day. A backlog therefore closes at up to seven days per day. Manual imports remain separate and do not move the scheduled checkpoint.

### Settlement identity guard

The extension continues to discover the newest closed row in Amazon All Statements, extracts its `referenceId`, then asks LNG whether the corresponding completed settlement import exists for the authenticated shop. The source reference is `settlements-{referenceId}.txt`, which is already persisted by `FinanceImportBatch` and protected by the existing per-shop idempotency key.

LNG exposes one extension-authenticated, shop-scoped read endpoint for this check. It returns only `{ completed: boolean }`; it exposes neither another shop's data nor batch details. If completed, the extension records a visible skip and does not download or upload the file. If not completed, the current trusted-download, cooldown, file validation, and idempotency flow runs unchanged.

### UI copy

The Transaction row states `Daily · Up to 7 days per run`. The Settlement row states `Daily · Newly closed statements only`. Existing enable/disable and request-now actions are unchanged.

## Error handling

- An offline agent or active command retains the current 15-minute scheduler postponement.
- A failed Transaction command does not advance `lastSuccessfulDate`.
- A failed or incomplete Settlement batch is not considered completed, so a later daily run may retry it after existing cooldown rules.
- The BE check failing is treated as an import failure; the extension must not bypass the guard and download a settlement blindly.

## Verification

- BE unit tests cover seven-day and end-of-yesterday transaction windows, a no-checkpoint window, and checkpoint advancement only on success.
- BE route/service tests cover shop-scoped completed-settlement lookup and deny unauthorised scopes.
- Extension tests cover a completed `referenceId` returning a skip without calling Amazon download/upload.
- FE test verifies the operational copy while existing enable/request-now tests continue to pass.
