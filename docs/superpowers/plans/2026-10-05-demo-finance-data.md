# Isolated Demo Finance Data Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Build a guarded, deterministic seed that populates only lng_web_be_demo with synthetic Amazon order, finance, settlement, ledger, and ads records for useful report validation.

**Architecture:** One demo-only seed script owns target validation, deterministic fixture construction, idempotent model upserts, demo-only reset, and a readback summary. It reuses seedShopDemo for synthetic shop dimensions but does not touch import HTTP services or create FinanceImportBatch records because those require a source MediaAsset.

**Tech Stack:** Node.js CommonJS, Mongoose, Jest, existing Finance/Order models.

**Spec:** docs/superpowers/specs/2026-10-05-demo-finance-data-design.md

## Global Constraints

- Refuse execution unless NODE_ENV is not production, ALLOW_ANALYTICS_DEMO_SEED=true, and the parsed MONGODB_URI database name equals lng_web_be_demo.
- Default to dry-run; database writes require --apply; reset requires both --apply --reset.
- Use no real customer PII and no external marketplace credentials or uploads.
- Store money as integer minor units and use only model enum values.
- Use DEMO-FIN- identity prefixes and demo-finance-report-seed as the source reference.
- Re-running apply is idempotent; reset selects only tagged demo records.

## Review Focus

- A URI with no database, a query-only suffix, or a similarly named database must fail before connection; Task 1 pins all three.
- A dry-run or reset-without-apply must not call bulkWrite or deleteMany; Task 3 pins both paths.
- Every emitted status must belong to the Order/OrderItem enums, including terminal refund/failed combinations; Task 2 pins the complete set.
- Linked ledger records must reference generated order/item IDs while intentional unlinked rows stay identified and limited; Task 2 pins both populations.
- Reset must not broaden from a demo order ID to unrelated settlement, ledger, or ads records sharing a shop; Task 3 pins exact source-reference filters.

---

## File Structure

- Create tools/scripts/seed/seedDemoFinanceReportData.js: fixture builders, guard, idempotent persistence/reset, readback.
- Create tests/tools/scripts/seed/seedDemoFinanceReportData.test.js: unit tests with injected model and connection dependencies.
- Modify package.json: dry-run/apply/reset commands pointing to the new script.
- Modify docs/superpowers/specs/2026-10-05-demo-finance-data-design.md: document that a generated fixture cannot make an import batch.

### Task 1: Isolated target guard and command contract

**Files:**
- Create: tools/scripts/seed/seedDemoFinanceReportData.js
- Test: tests/tools/scripts/seed/seedDemoFinanceReportData.test.js
- Modify: package.json

**Interfaces:**
- Produces: DEMO_DATABASE_NAME, DEMO_SOURCE_REF, databaseNameFromUri(uri), assertDemoSeedAllowed(env, uri), parseCliArguments(argv).
- Consumes: the database URI from src/config/index.js; src/config/database.js only after validation.

- [ ] **Step 1: Write the failing guard and CLI tests**

Test rejection of production, missing opt-in, lng_web_be, lng_web_be_demo_backup, and a URI without a database, without echoing credentials or env values. Test acceptance of lng_web_be_demo; test parseCliArguments([]) gives apply:false/reset:false.

- [ ] **Step 2: Run test to verify it fails**

Run: npx jest tests/tools/scripts/seed/seedDemoFinanceReportData.test.js --runInBand

Expected: FAIL because the module and exports do not exist.

- [ ] **Step 3: Implement the guard and parser**

Parse the URI pathname with URL, require exactly lng_web_be_demo, and check gates before connectDatabase. The parser accepts only --apply and --reset. Inject connection functions and database URI for tests.

- [ ] **Step 4: Add package commands**

Add seed:finance-report:demo (dry run), seed:finance-report:demo:apply (--apply), and reset:finance-report:demo (--apply --reset). Embed neither connection strings nor opt-in values.

- [ ] **Step 5: Verify and commit**

Run: node -c tools/scripts/seed/seedDemoFinanceReportData.js; npx jest tests/tools/scripts/seed/seedDemoFinanceReportData.test.js --runInBand

Commit: feat(finance): guard isolated demo report seed.

### Task 2: Deterministic fixtures for reports and reconciliation

**Files:**
- Modify: tools/scripts/seed/seedDemoFinanceReportData.js
- Modify: tests/tools/scripts/seed/seedDemoFinanceReportData.test.js

**Interfaces:**
- Consumes: Task 1 constants and upsertDemoShops from tools/scripts/seed/seedShopDemo.js.
- Produces: buildDemoFinanceRows(anchor), buildDemoAds(rows), buildDemoSettlements(rows), and buildDemoLedger(rows, settlements).

- [ ] **Step 1: Write failing fixture tests**

