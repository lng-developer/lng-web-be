# Local Upload Performance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and run a disposable local HTTP benchmark that separates generic Cloudinary upload latency from the additional synchronous listing PSD workflow latency.

**Architecture:** A small benchmark helper owns fixture generation and statistics; a CLI starts the existing Express app on an ephemeral local port, authenticates through the real login endpoint, performs multipart requests, and cleans every returned asset through existing guarded module APIs. The CLI restores the selected listing before discarding benchmark assets and emits one JSON report. No production upload behavior changes.

**Tech Stack:** Node.js 22 built-in `fetch`, `FormData`, `Blob`, `crypto`, `fs`; Express; Mongoose; Cloudinary; Jest.

## Global Constraints

- Benchmark only `POST /api/media/assets` and `POST /api/catalog/listings/:listingId/psd-template`.
- Use `.psd` fixtures of exactly 1 MiB, 5 MiB, and 9 MiB to stay below the observed Cloudinary 10 MiB raw-file limit.
- Warm each endpoint once with 1 MiB, then collect three measured samples per endpoint and size.
- Never print credentials, tokens, MongoDB URIs, Cloudinary credentials, or file contents.
- Require database name `lng_web_be` and configured provider `cloudinary` before the first upload.
- Restore the listing's original `psdTemplateAssetId` and `psdStatus` before discarding benchmark assets.
- Destroy Cloudinary objects and mark only filename-marked, exact-metadata-matching benchmark MediaAsset rows `DISCARDED` through the media public port.
- Stop new samples after cleanup failure and report exact orphan IDs.
- Add no dependency and make no production upload behavior change.
- Do not commit, merge, or push unless explicitly requested.

---

## File Map

- Create `src/scripts/uploadBenchmark.js`: pure fixture/statistics/multipart helpers and benchmark orchestration with injected I/O.
- Create `src/scripts/benchmarkUploads.js`: database/app lifecycle, preflight, login, target listing resolution, cleanup, and JSON CLI output.
- Create `src/test/scripts/uploadBenchmark.test.js`: deterministic unit tests for sizes, statistics, ordering, decision gate, cleanup, and restoration-before-discard.
- Modify `package.json`: add `benchmark:uploads`.
- Create `docs/superpowers/reports/2026-08-02-local-upload-performance.md`: measured results and bottleneck decision.

### Task 1: Pure Benchmark Helpers

**Files:**
- Create: `src/scripts/uploadBenchmark.js`
- Test: `src/test/scripts/uploadBenchmark.test.js`

**Interfaces:**
- Produces `FIXTURE_SIZES: [{ label: '1MiB', bytes: 1048576 }, { label: '5MiB', bytes: 5242880 }, { label: '9MiB', bytes: 9437184 }]`.
- Produces `createFixtureBuffer(bytes, seed): Buffer` using deterministic non-secret bytes.
- Produces `summarizeSamples(samples, bytes): { count, medianMs, p95Ms, throughputMiBPerSecond }`.
- Produces `classifyBottleneck(mediaSummary, listingSummary): { incrementalMs, incrementalPercent, decision }`.

- [ ] **Step 1: Write failing fixture and statistics tests**

Assert exact fixture sizes, deterministic output for the same seed, differing output for different seeds, median of `[100, 200, 300]` equals `200`, nearest-rank p95 equals `300`, and throughput uses `bytes / medianMs`.

- [ ] **Step 2: Run RED**

```powershell
$env:DOTENV_CONFIG_PATH='C:\Users\stack\Task\lng-web-be\.env'
node -r dotenv/config node_modules/jest/bin/jest.js src/test/scripts/uploadBenchmark.test.js --runInBand
```

Expected: FAIL because `uploadBenchmark.js` does not exist.

- [ ] **Step 3: Implement the smallest pure helpers**

Use `crypto.createHash('sha256')` with `seed:chunkIndex` to fill buffers without adding a random-data dependency. Round milliseconds and throughput to two decimals. Reject empty samples and non-positive byte sizes.

- [ ] **Step 4: Add and pass decision-gate tests**

Assert `post-actions` when incremental latency is at least 500 ms or at least 20%, `storage-network` below both thresholds, and `increase-samples` when `(max-min)/median > 0.2` for either endpoint.

- [ ] **Step 5: Run GREEN and syntax check**

```powershell
node -r dotenv/config node_modules/jest/bin/jest.js src/test/scripts/uploadBenchmark.test.js --runInBand
node -c src/scripts/uploadBenchmark.js
```

### Task 2: HTTP Orchestration And Cleanup Contract

**Files:**
- Modify: `src/scripts/uploadBenchmark.js`
- Modify: `src/test/scripts/uploadBenchmark.test.js`

**Interfaces:**
- Produces `uploadMultipart({ url, token, filename, mimeType, buffer }): Promise<{ status, durationMs, body }>`.
- Produces `runUploadBenchmark({ sizes, sampleCount, warmup, uploadMedia, uploadListing, cleanup, restoreListing }): Promise<Report>`.
- `cleanup(asset)` consumes `{ id, metadata }`; `restoreListing()` runs before cleanup begins.

- [ ] **Step 1: Write failing orchestration tests**

Inject fake upload functions and assert call order is media warm-up, listing warm-up, then alternating media/listing measured calls for each size. Assert returned IDs from successful responses are tracked even when a later request fails.

- [ ] **Step 2: Write failing cleanup safety tests**

