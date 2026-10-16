# Design team listing access implementation plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Design leaders can read only listings related to design/production tasks belonging to their authorized design teams.

**Architecture:** Keep AccessAssignment and ScopedRolePermission. Task modules own task visibility and return listing identities through public ports; Catalog enforces the resulting visibility consistently. Do not expand CATALOG:READ to global or reuse new read access to authorize catalog writes.

**Tech Stack:** CommonJS, Mongoose repositories, Jest; existing React permission gates.

**Spec:** User-approved conversation: assigned team tasks plus explicitly team-owned unassigned tasks; deny unrelated listings and unknown-team queues. List, detail, images/files and export must agree.

## Global constraints

- No production deployment, live role changes, backfill or bulk migration in this implementation.
- Preserve existing Sales/shop/global access and HR permissions.
- Cross-module calls use public.js only; repositories own lean queries.
- No new packages or general RBAC rewrite.
- Keep read-only listing visibility separate from PSD request/catalog edit authorization.

## Review focus

- A listing shared by two teams is readable if at least one authorized task establishes access.
- Unknown-team unassigned tasks must not become visible to every leader.
- Membership changes must affect reads without relying on stale listing snapshots.
- Detail, variants, media and export must not bypass list restrictions.
- Existing Sales access and global administrative access must remain unchanged.

## Task 1: Establish bounded task visibility

**Files:** design/models/designTask.model.js, design/repositories/designTask.repository.js, design/services/designTask.service.js, design/public.js under src/modules; corresponding tests/design files. Production equivalents under src/modules/production and tests/production.

**Interfaces:** Add public `findReadableListingIds(authContext)` in each task module, returning unique string listing IDs using repository queries and existing organization/auth public ports. It must not invoke catalog listing reads, avoiding a circular call chain.

- [ ] Add failing tests for DESIGN_LEADER with real role codes, own-team assignee, other-team assignee, explicit own-team unassigned task and unknown-team unassigned task.
- [ ] Add nullable `designTeamId` ownership only where no existing equivalent exists. Accept it only through validated task routing/creation contracts; validate referenced team and actor authority. Do not infer ownership merely because only one design team exists.
- [ ] Resolve assigned tasks from current authorized team membership; unassigned tasks require explicit designTeamId. Designer reads remain self-assigned only. Reject mismatches between explicit team ownership and assignee membership.
- [ ] Replace unrestricted includeUnassignedDesigner and team-permission short circuits in affected read paths with the same task predicate. Reuse for direct reads and task listing; preserve separate action permissions.
- [ ] Run focused design/production repository and service tests. Document legacy unknown-team tasks excluded; no automatic backfill.

## Task 2: Integrate Catalog read access without granting writes

**Files:** src/modules/catalog/services/listing.service.js, listingVariant.service.js; tests/catalog/services/catalog.service.test.js and listingVariant.service.test.js.

**Interfaces:** Catalog consumes design.public.findReadableListingIds and production.public.findReadableListingIds. Reuse the existing list/summary/detail access seams; keep canReadAssignedListing write-related behavior separate.

- [ ] Write failing tests covering list, summary, detail, variants and CSV for same-team and cross-team listings, multiple teams, shared listings and explicit shop/search filters.
- [ ] Route design-scoped catalog reads through task-derived listing identities; preserve independent valid shop/global grants and existing Sales behavior.
- [ ] Test that new read visibility does not authorize variant creation, metadata edits, or PSD requests.
- [ ] Verify filtered pagination and sales sorting do not omit access restrictions.
- [ ] Run catalog tests plus architecture tests.

## Task 3: Verify media and frontend access surfaces

**Files:** src/modules/media/services/mediaAsset.service.js and listingImage.service.js, related routes/controllers and tests/media as reached by caller tracing; paired FE src/app/layout/LegacySidebar.tsx, appNavigation.ts and related tests only if a gate change is necessary.

- [ ] Trace actual listing image, preview, file and download endpoints before edits. Add negative tests to the endpoint that resolves private assets, not merely the listing DTO.
- [ ] Enforce task-derived listing access before returning protected asset content or new signed URLs. Do not claim public CDN URLs or already-issued signed URLs are revoked by RBAC.
- [ ] Verify frontend list/detail/export uses the protected backend paths and does not require global permissions. Do not implement role-wide sidebar/report redesign in this bounded slice.
- [ ] If FE changes are needed, isolate its existing dirty work and add focused frontend regression tests.

## Verification and delivery

- [ ] Baseline relevant tests before implementation; report pre-existing failures.
- [ ] Run red/green cycles for each task, syntax checks, `npm run test:architecture -- --runInBand`, `npm run test:auth -- --runInBand`, and `npm test -- --runInBand`.
- [ ] Inspect git diff; no unrelated changes or secrets. Document any untested browser/runtime behavior.
- [ ] Hand off changes and legacy-task routing implications. No commit/push/deploy or operational data migration without a separate request.

## Separate follow-up

Role LEADER permission reduction, HR preservation, Sales matrix rollout, report permission separation and unused-grant cleanup require their own tested migration plan. This slice must not silently alter those permissions.
