# Transaction fee allocation

Approved behavior: link order-level transaction rows to their order; distribute fees by item value, falling back to marketplace quantity when values are incomplete. Keep source amounts, signed credits, minor-unit totals and replay identity unchanged. Preserve direct item fees. Mark allocated evidence and snapshot confidence separately from direct actual fees.

1. Add a deterministic integer allocator and focused tests (value weights, quantity fallback, signed amounts, rounding and invalid currency/identity).
2. Store allocations on the original fee row; link transaction ledger at order level; schedule all affected items. Update fee totals, evidence and reconciliation freshness readers, with tests.
3. Add a dry-run-first, cursor-paged historical transaction backfill using the same allocation service, conditional writes and inline snapshot recalculation. Limit writes to order-only transaction rows; retain explicit-item records and ambiguous/missing orders.
4. Validate finance tests and architecture gates. Dry-run against the identified production DB and report scope. Open a develop PR. Apply historical updates only after production runs the allocation-aware backend, otherwise existing workers would overwrite calculated results.

No revenue allocation: order item prices already feed revenue snapshots; this change allocates transaction fees only. No new frontend contract is required: snapshot feeConfidence accepts strings and displays ALLOCATED.
