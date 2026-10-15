# Etsy Remote Order Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Native execution only in this side conversation; no subagents. Steps use checkbox syntax for tracking.

**Goal:** Queue an Etsy order request from the web, collect at most the requested number of orders in the authenticated VM, and automatically import orders and customization assets with reliable task results.

**Architecture:** Extend the existing integration extension-command protocol and its scoped authorization. Reuse the Etsy collector and checkpointed import runner; preserve legacy Amazon behavior. Heartbeat, task ownership, and import completion remain separate concepts.

**Tech Stack:** CommonJS Express/Mongoose/Joi/Jest; Chrome MV3 ES modules and node:test; React/Ant Design/TanStack Query/Vitest.

**Spec:** `docs/superpowers/specs/2026-10-15-etsy-remote-order-import-design.md`

## Global Constraints

- `maxOrders`: integer 1–200, default 1 for Etsy; never convert `numDays` into an Etsy count.
- No schedule activation, Ads/tracking enablement, live imports, production handoff, DB migration or push as an implicit verification step.
- Keep Amazon clients without new metadata on their current contract.
- No `shop.model.js` changes; cross-module calls use public ports; repositories own database queries; DTOs shape responses.
- Token remains in Chrome session storage. Never persist credentials in local checkpoints or logs.
- Preserve existing staged capture files and in-progress E2E work. Stage/commit exact task paths only when requested.
- FE copy must have EN/VI keys. Use existing UI components; no new packages.
- Work in the existing BE `codex/etsy-extension-provider`, FE `EC/etsy-order-fields`, extension `codex/etsy-lng-web-be` branches after verifying their current status.

## Review Focus

1. Old BE silently strips new heartbeat fields: extension must not claim without an explicit protocol acknowledgement (Task 1/3).
2. Worker dies after upload response is lost: reuse identical bytes/key, not a new capture under the old key (Task 3).
3. Token rotates to another shop/backend while checkpoint exists: reject resume, never fall back to persisted old credentials (Task 3).
4. Network/Chrome sleep exceeds lease: stop new writes, preserve job evidence, and show interruption rather than success (Task 2/3).
5. Collector returns zero orders or files need review: zero is a valid no-upload result; partial asset completion is not whole-task success (Task 3/4).

## Task 1: Identify Etsy agents and constrain commands

**BE files (relative to backend root):**
- Modify `src/modules/integration/extensionCommand/models/extensionAgent.model.js`, `models/extensionCommand.model.js`, `validators/extensionCommand.validator.js`, `services/extensionCommand.service.js`, `repositories/extensionCommand.repository.js`, `dtos/extensionCommand.dto.js`.
- Test `src/modules/integration/extensionCommand/__tests__/extensionCommand.validator.test.js`, `extensionCommand.service.test.js`, `extensionCommand.repository.test.js`; `tests/integration/extensionCommand/etsyExtension.contract.test.js`.

**Interfaces:** Heartbeat accepts optional `provider: 'ETSY'` and `protocolVersion: 1`. Store both and return both in agent DTOs only when recognized. Missing metadata remains legacy. Commands gain optional `maxOrders` and `origin: 'WEB' | 'SCHEDULE' | 'EXTENSION' | null`; existing records default null. Web create sets WEB server-side; schedulers and extension-origin queue endpoints set their own origin server-side.

- [ ] Write failing validator/service/repository tests: Etsy counts 1/200 accepted, 0/201/fraction rejected; omitted count becomes 1; shop mismatch denied; legacy Amazon preserves numDays.
- [ ] Add repository assertions that Etsy claim filters `type=IMPORT_NEW_ORDERS`, `origin=WEB`, and valid `maxOrders` before acquiring ownership. Unsupported queued jobs must not block eligible jobs behind them.
- [ ] Run exact paths with `node node_modules/jest/bin/jest.js --runInBand --runTestsByPath <files above>`; observe the missing-field/filter failures.
- [ ] Implement additive schema/DTO/validator changes and normalize command payload by stored provider in the service. Provider is a routing hint, never an authorization grant. Do not identify a provider from its display label.
- [ ] Reject unsupported Etsy command creation and schedule enabling server-side. Dispatchers skip known Etsy agents without rewriting existing schedules. Add schedule regression tests in `__tests__/extensionOrderSchedule.service.test.js`.
- [ ] Run the exact task suites plus `tests/architecture/architecture.contract.test.js`; expect all pass. Review diff for accidental Amazon changes.

