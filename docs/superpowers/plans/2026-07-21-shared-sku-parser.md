# Shared SKU Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centralize canonical SKU parsing so mapping, finance imports, and future importers share one stable employee/config extraction contract.

**Architecture:** `MappingSkuNormalizeRule` remains responsible for converting seller-specific raw SKUs to a canonical dash-separated SKU. Rules always address the original raw segment index internally, so removals cannot shift later rule targets. A pure helper in `src/shared/utils` then parses the canonical value without database access or source-specific rules. Mapping delegates its current `parseInternalSku` export to the helper; finance import uses the helper only to extract seller identity from free-text attribution fields.

**Tech Stack:** Node.js, CommonJS, Jest.

## Global Constraints

- Keep the modular-monolith boundary intact; `src/shared` remains technical-only.
- Do not infer or search arbitrary positions for config codes.
- Do not add dependencies or persistence.
- All parse output is uppercase and null-safe.
- `segmentIndex` remains a zero-based index into the original raw SKU for every normalize rule.

---

### Task 1: Shared pure SKU parser

**Files:**
- Create: `src/shared/utils/sku.js`
- Test: `src/test/shared/utils/sku.test.js`

**Interface:**

```js
parseSku('J2508-TS1S-05032026-335')
// {
//   originalSku: 'J2508-TS1S-05032026-335',
//   normalizedSku: 'J2508-TS1S-05032026-335',
//   segments: ['J2508', 'TS1S', '05032026', '335'],
//   employeeCode: 'J2508', configCode: 'TS1S',
//   dateCode: '05032026', sequence: '335'
// }
```

- [ ] Write tests for canonical parsing, lower-case normalization, and invalid/missing employee code.
- [ ] Run `npx jest src/test/shared/utils/sku.test.js --runInBand` and verify RED because the helper is absent.
- [ ] Implement the pure helper with `String`, `trim`, `toUpperCase`, `split('-')`, and a `^J\d+$` employee check.
- [ ] Re-run the focused test and verify GREEN.

### Task 2: Move existing consumers to the shared parser

**Files:**
- Modify: `src/modules/mapping/services/fulfillmentPlan.service.js`
- Modify: `src/modules/mapping/scripts/backfillFulfillmentCostEstimates.js`
- Modify: `src/modules/finance/services/financeImport.parser.js`
- Test: `src/test/mapping/services/fulfillmentPlan.service.test.js`
- Test: `src/test/finance/services/financeImport.parser.test.js`

- [ ] Write a mapping regression test that `parseInternalSku` preserves its existing public shape while consuming the shared parser.
- [ ] Run its focused Jest command and verify RED after replacing the local parser export.
- [ ] Replace the local mapping implementation with a thin compatibility wrapper around `parseSku`.
- [ ] Replace the finance-specific seller extraction with `extractEmployeeCode(value)`; free-text campaign/portfolio labels are not canonical SKUs.
- [ ] Re-run mapping and finance parser tests and verify GREEN.

### Task 3: Integrate Ads attribution reports

**Files:**
- Integrate reviewed commits `cfdae94`, `d7d45aa`, `49d2f47`, `f91a820` into the isolated branch.

- [ ] Cherry-pick the reviewed attribution commits in order.
- [ ] Resolve only mechanical context conflicts caused by the shared parser change.
- [ ] Run `npx jest src/test/shared src/test/mapping src/test/finance src/test/report --runInBand` with a local test `MONGODB_URI`.
- [ ] Run `npm run test:architecture -- --runInBand`.
