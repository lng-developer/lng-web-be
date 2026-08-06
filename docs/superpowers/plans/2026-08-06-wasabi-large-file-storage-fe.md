# Wasabi Large File Storage FE Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let designers upload 100 MB to 2 GB PSD/ZIP packages directly to Wasabi with progress, retry, cancel, and a separate Cloudinary preview upload.

**Architecture:** The FE asks the BE for multipart URLs, uploads file slices directly with native `fetch`, then completes the MediaAsset and submits its ID through the existing Design Task API. The existing Axios API client remains responsible for authenticated BE requests; no Wasabi credentials are present in the browser.

**Tech Stack:** React 19, TypeScript, Ant Design 6, TanStack Query 5, Axios, native `Blob.slice`, `fetch`, and `AbortController`, Vitest.

## Global Constraints

- Accept `.psd` and `.zip` packages up to 2 GB.
- Upload package bytes directly to Wasabi; never send them through the authenticated Axios client.
- Upload preview JPG/PNG/WebP separately through the existing Cloudinary-backed endpoint.
- Keep at most three Wasabi part uploads in flight.
- Permit retry of an individual failed part and cancellation of the whole upload.
- Do not add a multipart-upload dependency; native browser APIs cover this flow.
- Run focused Vitest files per task and the full FE test suite only once at the final gate.

---

## File Map

- `src/shared/media/mediaApi.ts`: typed multipart BE contract.
- `src/shared/media/uploadMultipartAsset.ts`: framework-free upload orchestrator.
- `src/features/portal/design/pages/DesignWorkbenchPage.tsx`: designer submission UI and preview separation.
- Existing Design API submits the completed MediaAsset ID.

### Task 1: Typed multipart client and upload orchestrator

**Files:**
- Modify: `src/shared/media/mediaApi.ts`
- Create: `src/shared/media/uploadMultipartAsset.ts`
- Modify: `src/shared/media/index.ts`
- Test: `src/test/shared/media/mediaApi.test.ts`
- Create: `src/test/shared/media/uploadMultipartAsset.test.ts`

**Interfaces:**
- Produces: `uploadMultipartAsset(file, options): Promise<MediaAsset>` where options contain `assetPurpose`, `signal`, and `onProgress(percent)`.

- [ ] **Step 1: Add failing API contract tests**

Assert initiate, batched part presign, complete, and abort use these paths:

```text
/api/media/multipart/initiate
/api/media/multipart/:assetId/presign-parts
/api/media/multipart/:assetId/complete
/api/media/multipart/:assetId
```

- [ ] **Step 2: Add failing orchestrator tests**

Use a synthetic `File` and mocked API/fetch calls. Assert `Blob.slice()` boundaries, at most three concurrent PUT requests, ETag collection, aggregate progress, retry of one failed part, sorted completion parts, and abort on `AbortSignal`.

- [ ] **Step 3: Run focused tests and confirm failure**

Run: `npx vitest run src/test/shared/media/mediaApi.test.ts src/test/shared/media/uploadMultipartAsset.test.ts --project unit`

- [ ] **Step 4: Implement typed API functions**

Define:

```ts
export type MultipartPurpose = 'PSD_TEMPLATE' | 'DESIGN_PACKAGE' | 'PRINT_READY'
export type MultipartPart = { partNumber: number; etag: string }
```

The initiate response supplies `assetId`, `partSize`, and `totalParts`; presign accepts batches of no more than 20 part numbers.

- [ ] **Step 5: Implement the native uploader**

For each part:

```ts
const body = file.slice(start, Math.min(start + partSize, file.size))
const response = await fetch(url, { method: 'PUT', body, signal })
const etag = response.headers.get('etag')
```

Retry each failed PUT at most twice with a small bounded delay. If cancellation or terminal failure occurs, call abort best-effort and rethrow the original error.

- [ ] **Step 6: Run focused tests and commit in the FE repo**

Run the command from Step 3; expected PASS.

Commit: `feat(media): add multipart asset uploader`

### Task 2: Designer package and preview submission flow

**Files:**
- Modify: `src/features/portal/design/pages/DesignWorkbenchPage.tsx`
- Modify: `src/features/portal/design/api/designApi.ts`
- Modify: `src/shared/i18n/locales/en/common.json`
- Modify: `src/shared/i18n/locales/vi/common.json`
- Test: `src/test/portal/design/pages/DesignWorkbenchPage.test.tsx`
- Test: `src/test/portal/design/api/designApi.test.ts`

**Interfaces:**
- Consumes: `uploadMultipartAsset()` from Task 1 and existing `uploadDesignAsset()` for preview images.
- Produces: Design submission containing one READY PSD/ZIP package asset plus an optional separately uploaded preview asset.

- [ ] **Step 1: Add failing UI tests**

Assert the submission modal:

- accepts one `.psd` or `.zip` package;
- rejects a package over 2 GB before calling the API;
- accepts a separate JPG/PNG/WebP preview;
- displays byte progress and a Cancel action;
- disables Submit until the package reaches READY;
- submits package and preview asset IDs through the existing `submittedAssetIds` field.

- [ ] **Step 2: Run the focused test and confirm failure**

Run: `npx vitest run src/test/portal/design/pages/DesignWorkbenchPage.test.tsx src/test/portal/design/api/designApi.test.ts --project ui --maxWorkers=1`

- [ ] **Step 3: Replace large-file submission only**

Route PSD/ZIP through `uploadMultipartAsset(..., { assetPurpose: 'DESIGN_PACKAGE' })`. Keep reference images and preview upload on `uploadDesignAsset()`. Do not modify Catalog's preview field in this task.

- [ ] **Step 4: Add clear recovery behavior**

On a terminal part failure, keep the selected file and show Retry. On Cancel, abort and reset upload state. Closing the modal while uploading asks for confirmation and then aborts.

- [ ] **Step 5: Run focused tests and commit**

Run the command from Step 2; expected PASS.

Commit: `feat(design): upload PSD packages to Wasabi`

### Task 3: Final FE contract and build verification

**Files:**
- Modify only files required by failures found in this task.
- Test: `src/test/shared/media/mediaConsumerContract.test.ts`
- Test: `src/test/portal/design/pages/DesignWorkbenchPage.test.tsx`

**Interfaces:**
- Produces: verified FE-to-BE multipart contract and production build.

- [ ] **Step 1: Add/adjust consumer contract assertions**

Assert the FE uses BE-returned `partSize`, does not construct Wasabi object keys, does not send Authorization headers to presigned Wasabi URLs, and exposes ETag failures as actionable upload errors.

- [ ] **Step 2: Run narrow validation**

```powershell
npx vitest run src/test/shared/media src/test/portal/design/api/designApi.test.ts src/test/portal/design/pages/DesignWorkbenchPage.test.tsx --maxWorkers=2
npm run typecheck
npm run lint -- --quiet
```

- [ ] **Step 3: Run the final FE gate once**

```powershell
npm run test:ci
npm run build:prod
```

Expected: tests and production build pass. Do not rerun full tests if only documentation or commit metadata changes afterward.

- [ ] **Step 4: Commit final contract corrections if any**

If Step 2 or Step 3 required source changes, commit them as `test(media): verify multipart upload contract`. If no source changed, do not create an empty commit.
