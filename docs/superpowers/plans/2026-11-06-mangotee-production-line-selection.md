# MangoTee Production Line Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans (or subagent-driven-development) to implement this plan.

**Goal:** Let operators choose an active MangoTee production line for a vendor submission without hard-coding `US1`.

**Architecture:** Add a read-only provider capability method to the vendor integration adapter registry, expose it through the vendor module route/service, include vendor identity in submission DTOs, and let the submission page load/select a line before the existing submit action. The selected line is passed through the existing submit request but no MangoTee order push is implemented in this slice.

**Files:**
- Modify BE `vendorIntegrationAdapterRegistry.service.js`, `vendor.service.js`, `vendor.controller.js`, `vendor.routes/index.js`, `vendor/public.js` if required, and vendor/submission DTO/validator/controller tests.
- Modify FE vendor-submission API/types/hooks/page and locale strings, plus focused tests.

## Tasks

1. Add failing BE tests for MangoTee production-line capability loading and unsupported-provider rejection; run the focused tests and confirm failure.
2. Implement the registry fetch using configured base URL and API-key credential, normalize the response to safe line DTOs, and add the vendor route/controller/service wiring; rerun focused BE tests.
3. Add failing FE API/page tests proving MangoTee submissions load lines, require a selected line, and send the selected ID; run them and confirm failure.
4. Implement FE query/API wiring and a minimal selection modal in the existing submit confirmation flow; preserve non-MangoTee behavior and rerun focused FE tests.
5. Run syntax checks, affected BE/FE suites, architecture tests, inspect diff, and report the remaining push-contract limitation.

## Review Focus

- API-key credentials must never be returned to FE or logs.
- Inactive lines must not be selectable; line capability fields must be treated as vendor data.
- Non-MangoTee submissions must keep the current one-click submit behavior.
- A selected line must not be persisted as a local order/submission state change in this slice.