With anchor 2026-10-05T12:00:00.000Z, require 90 UTC days; all eight order statuses and required item status stages; DEMO-FIN- buyer/order/item IDs; integer money; and only synthetic buyer/address values. Require ESTIMATED and MISSING_COST snapshots, actual/estimated fees, refund rows, positive/negative profit, and model-valid profit statuses.

- [ ] **Step 2: Add ledger and ads coverage tests**

Require every linked ledger row to resolve to a generated external order/item ID. Require DEMO-UNLINKED-* rows to be under 5% of ledger rows. Require seller-attributed and UNASSIGNED ads, all three campaign statuses, and integer ad money/BPS fields.

- [ ] **Step 3: Run tests to verify they fail**

Run: npx jest tests/tools/scripts/seed/seedDemoFinanceReportData.test.js --runInBand

Expected: FAIL because builders do not produce the required fixtures.

- [ ] **Step 4: Implement builders**

Use a stable hash of day/order index. Generate Amazon-US orders/items using static demo shops and current enums. Create valid snapshots; missing-cost rows have null cost/profit and MISSING_COST/INCOMPLETE_COST. Build stable settlement IDs and ledger dedup keys. Ads use DEMO_SOURCE_REF and include one explicit unassigned campaign.

- [ ] **Step 5: Verify and commit**

Run: npx jest tests/tools/scripts/seed/seedDemoFinanceReportData.test.js --runInBand

Commit: feat(finance): build deterministic report demo fixtures.

### Task 3: Idempotent persistence, reset, and readback

**Files:**
- Modify: tools/scripts/seed/seedDemoFinanceReportData.js
- Modify: tests/tools/scripts/seed/seedDemoFinanceReportData.test.js

**Interfaces:**
- Consumes: Task 2 builders and injected models Order, OrderItem, FinanceSnapshot, AdsSpendDaily, MarketplaceSettlement, MarketplaceSettlementLedgerLine.
- Produces: seedDemoFinanceReportData({ apply, reset, env, dependencies }), resetDemoFinanceReportData(dependencies), summarizeDemoFinanceReportData(dependencies).

- [ ] **Step 1: Write failing persistence/reset tests**

Assert dry-run calls no writes. Assert apply calls upsertDemoShops and upserts by stable external identities/dedup keys. Assert reset deletes dependent records first and uses resolved demo order/item IDs for snapshots/items/orders. Assert ads, settlements, and ledger reset by exact demo source reference, never shop alone.

- [ ] **Step 2: Run tests to verify they fail**

Run: npx jest tests/tools/scripts/seed/seedDemoFinanceReportData.test.js --runInBand

Expected: FAIL because persistence/reset functions do not exist.

- [ ] **Step 3: Implement persistence and reset**

Connect after Task 1 validation. On apply: upsert shops, orders, resolve IDs, then items, snapshots, ads, settlements, and ledger lines. Set sourceType SYSTEM and the demo reference. On reset: delete dependents before items/orders and return per-collection counts. On dry-run: return fixture counts and database name only.

- [ ] **Step 4: Implement readback**

Aggregate counts by order/item/snapshot status, settlement reconciliation status, and ads attribution/status. Log summaries without logging connection URIs.

- [ ] **Step 5: Verify and commit**

Run: node -c tools/scripts/seed/seedDemoFinanceReportData.js; npx jest tests/tools/scripts/seed/seedDemoFinanceReportData.test.js --runInBand; npm run test:architecture -- --runInBand

Commit: feat(finance): seed isolated demo report data.

### Task 4: Isolated database verification and handoff

**Files:**
- Modify: docs/superpowers/specs/2026-10-05-demo-finance-data-design.md

**Interfaces:**
- Consumes: Tasks 1-3.
- Produces: confirmed isolated run evidence and a clean branch diff.

- [ ] **Step 1: Run isolated seed verification**

With a user-provided MONGODB_URI whose parsed database is lng_web_be_demo and ALLOW_ANALYTICS_DEMO_SEED=true, run dry-run, apply, and apply again. Confirm unchanged counts after the second apply. Run reset and confirm only tagged rows were removed. Never use lng_web_be.

- [ ] **Step 2: Run final checks**

Run: git diff develop...HEAD --check; npx jest tests/tools/scripts/seed/seedDemoFinanceReportData.test.js --runInBand; npm run test:architecture -- --runInBand

Expected: PASS with no API/UI/import parser change.

- [ ] **Step 3: Report evidence**

Report database name, dry-run counts, first/second apply counts, reset counts, status distributions, and distinguish code verification from a manual Finance/Report UI check.

- [ ] **Step 4: Preserve ignored planning artifacts locally**

The repo ignores docs/superpowers/**. Do not force-add the spec or plan without a policy change; commits include tracked product files only.



