# Amazon Finance Extension Imports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Amazon Extension-driven Transactions import first, then Settlements, with backend finance import validation and FE management tabs.

**Architecture:** Reuse the existing finance import module and import batch API. Extension handles Amazon UI waits and uploads files to backend finance endpoints. FE displays read-only import history first; socket trigger is intentionally deferred.

**Tech Stack:** Node.js, Express, MongoDB, Mongoose, Jest, Chrome Extension MV3, React, Ant Design, TanStack Query, Vitest.

## Global Constraints

- Do not add Amazon SP-API.
- Do not increase global API or extension timeouts.
- `salesChannelCode` is platform: `AMAZON`.
- `marketplaceCode` is market: `US`, `CA`, `UK`, `DE`, `FR`, `IT`, `ES`, `JP`, or similar.
- Transactions ship before Settlements.
- FE does not trigger extension jobs via socket in this plan.
- Keep changes scoped to finance import, extension import UI/upload, and Integrations UI.

---

### Task 1: Audit Existing Finance Transaction And Settlement Import Contracts

**Files:**
- Inspect: `src/modules/finance/services/financeImport.service.js`
- Inspect: `src/modules/finance/controllers/financeImport.controller.js`
- Inspect: `src/modules/finance/validators/financeSnapshot.validator.js`
- Inspect: `tests/finance/services/financeImport.service.test.js`
- Inspect: `C:/lng_system/lng-web/Amazon-Extension/background.js`

**Interfaces:**
- Consumes: existing finance import endpoints.
- Produces: a short implementation note in the task result listing required transaction CSV headers and whether imports are synchronous or need queueing.

- [ ] **Step 1: Locate transaction parser expectations**

Run:

```powershell
rg -n "function importTransactions|parse.*Transactions|TRANSACTIONS|transaction" src/modules/finance tests/finance
```

Expected: exact parser and test locations are identified.

- [ ] **Step 2: Locate settlement parser expectations**

Run:

```powershell
rg -n "function importSettlements|parse.*Settlements|SETTLEMENTS|settlement" src/modules/finance tests/finance
```

Expected: exact parser and test locations are identified.

- [ ] **Step 3: Decide sync vs async**

Read the current implementation and answer:

```text
Transactions import is sync/async: <value>
Settlements import is sync/async: <value>
Minimal transaction CSV headers: <headers>
Minimal settlement CSV headers: <headers>
```

Expected: no code changes yet.

---

### Task 2: Harden Backend Transactions Import For Extension Scope

**Files:**
- Modify: `src/modules/auth/services/extensionToken.service.js`
- Modify: `src/modules/finance/services/financeImport.service.js`
- Test: `tests/auth/services/extensionToken.service.test.js`
- Test: `tests/finance/services/financeImport.service.test.js`

**Interfaces:**
- Consumes: `service.importTransactions(content, context, authContext)`.
- Produces: transaction import accepts matching shop-scoped `FINANCE:WRITE` and rejects wrong shop.

- [ ] **Step 1: Write scoped transaction import tests**

Add tests matching this shape:

```js
test('transaction import accepts shop-scoped FINANCE:WRITE for the matching shop', async () => {
  const result = await service.importTransactions(
    '"date/time",type,total\n"2026-08-12T00:00:00Z","Order",12.34\n',
    { ...context, sourceRef: 'transactions.csv', dryRun: false },
    { scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['FINANCE:WRITE'] }] },
  );

  expect(result.processedRows).toBeGreaterThanOrEqual(1);
});

test('transaction import rejects shop-scoped FINANCE:WRITE for another shop', async () => {
  await expect(service.importTransactions(
    '"date/time",type,total\n"2026-08-12T00:00:00Z","Order",12.34\n',
    { ...context, sourceRef: 'transactions.csv', dryRun: false },
    { scopes: [{ scopeType: 'shop', scopeId: '660000000000000000149999', permissions: ['FINANCE:WRITE'] }] },
  )).rejects.toThrow('Forbidden');
});
```

Run:

```powershell
npm test -- tests/finance/services/financeImport.service.test.js --runInBand
```

Expected: tests fail only if scoped import is not already supported.

- [ ] **Step 2: Implement minimal backend change**

If Ads scoped import support already covers Transactions, do not add code. If it does not, update the shared import access check in `financeImport.service.js` once so `importTransactions`, `importSettlements`, and `importAds` share the same shop-scoped write behavior.

- [ ] **Step 3: Verify backend tests**

Run:

```powershell
node -c src/modules/finance/services/financeImport.service.js
npm test -- tests/auth/services/extensionToken.service.test.js tests/finance/services/financeImport.service.test.js --runInBand
```

Expected: all focused tests pass.

---

### Task 3: Add Extension Transactions Upload UI And Payload

**Files:**
- Modify: `C:/lng_system/lng-web/Amazon-Extension/options.html`
- Modify: `C:/lng_system/lng-web/Amazon-Extension/options.js`
- Modify: `C:/lng_system/lng-web/Amazon-Extension/background.js`
- Test: `C:/lng_system/lng-web/Amazon-Extension/tests/extension-contract.test.mjs`

