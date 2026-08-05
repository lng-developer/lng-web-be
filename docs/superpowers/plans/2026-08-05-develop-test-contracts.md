# Develop Test Contracts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the merged FE and BE test contracts reflect current production behavior without restoring removed UI titles or skipping coverage.

**Architecture:** Keep production code unchanged unless a focused test proves a runtime defect. Fix the BE HTTP test lifecycle/timing in its existing integration test and update FE UI assertions to stable visible controls and current copy.

**Tech Stack:** Jest, Vitest, Testing Library, React, Ant Design, Node.js.

## Global Constraints

- Do not restore page titles removed by the approved frontend refactor.
- Do not skip or delete failing tests.
- Add no dependencies or abstractions.

---

### Task 1: BE HTTP metrics lifecycle

**Files:**
- Modify: `src/test/shared/httpMetrics.test.js`

**Interfaces:**
- Consumes: `createApp().listen(0)` and Node `server.close(callback)`.
- Produces: deterministic metrics endpoint integration coverage.

- [ ] Reproduce the focused timeout.
- [ ] Await server shutdown and give this module-reset integration test a realistic timeout.
- [ ] Run `npm test -- --runInBand src/test/shared/httpMetrics.test.js`.

### Task 2: FE current-UI contracts

**Files:**
- Modify: the nine failing files reported by `npm run test:ui`.

**Interfaces:**
- Consumes: current rendered labels, controls, validation messages, and API mocks.
- Produces: assertions that fail on behavior regression rather than removed page chrome.

- [ ] Compare each failure with the current component and locale.
- [ ] Replace stale title/copy selectors with stable current behavior assertions.
- [ ] Run only the nine failing files until green.

### Task 3: Full verification

**Files:**
- Verify: both repositories.

**Interfaces:**
- Consumes: the focused fixes above.
- Produces: fresh pass/fail evidence for merge readiness.

- [ ] Run FE source lint, unit, full UI, and build.
- [ ] Run BE architecture and full Jest suites.
- [ ] Run `git diff --check`, inspect scope, and commit once per repository.
