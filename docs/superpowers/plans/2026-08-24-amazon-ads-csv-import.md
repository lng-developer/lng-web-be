# Amazon Ads CSV Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upload the original one-day Amazon Ads CSV to the Development finance import endpoint, with parsing owned by the backend.

**Architecture:** The extension reuses an Amazon Reporting CSV configuration, requests a one-off run, polls its status, obtains the CSV in memory, and uploads its unchanged bytes. The finance parser continues to create the existing import batch and adds Amazon Reporting's `Total cost` column as a spend alias.

**Tech Stack:** Chrome Manifest V3, JavaScript modules, Node.js, Express, Jest.

**Spec:** `docs/superpowers/specs/2026-08-24-amazon-ads-csv-import-design.md`

## Global Constraints

- Do not use Amazon SP-API, modify campaigns, bids, or budgets.
- Keep the existing one-run Ads lock and Development-only guard.
- Never persist or log cookies, request headers, signed URLs, credentials, or CSV content.
- Keep `/api/finance/imports/ads` and FinanceImportBatch as the backend import surface.
- Do not commit or push as part of this implementation.

---

### Task 1: Accept Amazon Reporting's `Total cost` in the backend parser

**Files:**
- Modify: `src/modules/finance/services/financeImport.parser.js:181-205`
- Test: `tests/finance/services/financeImport.parser.test.js`

**Interfaces:**
- Consumes: a CSV header normalized by `rowObject()`.
- Produces: `parseAdsCsv(text)` rows where `spendAmount` is an integer minor-unit value.

- [ ] **Step 1: Write the failing parser test**

```js
test('parses Amazon Reporting Total cost as spend', () => {
  const [row] = parseAdsCsv('Date,Campaign Name,Total cost\n"Apr 15, 2026",Campaign A,"$3.93"');
  expect(row.spendAmount).toBe(393);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/finance/services/financeImport.parser.test.js --runInBand`

Expected: the new assertion receives `0`.

- [ ] **Step 3: Prefer `Total cost`, while retaining legacy `Spend`**

```js
spendAmount: moneyToMinor(raw['total cost'] || raw.spend),
```

- [ ] **Step 4: Run parser verification**

Run: `npx jest tests/finance/services/financeImport.parser.test.js --runInBand`

Expected: PASS.

### Task 2: Replace synthetic campaign rows with raw report-file handoff

**Files:**
- Create: `C:\lng_system\lng-web\Amazon-Extension-command-phase1\adsReporting.js`
- Modify: `C:\lng_system\lng-web\Amazon-Extension-command-phase1\backendApi.js`
- Modify: `C:\lng_system\lng-web\Amazon-Extension-command-phase1\background.js:720-1265`
- Delete: `C:\lng_system\lng-web\Amazon-Extension-command-phase1\adsCampaignSpend.js`
- Delete: `C:\lng_system\lng-web\Amazon-Extension-command-phase1\tests\ads-campaign-spend.test.mjs`
- Test: `C:\lng_system\lng-web\Amazon-Extension-command-phase1\tests\ads-reporting.test.mjs`

**Interfaces:**
- Consumes: selected ISO date, an existing CSV report configuration, and its status response.
- Produces: a cloned one-off configuration, exact polling decisions, and a `Blob` uploaded unchanged by `postFileTo()`.

- [ ] **Step 1: Write failing pure-function tests**

```js
assert.equal(isTerminalReportStatus('COMPLETED'), true);
assert.equal(isTerminalReportStatus('SCHEDULED'), false);
assert.equal(buildOneOffReportConfig(template, '2026-08-20').period.datePeriod.startDate, '2026-08-20');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test tests/ads-reporting.test.mjs`

Expected: module-not-found failure.

- [ ] **Step 3: Add only report-configuration helpers**

```js
export const REPORT_POLL_INTERVAL_MS = 10_000;
export const REPORT_POLL_MAX_ATTEMPTS = 18;
export function isTerminalReportStatus(status) { return ['COMPLETED', 'FAILED', 'CANCELLED', 'EXPIRED'].includes(status); }
```

`buildOneOffReportConfig()` must clone a compatible existing CSV configuration and change only name, date period, schedule, schedule type, and active state. It must remove IDs/timestamps/latest-run fields before creation.

