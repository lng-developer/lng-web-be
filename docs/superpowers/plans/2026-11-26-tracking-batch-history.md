# Tracking batch history implementation plan

**Goal:** Show upload batches per shop, with orders expanded below each batch, alongside the existing pending upload workflow.
**Architecture:** Reuse AmazonTrackingSubmission list/detail endpoints and stored row snapshots. Load details only for the expanded batch. No new schema or dependencies.
**Approved design:** Batch table with inline order expansion, pending upload tab, retain current confirmed-order view for records without a stored batch. Batch outcomes must not be presented as individual order outcomes.

- [ ] BE: fix missing authorization helper, honor shop filter, return summary DTOs, preserve empty scopes as no access. Test list/detail access and pagination.
- [ ] FE: typed detail API and focused batch component; paginated list, one expanded batch, snapshot orders/tracking, errors and refresh, English/Vietnamese labels.
- [ ] Integrate history tab into Amazon preview without changing Etsy submission behavior or permission gates.
- [ ] Verify targeted BE/FE tests, FE lint/typecheck/build, inspect diff and open develop PRs. No merge or deploy.
