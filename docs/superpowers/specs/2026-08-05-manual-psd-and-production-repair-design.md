# Manual PSD Request and Production Data Repair

## Goal

Make PSD work strictly staff-initiated and safely reconnect legacy production data to ListingVariant without inventing InternalTemplate data.

## Scope

1. Remove automatic PSD DesignTask creation from Production task creation/recheck.
2. Remove automatic PSD DesignTask creation from manual Listing creation.
3. Keep the existing authenticated Design endpoint as the only path used by the Catalog **Request PSD** action.
4. Repair eligible legacy FulfillmentPlans so they resolve their existing ListingVariant.
5. Recheck eligible ProductionTasks after their FulfillmentPlan has been repaired.

## Behavior

Creating or rechecking a ProductionTask with `PSD_MISSING` records the blocker but does not create a DesignTask. Creating a Listing without a PSD also does not create a DesignTask. Staff must open the variant in Catalog and explicitly request PSD work.

The repair must use the normal Mapping resolver/public workflow rather than patching ProductionTask snapshots directly. A plan is eligible only when its Listing and exact Product Type resolve to one active ListingVariant. Missing or ambiguous records remain blocked and are reported.

The repair must not create placeholder InternalTemplates or assign a template by title/SKU guessing. A resolved ListingVariant without an InternalTemplate remains visibly blocked by `TEMPLATE_NOT_FOUND`. After staff configures the template and requests/approves the PSD, normal recheck clears derived blockers.

The legacy order item with no Listing remains blocked for manual mapping.

## Data Safety

- Report target database and dry-run results before writes.
- Make the repair idempotent.
- Update only records that resolve unambiguously through current domain services.
- Preserve scaled outputs when their input asset is unchanged.
- Do not overwrite terminal ProductionTasks or submitted VendorSubmissions.
- Return per-item success, skipped, and failure reasons.

## Verification

- A failing test first proves Production no longer creates a PSD DesignTask.
- A failing test first proves manual Listing creation no longer creates a PSD DesignTask.
- Existing manual Request PSD route/service tests continue to pass.
- Production, Catalog, Mapping, Design, and architecture tests pass.
- Dry-run and apply summaries match the expected eligible population.
- Database readback confirms repaired plan-to-variant links and unchanged unresolved records.

## Out of Scope

- Creating InternalTemplate business data.
- Uploading or approving PSD files.
- Automatically requesting PSD work.
- Guessing Listing or Product Type for unresolved order items.
- Refactoring the broader Production or Catalog services.