- [ ] **Step 4: Extend file upload to accept a Blob without converting it to text**

```js
if (fields.file instanceof Blob) fd.append('file', fields.file, fields.filename || 'file.csv');
```

- [ ] **Step 5: Replace the synthetic path in `runExportAdsSpendLocked()`**

Remove `fetchAllCampaignSpend()`, `campaignRowsToCsv()`, and `mapCampaignSpend()` use. The replacement must call the reporting bridge, wait for the exact configuration status, obtain a `Blob`, then call `postFileTo()` with that same Blob and `ads-report-YYYY-MM-DD.csv`.

- [ ] **Step 6: Run extension unit and syntax checks**

Run: `node --test tests/ads-reporting.test.mjs; node --check background.js; node --check backendApi.js`

Expected: PASS.

### Task 3: Reporting-page bridge and in-memory CSV download

**Files:**
- Modify: `C:\lng_system\lng-web\Amazon-Extension-command-phase1\ads_bridge.js`
- Modify: `C:\lng_system\lng-web\Amazon-Extension-command-phase1\ads_main_sniffer.js`
- Modify: `C:\lng_system\lng-web\Amazon-Extension-command-phase1\manifest.json`
- Test: `C:\lng_system\lng-web\Amazon-Extension-command-phase1\tests\extension-contract.test.mjs`

**Interfaces:**
- Consumes: bridge messages `ADS_REPORTING_REQUEST` and `ADS_DOWNLOAD_LATEST_REPORT`.
- Produces: JSON response metadata or a transient S3 URL that is immediately fetched as a `Blob`; it never writes the URL or file to storage/logs.

- [ ] **Step 1: Add a failing contract assertion**

```js
assert.match(bridge, /ADS_REPORTING_REQUEST/);
assert.doesNotMatch(background, /campaignRowsToCsv/);
```

- [ ] **Step 2: Run the contract test to verify it fails**

Run: `node --test tests/extension-contract.test.mjs`

Expected: the new reporting bridge assertion fails.

- [ ] **Step 3: Route reporting API requests through the existing Advertising content script**

The bridge must issue `POST` with the already-captured in-memory headers and credentials to the three observed endpoints: query configurations, create configurations, and create scheduled reports. It must return only HTTP status and parsed JSON; no response preview or headers are logged.

- [ ] **Step 4: Capture and consume the one-time CSV download only in memory**

The reporting-page bridge triggers its own visible `Download latest` control after the report reaches `COMPLETED`. The main-world script forwards only the direct signed download URL to the requesting run. Background fetches that URL as a `Blob`, immediately removes it from the pending run state, and uploads it. Add only the observed decorated-reports S3 host to `host_permissions`.

- [ ] **Step 5: Run contract verification**

Run: `node --test tests/extension-contract.test.mjs; node --check ads_bridge.js; node --check ads_main_sniffer.js; git diff --check`

Expected: PASS.

### Task 4: Verify the integrated Development-only flow

**Files:**
- Verify only: backend and extension files changed in Tasks 1-3.

**Interfaces:**
- Consumes: a loaded Amazon Reporting tab and one compatible CSV reporting configuration.
- Produces: a completed FinanceImportBatch whose stored source is the original CSV and whose non-zero spend agrees with the downloaded CSV total.

- [ ] **Step 1: Run narrow automated checks**

Run: `npx jest tests/finance/services/financeImport.parser.test.js --runInBand; node --test tests/ads-reporting.test.mjs tests/extension-contract.test.mjs`

Expected: PASS.

- [ ] **Step 2: Reload unpacked extension and perform one Development-only import**

Open Amazon Reporting, keep the existing compatible CSV report configuration available, then click `Import Ads spend` once.

- [ ] **Step 3: Verify the batch without exposing source content**

Confirm the extension progress reaches completion, the Ads imports table contains a completed batch, and row count plus total spend are non-zero when the downloaded CSV contains non-zero `Total cost`.

- [ ] **Step 4: Review the diff and leave changes uncommitted**

Run: `git diff --check; git status --short` in each changed repository.

Expected: no whitespace errors; no commit or push.
