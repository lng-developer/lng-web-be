# Vendor Base Cost Formula Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Calculate fulfillment cost from vendor base price, quantity, production surcharges, destination-aware shipping, and import tax.

**Architecture:** Keep the formula in `fulfillmentPlan.service.js`, the existing shared source used by preview and persisted plan snapshots. Load the owning order once to supply destination and shipping-service context. Monetary values remain integer minor units.

**Tech Stack:** Node.js, Jest, MongoDB public ports.

## Global Constraints

- Add a fixed 100 minor-unit surcharge per unit for parity with the legacy system.
- Use priority shipping for expedited orders, domestic shipping for US orders, and international shipping otherwise.
- Fall back to international shipping when the selected profile is missing.
- Charge economy once and additional shipping for each remaining unit.
- Preserve existing uncommitted work in the worktree.

---

### Task 1: Shared fulfillment cost formula

**Files:**
- Modify: `src/modules/mapping/services/fulfillmentPlan.service.js`
- Test: `src/test/mapping/services/fulfillmentPlan.service.test.js`

**Interfaces:**
- Consumes: vendor cost center, order item, owning order, SKU mapping, normalized customization inputs.
- Produces: `buildCostEstimate()` result with line-item breakdown and `totalAmount` in minor units.

- [ ] **Step 1: Write failing tests** for US domestic shipping, expedited priority shipping, international fallback, quantity, fixed surcharge, production surcharges, and import tax.
- [ ] **Step 2: Run the focused Jest file** and confirm the new expectations fail against the current formula.
- [ ] **Step 3: Implement the minimal shared formula** and pass order context through preview and persisted snapshots.
- [ ] **Step 4: Run the focused Jest file** and update existing assertions whose totals intentionally changed.
- [ ] **Step 5: Run lint for touched source and the mapping test suite.**