**Interfaces:**
- Consumes: `getCfg()` returning `ingestUrl`, `shopId`, `ingestToken`, `marketplaceCode`.
- Produces: runtime message `RUN_TRANSACTIONS_IMPORT` with `{ dateFrom, dateTo }`.

- [ ] **Step 1: Add failing extension contract test**

In `tests/extension-contract.test.mjs`, add:

```js
test("transactions import targets finance transaction endpoint", () => {
  const background = read("background.js");
  const html = read("options.html");

  assert.match(html, /id="transactionsDateFrom"/);
  assert.match(html, /id="transactionsDateTo"/);
  assert.match(html, /id="btnImportTransactions"/);
  assert.match(background, /\/api\/finance\/imports\/transactions/);
  assert.match(background, /RUN_TRANSACTIONS_IMPORT/);
  assert.match(background, /salesChannelCode: "AMAZON"/);
  assert.match(background, /marketplaceCode: marketplaceCode \|\| "US"/);
});
```

Run:

```powershell
cd C:\lng_system\lng-web\Amazon-Extension
node --test tests\extension-contract.test.mjs
```

Expected: test fails because UI/message does not exist.

- [ ] **Step 2: Add options UI**

Add a panel in `options.html`:

```html
<section class="panel">
  <div class="panel-header compact">
    <div>
      <h2>Amazon Transactions</h2>
      <p>Import transaction report for the configured shop and marketplace.</p>
    </div>
    <span class="panel-icon">TXN</span>
  </div>
  <div class="field-grid">
    <div class="field">
      <label>From</label>
      <input id="transactionsDateFrom" type="date" />
    </div>
    <div class="field">
      <label>To</label>
      <input id="transactionsDateTo" type="date" />
    </div>
  </div>
  <div class="action-grid">
    <button id="btnImportTransactions" class="btn btn-primary">Import Transactions</button>
  </div>
</section>
```

- [ ] **Step 3: Wire options message**

Add to `options.js`:

```js
on($("#btnImportTransactions"), "click", async () => {
  const dateFrom = $("#transactionsDateFrom")?.value?.trim();
  const dateTo = $("#transactionsDateTo")?.value?.trim();
  if (!dateFrom || !dateTo) return log("Select transaction date range");
  try {
    const res = await chrome.runtime.sendMessage({
      type: "RUN_TRANSACTIONS_IMPORT",
      payload: { dateFrom, dateTo },
    });
    log("RUN_TRANSACTIONS_IMPORT sent:", res || { dateFrom, dateTo });
  } catch (e) {
    log("RUN_TRANSACTIONS_IMPORT error:", e?.message || e);
  }
});
```

- [ ] **Step 4: Implement minimal background handler**

In `background.js`, add:

```js
async function runImportTransactions({ dateFrom, dateTo } = {}) {
  const { ingestUrl, shopId, marketplaceCode } = await getCfg();
  if (!ingestUrl) throw new Error("Missing ingestUrl (Options)");
  if (!shopId) throw new Error("Missing shopId (Options)");

  const { base } = deriveApiUrls(ingestUrl);
  const transactionsUrl = `${base}/api/finance/imports/transactions`;

  const csv = await fetchTransactionsCsvFromAmazon({ dateFrom, dateTo });
  return postFileTo(transactionsUrl, {
    shopId,
    salesChannelCode: "AMAZON",
    marketplaceCode: marketplaceCode || "US",
    dryRun: "false",
    sourceRef: `transactions-${dateFrom}-${dateTo}.csv`,
    file: { name: `transactions-${dateFrom}-${dateTo}.csv`, text: csv },
  });
}
```

Implement `fetchTransactionsCsvFromAmazon` using the smallest existing extension pattern found in Task 1. If there is no existing scraper/export helper, return a clear error:

```js
async function fetchTransactionsCsvFromAmazon() {
  throw new Error("Amazon Transactions export is not implemented yet");
}
```

This keeps the UI and upload contract testable without pretending scrape support exists.

- [ ] **Step 5: Register message handler**

In the existing runtime message listener, add:

```js
if (msg?.type === "RUN_TRANSACTIONS_IMPORT") {
  runImportTransactions(msg.payload || {})
    .then((result) => sendResponse({ ok: true, result }))
    .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
  return true;
}
```

- [ ] **Step 6: Verify extension**

Run:

```powershell
cd C:\lng_system\lng-web\Amazon-Extension
node -c background.js
node -c options.js
node --test tests\extension-contract.test.mjs
```

Expected: all pass.

---

### Task 4: Add FE Transactions Import History Tab

**Files:**
- Modify: `C:/lng_system/lng-web/lng-web-fe/src/features/portal/integrations/pages/IntegrationWorkbenchPage.tsx`
- Test: `C:/lng_system/lng-web/lng-web-fe/src/test/portal/integrations/pages/IntegrationWorkbenchPage.test.tsx`

**Interfaces:**
- Consumes: `listImportBatches({ sourceType: 'TRANSACTIONS', salesChannelCode: 'AMAZON', marketplaceCode, ... })`.
- Produces: Integrations tab named `Amazon Transactions`.

