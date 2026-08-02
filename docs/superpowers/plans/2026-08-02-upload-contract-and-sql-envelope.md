# Upload Contract And SQL Envelope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fail oversized uploads with a stable 413 contract, standardize SQL Attendance envelopes, and add `Location` only to asset creates touched in this slice.

**Architecture:** Keep one `MEDIA_UPLOAD_MAX_BYTES` configuration value and reuse it in all existing Multer routes. Translate Multer's size error once in the global error middleware. Preserve existing controllers and services except for the SQL envelope and touched create-response headers.

**Tech Stack:** Node.js, Express, Multer, Jest, existing request test helpers.

## Global Constraints

- Do not enable the auth refresh limiter.
- Do not add OpenAPI in this slice.
- Do not add dependencies or refactor unrelated controllers.
- Write each behavior test first and observe its expected failure before production edits.
- Do not commit unless the user explicitly requests it.

---

### Task 1: Shared upload ceiling and 413 error contract

**Files:**
- Modify: `.env.example`
- Modify: `src/shared/constants/errorCodes.js`
- Modify: `src/middlewares/errorHandler.js`
- Modify: `src/modules/media/routes/index.js`
- Modify: `src/modules/design/routes/index.js`
- Modify: `src/modules/catalog/routes/index.js`
- Modify: `src/modules/production/routes/index.js`
- Test: `src/test/middlewares/errorHandler.test.js`
- Test: existing route tests under `src/test/media`, `src/test/design`, `src/test/catalog`, and `src/test/production`

**Interfaces:**
- Consumes: Multer error `{ code: 'LIMIT_FILE_SIZE' }` and `MEDIA_UPLOAD_MAX_BYTES`.
- Produces: HTTP 413 `{ success: false, error: { code: 'PAYLOAD_TOO_LARGE', message, requestId } }`.

- [ ] Write a failing middleware test that passes a Multer `LIMIT_FILE_SIZE` error and expects status 413, code `PAYLOAD_TOO_LARGE`, and the standard envelope.
- [ ] Run that test and verify it currently returns 500.
- [ ] Add `PAYLOAD_TOO_LARGE` to the existing error-code constants and translate only `LIMIT_FILE_SIZE` in `errorHandler`.
- [ ] Run the middleware test and verify it passes.
- [ ] Write failing multipart route tests using an isolated small `MEDIA_UPLOAD_MAX_BYTES` value and assert service/controller code is not called.
- [ ] Run the focused route tests and verify they fail with the current module-load limit behavior or 500 response.
- [ ] Centralize the parsed upload limit in the existing config/shared technical layer, set the default and `.env.example` to `10485760`, and reuse it in the four Multer configurations.
- [ ] Run the four focused route suites and verify 413 behavior passes.

### Task 2: SQL Attendance success envelope

**Files:**
- Modify: `src/modules/integration/sqlAttendance/controllers/sqlAttendance.controller.js`
- Create: `src/test/integration/sqlAttendance/sqlAttendance.controller.test.js`

**Interfaces:**
- Consumes: `sqlAttendance.enqueueSync()` and `sqlAttendance.getStatus()`.
- Produces: `{ success: true, data }` with existing 202 and 200 statuses.

- [ ] Write controller tests expecting `202`/`200` and `{ success: true, data }`.
- [ ] Run them and verify both fail because `success` is absent.
- [ ] Add `success: true` to both response bodies without changing service calls or status codes.
- [ ] Run the controller tests and verify they pass.

### Task 3: Location on touched asset creates

**Files:**
- Modify only asset-create controllers already touched by Tasks 1-2 if their response is `201` and exposes an asset id.
- Test the corresponding existing controller or route test files.

**Interfaces:**
- Consumes: returned asset DTO `id`.
- Produces: `Location: /api/media/assets/:id` on standalone asset creation only.

- [ ] Identify which affected upload controllers actually return 201 standalone asset resources; exclude task/file-check updates.
- [ ] Write failing assertions for the exact `Location` header on those responses.
- [ ] Run focused tests and verify the header is absent.
- [ ] Set the header directly in those controllers, without introducing a helper abstraction.
- [ ] Run focused tests and verify status, body, and header all pass.

### Task 4: Verification

**Files:** None.

- [ ] Run syntax checks for every changed JavaScript file.
- [ ] Run the focused media, design, catalog, production, SQL Attendance, and error middleware tests.
- [ ] Run `npm run test:architecture -- --runInBand` with the worktree environment loaded.
- [ ] Inspect `git diff --check`, `git diff --stat`, and the exact diff; confirm refresh limiting and OpenAPI are untouched.
