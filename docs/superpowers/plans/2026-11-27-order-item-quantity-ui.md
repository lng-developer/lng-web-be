# Order item quantity editing

Goal: let an authorized operator change a line's internal quantity in the order UI before vendor dispatch, without a direct database edit.

Design: PATCH `/orders/items/:orderItemId/quantity` accepts integer `quantity` (1–9999), `expectedQuantity`, and a required reason (max 1000 characters). Keep customer-paid amounts unchanged. Save an override so marketplace reimport cannot undo the change. Synchronize production quantity, mapping cost estimates, workbench and audit/timeline in one transaction through public ports. Block terminal/dispatch-ready items and non-cancelled vendor submissions. Recalculate finance after commit. No automatic pack parser or marketplace update.

- [x] Add failing order service/route and repository persistence checks for validation, scoped write access, stale edits, lifecycle restrictions and reimport preservation.
- [x] Implement the order endpoint, transaction, override, projection and timeline using existing layers.
- [x] Add production and mapping public ports and focused tests; preserve assets, selected vendor and lifecycle state.
- [x] Add Ant Design quantity/reason dialog to order item panel, mutation adapter, translations and UI tests in frontend.
- [x] Run affected suites, architecture checks, frontend checks and inspect diffs. Create PRs targeting develop; do not merge or mutate the live order.