## Task 2: Maintain and recover task ownership

**BE files:** Extend the Task 1 service/repository/DTO, plus `controllers/extensionCommand.controller.js`, `routes/extensionCommand.routes.js`; add `tests/integration/extensionCommand/etsyCommandLease.contract.test.js`.

**Interfaces:** `POST /api/integration/extension-commands/agent/commands/:commandId/renew` accepts the existing agent identity and lease token, plus optional `importJobId`. Service `renewCommand(commandId, input, auth)` returns the command DTO. Extend lease by the existing five-minute duration only for matching agent/hash and unexpired CLAIMED/RUNNING state. Job association must resolve through the authorized import service/public contract and belong to the same shop, Etsy provider and command idempotency key before saving it.

- [ ] Write failing tests for cross-agent token, expired lease, terminal task, wrong job/shop, successful renewal, and safe resume without regressing RUNNING to CLAIMED.
- [ ] Run the exact new and existing command tests; expect failure before implementation.
- [ ] Implement atomic renewal via repository query. Do not renew from ordinary online heartbeat.
- [ ] Expired Etsy CLAIMED/RUNNING work becomes FAILED, not requeued automatically; preserve existing Amazon expiry policy. Reconcile expiry before a new Etsy create/claim so locks do not remain stuck.
- [ ] Make command DTO/UI expose expired Etsy work as interrupted even before the next agent request reconciles persisted state. Never render a stale RUNNING record as successfully completed.
- [ ] Add tests that completion after expiry fails, expiry preserves importJobId, and the next authorized request releases the stale lock. Run exact tests and architecture; expect pass.

## Task 3: Run remote Orders through the existing safe import pipeline

**Extension root:** `C:/lng_system/lng-web/extension_esty`.
**Files:** Modify `service-worker.js`, `lng-web-be-agent.mjs`, `lng-web-be-command-client.mjs`, `etsy-import-runner.mjs`; create `etsy-remote-order-runner.mjs`; modify `tests/etsy-manual-heartbeat.test.mjs`, `tests/lng-web-be-agent.test.mjs`, `tests/lng-web-be-command-client.test.mjs`; create `tests/etsy-remote-order-runner.test.mjs`.

**Interfaces:** client `renew(commandId, leaseToken, { importJobId } = {})`; new `runRemoteEtsyOrders({ command, client, scope, load, save, collect, downloadFile, assertLease })` returns `{ success, importJobId, importedCount, failedCount, errorMessage }`. Scope is backend origin + verified token shop. Task ID is capture ID/idempotency key. Local storage key `etsyRemoteOrderRun` stores scope, commandId, CSV and import checkpoint only; command lease token stays in session storage `etsyRemoteOrderLease`.

- [ ] Write failing tests for maxOrders=1, zero result/no CSV upload, automatic manifest completion, failed files/NEEDS_REVIEW, and unchanged legacy execution. Assert the real runner's output and requests using controlled network/storage doubles.
- [ ] Add recovery tests: lost upload response resends identical CSV/key; saved job skips upload; scope/token session loss blocks writes; manual preview is never overwritten. Run `node --test tests/etsy-remote-order-runner.test.mjs` and observe failures.
- [ ] Extract only the existing capture-building logic needed by both manual and remote flows; do not duplicate the Etsy parser or implement another asset uploader. Reuse `resumeEtsyImport` with an optional `assertLease` hook before each upload/manifest write and during polling; manual defaults to no extra hook.
- [ ] Worker advertises Etsy protocol 1; only claim after the returned heartbeat acknowledges that exact provider/version. Use a five-second timeout for lease checks and renew every 60 seconds while active. On failed renewal stop starting further writes; preserve checkpoint and task evidence.
- [ ] Keep periodic heartbeat while collector runs. Chrome alarms wake recovery; every resume must renew the stored session lease before any write. If no session lease or the lease expired, do not create/claim another task as an implicit retry.
- [ ] Add mutual exclusion: remote does not claim while manual work or unfinished preview/checkpoint exists; manual pull/import/clear refuses while remote owns the worker. Surface busy reason without touching existing preview.
- [ ] On job creation, save checkpoint then attach job ID through authorized renew. Retry a lost completion response by completing the same task under its lease, not by repeating collection. Sanitize task errors to fixed codes/operator messages, not URLs or tokens.
- [ ] Update heartbeat-only tests to the approved new remote behavior; retain explicit assertions that Ads/schedules are not executed. Run `npm test`, expect all tests pass. Check `Get-Content service-worker.js -Raw | node --input-type=module --check`.

