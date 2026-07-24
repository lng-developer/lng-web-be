# PSD Readiness Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Catalog the single source of PSD readiness and remove divergent PSD decisions from Listing edit, Order, Mapping, Design, Production, and the Listing UI.

**Architecture:** Internal Template gains an explicit `requiresPsd` flag, defaulting to `true` for backward compatibility. Catalog resolves `{ required, status, effectivePsdAssetId, source }` from Listing plus active Internal Template and exposes it through its public port. Consumers use that result; `Listing.psdStatus` remains a synchronized compatibility cache and cannot be edited generically.

**Tech Stack:** Node.js, Express, Mongoose, Jest, React, React Query, Material UI.

## Global Constraints

- Cross-module calls use `public.js` only.
- Generic Listing update must not accept `psdStatus` or `psdTemplateAssetId`.
- New templates default `requiresPsd: true`; historical missing values are treated as `true`.
- A PSD task approval may only attach PSD-compatible media.
- No automatic database migration execution; migration scripts default to dry-run.

---

### Task 1: Catalog PSD readiness contract

**Files:** Catalog model/validator/DTO/service/public and catalog service tests.

- [ ] Add `requiresPsd` to Internal Template, default true, and expose it in DTOs.
- [ ] Add a Catalog service resolver returning `required`, `status`, `effectivePsdAssetId`, `source`, and `asset`.
- [ ] Validate direct Listing PSD assets through the existing Catalog PSD file rules.
- [ ] Remove `psdStatus` from generic Listing create/update payloads; preserve PSD mutations only in PSD-specific actions.
- [ ] Add tests for listing asset, template asset, no-required-PSD, and stale status states.

### Task 2: Make backend consumers use the contract

**Files:** Order readiness/status/workflow, Mapping fulfillment plan, Design PSD task service, Production task service and focused tests.

- [ ] Replace direct `listing.psdStatus` checks with Catalog readiness checks.
- [ ] Use `requiresPsd` to suppress PSD check/task creation when explicitly false.
- [ ] Reject non-PSD assets when approving PSD template tasks.
- [ ] Recheck affected order/production state after PSD-specific mutations.
- [ ] Test the P0 scenarios: stale status, template fallback, and no-PSD template.

### Task 3: Concurrency and repair tooling

**Files:** DesignTask model/index migration script and tests.

- [ ] Include `REQUESTED` in the active PSD-task unique partial index.
- [ ] Add an idempotent dry-run reconciliation script for stale Listing PSD cache values.
- [ ] Add tests or scripted assertions for the expected active task index definition.

### Task 4: Listing UI contract

**Files:** `lng-web-fe/src/features/listings` page, mapper, tests, and translations if needed.

- [ ] Remove editable PSD Status from Listing create/edit modal and request payload.
- [ ] Display backend-derived PSD readiness with source and a clear next action.
- [ ] Add explicit `requiresPsd` control to Internal Template editing.
- [ ] Update FE mapper/composition tests for backend readiness and non-editable PSD state.

### Task 5: Verification

- [ ] Run focused BE Catalog/Design/Mapping/Order/Production tests and architecture test.
- [ ] Run FE listing unit/composition tests and lint.
- [ ] Inspect both worktree diffs; do not touch the original dirty checkouts.
