# Amazon Ads Gmail Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically import the daily Amazon Ads campaign-spend CSV linked from Gmail.

**Architecture:** `integration/amazonAdsEmail` polls Gmail over IMAP, validates one Amazon report email, downloads a validated S3 CSV to a temporary file, and calls Finance through its public port. Finance continues to own parsing, media storage, import batch history, and Ads persistence.

**Tech Stack:** Node.js CommonJS, IMAPFlow, mailparser, Mongoose, Jest.

**Spec:** `docs/superpowers/specs/2026-08-25-amazon-ads-gmail-import-design.md`

## Global Constraints

- Never log or commit the Gmail App Password, report URL, raw email, or CSV rows.
- Accept only `no-reply@ads.amazon.com`, `LNG Daily Campaign Spend`, HTTPS Amazon S3 links, and configured shop/channel/marketplace context.
- The API process owns a non-overlapping five-minute poll; no new HTTP endpoint or extension behavior.
- Reuse Finance import via a public port and use `gmail:<message-id>` as the source reference.

---

### Task 1: Parse the native Amazon Ads CSV correctly

**Files:**
- Modify: `src/modules/finance/services/financeImport.parser.js`
- Modify: `tests/finance/services/financeImport.parser.test.js`

**Interfaces:**
- Produces: `parseAdsCsv(text)` rows with `reportDate`, `campaignId`, `campaignName`, `currency`, and `spendAmount`.

- [ ] **Step 1: Write a failing parser test**

```js
expect(parseAdsCsv('Date range,Budget currency,Campaign name,Campaign ID,Total cost\n"Aug 24, 2026 - Aug 24, 2026",USD,Campaign,"=""123""",4.25'))
  .toEqual([expect.objectContaining({ reportDate: new Date('2026-08-24T00:00:00.000Z'), campaignId: '123', currency: 'USD', spendAmount: 425 })]);
```

- [ ] **Step 2: Run the focused test and confirm it fails because `Date range` and campaign ID are unsupported.**

Run: `npm test -- tests/finance/services/financeImport.parser.test.js --runInBand`

- [ ] **Step 3: Implement the minimal parser normalization.**

```js
const reportDate = parseDateRangeStart(raw['date range']) || parseDate(raw.date);
const campaignId = String(raw['campaign id'] || '').replace(/^="?(.+?)"?$/, '$1');
```

- [ ] **Step 4: Run the focused test and confirm it passes.**

- [ ] **Step 5: Keep `campaignId` in Ads persistence only if the existing uniqueness key needs it.**

### Task 2: Expose the existing Finance importer through a public port

**Files:**
- Modify: `src/modules/finance/public.js`
- Test: `tests/finance/public.import.test.js`

**Interfaces:**
- Produces: `financePublic.importAdsFromFile(file, context, systemAuth)`.

- [ ] **Step 1: Write a failing public-port test that calls `importAdsFromFile`.**
- [ ] **Step 2: Run it and confirm the export is missing.**
- [ ] **Step 3: Export only `financeImport.service.importAdsFromFile`.**
- [ ] **Step 4: Run the focused public-port test.**

### Task 3: Receive, validate, and import one Gmail report

**Files:**
- Create: `src/modules/integration/amazonAdsEmail/services/amazonAdsEmailImport.service.js`
- Create: `tests/integration/amazonAdsEmail/services/amazonAdsEmailImport.service.test.js`
- Modify: `src/config/index.js`
- Modify: `package.json`, `package-lock.json`

**Interfaces:**
- Consumes: `config.amazonAdsGmail` and `financePublic.importAdsFromFile`.
- Produces: `runAmazonAdsEmailImportOnce()` returning `{ imported, skipped, failed }`.

- [ ] **Step 1: Write failing tests for trusted email import, untrusted sender rejection, unsafe download URL rejection, duplicate source reference skipping, and failed import leaving the email unread.**
- [ ] **Step 2: Run the focused test and confirm the module is missing.**
- [ ] **Step 3: Add `imapflow` and `mailparser`, then implement the smallest injectable service: IMAP search/fetch, MIME parse, strict validation, temporary CSV download, Finance public-port call, and cleanup.**
- [ ] **Step 4: Add environment validation/default-disabled configuration; only create an IMAP connection when enabled.**
- [ ] **Step 5: Run the focused service tests and parser tests.**

### Task 4: Schedule safely at server lifecycle boundaries

**Files:**
- Create: `src/modules/integration/amazonAdsEmail/services/amazonAdsEmailImportScheduler.service.js`
- Create: `tests/integration/amazonAdsEmail/services/amazonAdsEmailImportScheduler.service.test.js`
- Modify: `src/server.js`

**Interfaces:**
- Produces: `startAmazonAdsEmailImportScheduler()` and `stopAmazonAdsEmailImportScheduler()`.

- [ ] **Step 1: Write failing tests for immediate single run, non-overlap, disabled configuration, and `clearInterval` shutdown.**
- [ ] **Step 2: Run the focused test and confirm the scheduler is missing.**
- [ ] **Step 3: Implement a process-local `running` guard, `setInterval`, and clean stop function; wire both start and stop in `src/server.js`.**
- [ ] **Step 4: Run scheduler/service/parser tests, `node -c` on changed JS files, and `npm run test:architecture -- --runInBand`.**

### Task 5: Final review

- [ ] **Step 1: Review `git diff --check` and confirm no credential, URL, raw email, or CSV content appears in code/tests/logs.**
- [ ] **Step 2: Run all focused tests again.**
- [ ] **Step 3: Report required server-only environment variables and manual acceptance test; do not commit or deploy.**