## Task 4: Expose Etsy request and task results in the existing web UI

**FE root:** `C:/lng_system/lng-web/lng-web-fe`.
**Files:** Modify `src/features/portal/integrations/api/integrationApi.ts`, `components/extensionHelpers.ts`, `hooks/useExtensionWorkbench.ts`, `components/ExtensionManualRequest.tsx`, `components/ExtensionAutomationTab.tsx`, `components/ExtensionOperationsTab.tsx`, `components/ExtensionCommandDrawer.tsx`, and EN/VI `src/shared/i18n/locales/*/common.json`.
**Tests:** Create `src/test/portal/integrations/components/ExtensionManualRequest.test.tsx`; extend `src/test/portal/integrations/pages/IntegrationWorkbenchPage.test.tsx`.

**Interfaces:** Agent types consume provider/protocolVersion; create command input transports maxOrders without replacing it with numDays. Drawer receives maxOrders, existing importJobId and terminal/error fields. API contract remains the shared command endpoints.

- [ ] Read FE AGENTS/CONVENTIONS and required available UI skill before editing. Write failing UI tests for Etsy default 1, valid 200 and invalid values, offline/unauthorized disablement, exact `{ type: 'IMPORT_NEW_ORDERS', maxOrders: 1 }` request, and Amazon's unchanged day selector.
- [ ] Run targeted UI tests and observe failure. Implement using installed Ant Design controls and translated copy clearly stating automatic import.
- [ ] Hide unsupported Etsy Ads/finance/schedule controls; do not relabel or enable unsupported TEST_CONNECTION as if heartbeat implemented it. Show Etsy provider in the agent row and use a neutral Extensions tab label where the page serves both providers.
- [ ] Add tests that task detail shows requested count, job reference and review/failure result, not a day window. Verify new rows and status changes refresh through existing query invalidation/polling.
- [ ] Run exact new UI suites and `npm run typecheck`. Keep the previously observed OrderItemPanel failure and Catalog timeout baseline separate; do not silently fix unrelated work or claim the entire FE suite passes.

## Task 5: Contract verification and operator handoff

**Files:** Extend BE `tests/integration/extensionCommand/etsyExtension.contract.test.js`; update `tools/api-contract/buildOrderPostmanCollections.js` only if required by actual route registration, generated `docs/api` integration collections/index, and `docs/integration/etsy-extension-manual-test.md`; extension `docs/etsy-manual-import.md`.

- [ ] Add a cross-boundary fixture with authenticated Etsy agent, WEB task maxOrders=1, lease renew and final import result; ensure legacy client and unsupported-provider scenarios are covered.
- [ ] Run BE exact-path command/contract/architecture tests, extension `npm test`, FE task tests/typecheck. Never use unbounded Jest patterns that select `.worktrees/` copies.
- [ ] Review all changed files, scan for secrets, and run scoped `git diff --check`. No real vendor/Smarty/Cloudinary/Etsy requests during automated tests.
- [ ] Document deploy order BE → FE → extension, token session requirements, and operator test: choose correct online Etsy VM, request 1 order, inspect task/job and the order/customization result. Do not execute this live test without a separate explicit request.
- [ ] Report commits only if created with authorization, test evidence, existing FE failures, and what remains unverified. No automatic push/restart or schedule activation.

## Self-review and execution gate

Spec coverage: provider/scope/claim restrictions → Task 1; expiry/ownership → Task 2; assets/idempotency/recovery/busy/zero results → Task 3; user-triggered controls and task history → Task 4; compatibility and VM handoff → Task 5. All five Review Focus conditions have tests assigned above.

Approved by the user and implemented inline on the existing branches. Execution evidence and deviations are recorded in `.superpowers/sdd/2026-10-15-etsy-remote-order-import/progress.md`. No independent-agent review, commit/push, service restart or live VM import is included. Operator test instructions are in `docs/integration/etsy-extension-manual-test.md`; command API details are in `docs/integration/etsy-remote-order-api.md` rather than broadening the existing Postman route inventory.
