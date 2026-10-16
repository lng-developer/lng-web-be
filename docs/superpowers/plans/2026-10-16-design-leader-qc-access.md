# Design Leader QC access — implementation record

Approved: leader reads team QC, assigns rejected work, does not inherit QC Pass/Reject; an independently granted QC reviewer must not review their own output.

Scope: production QC, not PSD submission review. Reuse DESIGN:REVIEW team scope for visibility and PRODUCTION:QC_REVIEW/PRODUCTION:WRITE for decisions. No role grants or DB writes. PNG/Scale Design Type implementation is a separate pending plan.

Ruling: reuse existing permissions instead of adding QC_READ. Team-scoped DESIGN:REVIEW provides team visibility without granting QC mutation. Existing global administration and independently granted QC reviewer authority remain unchanged.

Ruling: team relationship is current design assignee, Scale assignee, or recorded output worker membership. Unknown/unassigned work is not automatically included. Lists, detail, media authorization, summary and QC export must use that same team restriction.

Ruling: protect both Pass and Reject from self-review using outputWorkerId, including after reassignment. For legacy output with no worker metadata, also deny current design/Scale assignees; this cannot reconstruct historical workers that were never recorded. No historical data is invented.

## Progress

- [x] Read routes, scoped authorization, repository predicates, task/output DTO and FE controls.
- [x] RED: five tests failed for missing team filtering/self-review protection; another test exposed unscoped QC export.
- [x] GREEN: 238 production tests passed after implementation.
- [x] FE own-output helper RED then GREEN; existing page tests passed (18 tests with helper).
- [x] Independent read-only review found BSON aggregation mismatch, independent shop QC scope loss, and missing legacy assignee IDs in compact QC DTO. Fixed with regression tests.
- [x] Ruling: omitting view=QC must not expose outside-team QC via generic list/summary/CSV. Added conditional QC restriction while preserving existing non-QC team queue behavior. Global administration and independently granted QC authority remain unchanged.
- [x] Ruling: rejected tasks remain in the already-approved all-Scale assignment scope; detail/media authorization unions that existing access with team QC read access.
- [x] Final narrow backend verification: 265 Production and architecture tests passed. JS syntax and FE TypeScript/lint checks passed.
- [x] Final scoped FE run: 21 tests passed (ProductionWorkbenchPage and productionAuthorization).
- [x] Broad BE run: 418 suites / 3490 tests passed, 23 skipped; worker teardown warning remains. The final scoped Production/architecture run separately verifies the latest read-scope changes (265 tests).
- [x] Broad FE run attempted twice; not green or complete. Stopped the bounded run after failures in unrelated CatalogListingWorkbenchPage and ImportJobPanel; no fixes to those modules included.

Bounded FE failures observed:
- CatalogListingWorkbenchPage: displays ETSY marketplace ETSY_US as US without changing source data.
- CatalogListingWorkbenchPage: displays ETSY marketplace US as US without changing source data.
- CatalogListingWorkbenchPage: displays ETSY marketplace ETSY_UK as ETSY_UK without changing source data.
- CatalogListingWorkbenchPage: displays AMAZON marketplace AMAZON_US as AMAZON_US without changing source data.
- CatalogListingWorkbenchPage: asks for a PSD priority before creating the request.
- ImportJobPanel: shows job summary before raw-record diagnostics.
- ImportJobPanel: hides retry for a job outside the caller exact write scope.

The first unrestricted FE run also showed timeout/assertion failures in OrderItemPanel (Etsy identity), ProfileSetupPage (submit/error), PsdTasksPage (reassign), MappingRulesPage (rule loading/create/update), settlement cash movement, HrWorkspacePage (update form), and OperationsDashboardPage (metrics). That run was interrupted under excessive worker load; it is not proof of regressions in these modules. Full outputs remain in qc-frontend-tests.log and qc-frontend-tests-limited.log in the FE checkout.

Verification note: the first full BE run passed 418 suites / 3486 tests (23 skipped) before final review fixes; worker teardown warning remains. Full FE unrestricted run was stopped after excessive parallel load/timeouts; bounded rerun is separate evidence. The new UI fixture uses an external image URL to avoid issuing live media API requests. The existing row-selection assertion now waits for the row before counting checkboxes.

No commit, deployment, role migration, restart or real task mutation is included. Existing Scale reassignment of QC_REJECTED work is preserved.
