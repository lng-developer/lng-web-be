# Etsy flow regression

Run from the backend repository:

```powershell
npm run test:etsy-flow
```

This is backend persistence/integration coverage plus targeted unit regressions, **not browser-to-live-Etsy E2E**. No operational order IDs, tokens, shop IDs, or customer information are used.

## Safety and runtime

The new persistence suite creates a temporary Mongo replica set using the installed `mongodb-memory-server`. Mongoose connects only to its returned URI and a generated `etsy_flow_test_<pid>` database. Cleanup refuses any other database name. It does not read `.env`, start application servers/schedulers, or use real Redis. Mongo binaries may need downloading on the first run.

The command includes `--experimental-vm-modules`: the installed MongoDB driver uses dynamic imports. Without this flag, Jest can obscure the underlying import error as `Missing required sub-document 'driver' in the client metadata document`. The Node experimental warning is expected. No dependency or production driver patches are required.

Real CSV parsing, import records, repositories, customization processors, mapping, listing, design lifecycle, audit and production services run against temporary Mongo. Only Smarty and queue transport are replaced. Queue payloads are consumed explicitly through the real customization and post-import mapping processors. Other background queues are captured, not scheduled.

HTTP/HTTPS/fetch calls fail the persistence suite, and real Redis access throws. No vendor transmission is authorized by this test command. The accompanying existing unit suites use mocks and must not be mistaken for persistence coverage.

## Persisted scenarios

1. CSV import: correct Etsy identity, shop, quantity, paid/source status, parsed personalization and workbench projection. Repeat import keeps order/item/listing IDs and counts.
2. Same SKU with different Etsy listing IDs: correct separate links. Manual listing remains DRAFT while order-created listing is APPROVED.
3. Listing PSD: repeated request returns one task; main image arriving later is visible in task DTO; scoped designer assignment/start/submission/QC approval updates the listing and survives reimport.
4. Variant PSD: approving one variant does not populate its sibling or the default listing PSD.
5. Cancellation/refund: item persists CANCELLED; production rejects it even after a stale New reimport.
6. Configured mapping: missing configuration blocks task creation; missing PSD blocks production; approved PSD removes that blocker from the same task. Customization reaches the production snapshot. Cancellation after production work creates a manual-review import issue rather than silently cancelling work. Handoff and vendor-submit entrypoints reject it without transmission.
7. Amazon alongside Etsy: ASIN and original customization evidence remain Amazon-specific. The separate ZIP extraction regression checks the previously broken customer-input projection sync.
8. Shop access: requesting PSD outside the authorized shop creates no task.

## Boundaries still requiring acceptance testing

- Chrome extension/VM clipboard, live Etsy AJAX/DOM/status extraction, browser rendering and actual uploads.
- Real Smarty credentials, cloud storage, image bytes/resolution and Redis retry/worker delivery. The image integration case checks Catalog-to-task DTO fallback; focused image unit tests cover the retrieval handlers.
- PSD file metadata is seeded READY; no real PSD upload or Adobe-file validity check occurs.
- Mapping/production is tested through task readiness, not operator scaling, production QC, shipment or finance completion.
- Vendor persistence case checks cancellation at entry, not a cancellation race during live dispatch. The included vendor unit suite covers additional retry/markSubmitted/submit guards. Never infer permission to send a real vendor order from a green result.
- HTTP authentication/login is outside this service-level suite; scoped authorization is exercised with synthetic auth contexts.

## Manual VM/browser acceptance

Use a designated test shop/order and verify preview before confirming import. Compare source fields/status, import twice, open listing and task images, request/approve PSD, then check mapping and production customization. Repeat with a cancelled order and confirm it cannot be sent. Stop before any real vendor submission unless separately approved.

Keep failures visible. A green targeted command does not imply the full repository test suite passed.

## Verification on 2026-10-15

- `npm run test:etsy-flow -- --silent`: 8 suites, 111 tests passed (including 8 new persistence cases).
- Architecture: 22 tests passed.
- Design/Catalog/Mapping/Production: 46 suites, 648 tests passed.
- Existing fulfillment E2E contract: 11 tests passed after adding its missing marketplace-guard mock.
- Full repository run was stopped after working memory exceeded 4 GB without completion. Full-suite status remains unverified; no production source was changed to satisfy tests.