- [ ] **Step 1: Write failing FE test**

Add a test:

```tsx
it('shows Amazon Transactions import history for finance readers', async () => {
  renderWorkbench('/portal/integrations', account(['FINANCE:READ']));

  fireEvent.click(await screen.findByRole('tab', { name: 'Amazon Transactions' }));
  expect(await screen.findByText('Amazon Transactions imports')).toBeVisible();
  await waitFor(() =>
    expect(listImportBatches).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: 'TRANSACTIONS',
      salesChannelCode: 'AMAZON',
    })),
  );
});
```

Run:

```powershell
cd C:\lng_system\lng-web\lng-web-fe
npm run test:ui -- src/test/portal/integrations/pages/IntegrationWorkbenchPage.test.tsx
```

Expected: fails because tab does not exist.

- [ ] **Step 2: Reuse Ads import history table shape**

In `IntegrationWorkbenchPage.tsx`, add:

```tsx
const transactionImports = useQuery({
  queryKey: [...integrationKeys.all, 'transaction-imports', { transactionPage, transactionShopId, transactionStatus, ...transactionDates }],
  queryFn: () => listImportBatches({
    page: transactionPage,
    limit: PAGE_SIZE,
    sourceType: 'TRANSACTIONS',
    salesChannelCode: 'AMAZON',
    shopId: transactionShopId,
    status: transactionStatus,
    ...transactionDates,
  }),
  enabled: canReadAdsImports,
  retry: false,
});
```

Use a clearer variable name if you rename `canReadAdsImports` to `canReadFinanceImports`.

- [ ] **Step 3: Add tab item**

Add to `UiTabs.items`:

```tsx
{
  key: 'transactions',
  label: (
    <UiTabLabel>
      {t('portal.integrations.tabs.transactions', { defaultValue: 'Amazon Transactions' })}
    </UiTabLabel>
  ),
  children: transactionsTab,
}
```

- [ ] **Step 4: Verify FE**

Run:

```powershell
npm run test:ui -- src/test/portal/integrations/pages/IntegrationWorkbenchPage.test.tsx
npm run typecheck
```

Expected: all pass.

---

### Task 5: Implement Settlements By Reusing The Transactions Pattern

**Files:**
- Modify: `C:/lng_system/lng-web/Amazon-Extension/options.html`
- Modify: `C:/lng_system/lng-web/Amazon-Extension/options.js`
- Modify: `C:/lng_system/lng-web/Amazon-Extension/background.js`
- Modify: `C:/lng_system/lng-web/lng-web-fe/src/features/portal/integrations/pages/IntegrationWorkbenchPage.tsx`
- Test: matching extension and FE tests

**Interfaces:**
- Consumes: working Transactions pattern.
- Produces: Settlements upload to `/api/finance/imports/settlements` and FE tab `Amazon Settlements`.

- [ ] **Step 1: Add settlement contract tests**

Add tests analogous to Transactions, replacing:

```text
RUN_TRANSACTIONS_IMPORT -> RUN_SETTLEMENTS_IMPORT
/api/finance/imports/transactions -> /api/finance/imports/settlements
sourceType=TRANSACTIONS -> sourceType=SETTLEMENTS
```

- [ ] **Step 2: Add extension settlement UI and message**

Use IDs:

```text
settlementsDateFrom
settlementsDateTo
btnImportSettlements
```

- [ ] **Step 3: Add background settlement upload**

Use:

```js
postFileTo(`${base}/api/finance/imports/settlements`, {
  shopId,
  salesChannelCode: "AMAZON",
  marketplaceCode: marketplaceCode || "US",
  dryRun: "false",
  sourceRef: `settlements-${dateFrom}-${dateTo}.csv`,
  file: { name: `settlements-${dateFrom}-${dateTo}.csv`, text: csv },
});
```

- [ ] **Step 4: Add FE settlement tab**

Use `listImportBatches({ sourceType: 'SETTLEMENTS', salesChannelCode: 'AMAZON' })`.

- [ ] **Step 5: Verify all focused checks**

Run:

```powershell
cd C:\lng_system\lng-web\Amazon-Extension
node -c background.js
node -c options.js
node --test tests\extension-contract.test.mjs

cd C:\lng_system\lng-web\lng-web-fe
npm run test:ui -- src/test/portal/integrations/pages/IntegrationWorkbenchPage.test.tsx
npm run typecheck
```

Expected: all pass.

---

## Self-Review

- Spec coverage: Transactions, Settlements, BE, FE, Extension, timeouts, permissions, marketplace fields are covered.
- Placeholder scan: no `TBD` or unresolved implementation slots. The only deliberate branch is whether current backend is sync or async, decided by Task 1 before code changes.
- Type consistency: `sourceType` uses `TRANSACTIONS` and `SETTLEMENTS`; extension runtime messages use `RUN_TRANSACTIONS_IMPORT` and `RUN_SETTLEMENTS_IMPORT`; finance upload fields match existing finance contract.