Assert `restoreListing` runs exactly once before any `cleanup`; cleanup runs in `finally` in reverse creation order; a cleanup rejection stops further cleanup mutation, returns the remaining orphan IDs, and causes the benchmark to reject with `UPLOAD_BENCHMARK_CLEANUP_FAILED`.

- [ ] **Step 3: Run RED and implement orchestration**

Use loops and `try/finally`; do not add a class, queue, concurrency layer, or retry abstraction. Validate every HTTP response. Require an asset ID from the media response; after a successful listing response, re-read the listing and track its current `psdTemplateAssetId`.

- [ ] **Step 4: Run GREEN**

Run the Task 1 Jest command. Expected: all tests PASS.

### Task 3: Safe CLI And Existing-App Wiring

**Files:**
- Create: `src/scripts/benchmarkUploads.js`
- Modify: `package.json`
- Modify: `src/test/scripts/uploadBenchmark.test.js`

**Interfaces:**
- CLI consumes `UPLOAD_BENCHMARK_IDENTIFIER`, `UPLOAD_BENCHMARK_PASSWORD`, and optional `UPLOAD_BENCHMARK_LISTING_ID`.
- Produces `main(dependencies?): Promise<Report>` for test injection.
- Adds `"benchmark:uploads": "node -r dotenv/config src/scripts/benchmarkUploads.js"`.

- [ ] **Step 1: Add failing preflight tests**

Assert the CLI rejects before starting HTTP when credentials are missing, `mongoose.connection.name !== 'lng_web_be'`, media provider is not `cloudinary`, the login fails, or the configured listing cannot be read by the authenticated account. Assert messages name variables but never their values.

- [ ] **Step 2: Implement minimal lifecycle**

Connect with the existing database utility, listen with the existing Express app on `127.0.0.1` port `0`, log in through `POST /api/auth/login`, and select `UPLOAD_BENCHMARK_LISTING_ID` or the first item returned by `GET /api/catalog/listings?limit=1`. Close HTTP server and database connection in `finally`.

- [ ] **Step 3: Implement guarded restoration and cleanup**

Read the original listing through its owning repository before samples. Restore exactly `psdTemplateAssetId` and `psdStatus` through the owning repository. For each returned ID call `mediaPublic.discardUnattachedAsset(id, exactMetadata, 'LOCAL_UPLOAD_BENCHMARK_COMPLETE')`; verify each resulting row is `DISCARDED` and record any orphan ID.

- [ ] **Step 4: Add package command and run tests**

```powershell
node -r dotenv/config node_modules/jest/bin/jest.js src/test/scripts/uploadBenchmark.test.js --runInBand
node -c src/scripts/benchmarkUploads.js
```

Expected: PASS and zero syntax errors.

### Task 4: Real Cloudinary Benchmark And Evidence Report

**Files:**
- Create: `docs/superpowers/reports/2026-08-02-local-upload-performance.md`

**Interfaces:**
- Consumes `npm run benchmark:uploads`.
- Produces one JSON result plus a Markdown interpretation; no active benchmark asset remains.

- [ ] **Step 1: Preflight without printing secrets**

Set credential variables only in the process environment. Confirm output names database `lng_web_be`, provider `cloudinary`, selected listing ID, and original listing state. Do not echo the token or password.

- [ ] **Step 2: Run the benchmark**

```powershell
$env:DOTENV_CONFIG_PATH='C:\Users\stack\Task\lng-web-be\.env'
npm run benchmark:uploads
```

Expected: two warm-ups plus 18 measured successful requests, followed by successful restoration and cleanup. If variance exceeds 20%, rerun only the affected endpoint/size with five measured samples.

- [ ] **Step 3: Verify cleanup from both sides**

Query benchmark asset IDs and assert every MediaAsset status is `DISCARDED`; query Cloudinary by each recorded provider asset ID and assert it no longer resolves. Re-read the listing and compare both original fields exactly. Report orphan IDs immediately if any assertion fails.

- [ ] **Step 4: Write the report**

Include per-size median, p95, MiB/s, listing incremental milliseconds/percentage, variance, cleanup proof, and the decision `post-actions`, `storage-network`, or `increase-samples`. Do not include credentials, URLs containing signatures, or raw response bodies.

### Task 5: Verification And Handoff

**Files:**
- Verify: `src/scripts/uploadBenchmark.js`
- Verify: `src/scripts/benchmarkUploads.js`
- Verify: `src/test/scripts/uploadBenchmark.test.js`
- Verify: `docs/superpowers/reports/2026-08-02-local-upload-performance.md`

**Interfaces:**
- Produces verified benchmark tooling and a root-cause direction; does not optimize production upload behavior.

- [ ] **Step 1: Run focused and architecture tests**

```powershell
$env:DOTENV_CONFIG_PATH='C:\Users\stack\Task\lng-web-be\.env'
node -r dotenv/config node_modules/jest/bin/jest.js src/test/scripts/uploadBenchmark.test.js src/test/architecture.contract.test.js --runInBand
```

- [ ] **Step 2: Run full suite and diff check**

```powershell
$env:LOG_LEVEL='silent'
node -r dotenv/config node_modules/jest/bin/jest.js --runInBand
git diff --check
```

- [ ] **Step 3: Present the decision gate**

If `post-actions`, propose a separate design that removes only proven synchronous work from the response path. If `storage-network`, propose direct multipart streaming before considering browser-to-Cloudinary uploads. If `increase-samples`, gather five samples and make no optimization proposal yet.
