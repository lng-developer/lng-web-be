# Etsy order display fields — 2026-10-14

## 2026-10-15 import presentation and projection repair

- Etsy queued jobs record `importOrigin` from authenticated token type, never from a client claim. Existing jobs without origin remain labelled Etsy report; no historical origin is guessed. Stored source and marketplace identity remain unchanged.
- Raw rows record order-level CREATED/UPDATED outcomes. Job list/detail/progress DTOs include `resultSummary`: distinct created/updated orders (null for unrecorded legacy outcomes), open issues and address-validation issues. Existing imported/skipped/failed counters still count rows for backward compatibility.
- FE uses the same source/result presentation on the job table and detail panel, with matching English/Vietnamese translations. Etsy's internal marketplace code is no longer displayed as a geographic claim.
- Parsing now publishes the persisted customization result through the Order public port. Base projection refresh merges existing item enrichments atomically and refreshes compact shop metadata instead of resetting them.
- No order status transition, Smarty call, historical job backfill, or live projection repair is part of this code change. Existing stale projections still need an authorized refresh/reimport after backend restart.
- Verification: focused BE suites 108 tests and architecture 22 tests passed; FE unit 77 suites/260 tests and build passed. Three UI expectations were updated for explicit row labels and passed again; a new Etsy source/outcome/address-issue UI test also passed. Read-only Mongo aggregation verified preservation and multi-row order deduplication. Broad BE attempt was stopped after MongoMemoryServer setup failures in `teamMembership.migration.test.js`, `staffProvisioning.persistence.test.js`, and `orderProductionAudit.persistence.test.js`; the broad FE UI run was stopped, so full-suite success is not claimed. Local backend restarted with schedulers OFF and health endpoint returned OK; no historical data was rewritten.

Read-only sample: order `4193749613`, item `5243047383`, shop `LilNamStore-Etsy` in `lng_web_be`. No live order or projection was rewritten during this change.

| Field | Evidence / change |
| --- | --- |
| Order, transaction, listing IDs | Present in captured CSV and normalized records. Workbench now preserves channel/listing identity and FE displays Etsy Listing ID instead of ASIN, plus transaction ID. |
| Product title, SKU, quantity | Present in normalized record. FE adds Etsy product title; existing SKU/quantity controls stay unchanged. |
| Variations | Present in `variantRaw`; previously dropped by compact Workbench projection. Added a string-only `variations` display field, not the raw object. |
| Personalization | Captured and parsed by existing customization flow; kept unchanged. |
| Listing image | Optional `LNG Listing Image` and `LNG Listing Thumbnail` carry observed CDN URLs. Same-image enrichment has a 15-second capture budget. A separate image worker stores validated bytes in Media; `OrderItem.listingImage` retains the source/asset reference across same-source reimports. Workbench exposes `listingImageAssetId`, `listingImageUrl`, and `listingImageThumbnailUrl`. Catalog main image remains first priority; then saved Media, then source/thumbnail. This is never customer artwork. |
| Customer artwork | Separate existing Media/customization flow. Sample has zero detected files; actual Etsy attachment presence remains unverified. Listing image is never added to customer assets or expected-file count. |
| Price, tax, shipping, currency | Present in sample normalized price; existing pricing calculation/display unchanged. Quantity >1 financial reconciliation is not established by this one-item sample. |
| Paid/sale dates, delivery address | Present in source CSV and existing normalized pipeline. No changes to address validation. |
| Ship-by deadline | Missing from sample and current collector output. Not inferred from paid date or a guessed handling period. Needs a captured Etsy source field before implementation. |

## Compatibility and testing

- Existing CSVs without the optional image column remain accepted.
- Standard OrderItem DTO still excludes raw variant/customization/external snapshots. Only Workbench/expanded detail receive bounded display fields.
- HTTPS Etsy CDN image URLs only; no arbitrary host, embedded credentials, raw provider payload or customer file URL exposed by this addition.
- Existing persisted Workbench projections do not gain new fields automatically. Rebuild/reimport is a separate data operation requiring a bounded target. The sample's old CSV contains no listing image, so a projection rebuild alone cannot recover its thumbnail.
- FE changes are on `EC/etsy-order-fields`; BE and extension remain on their existing Etsy branches. Deploy compatible BE/FE; capture a new preview with the updated extension for the new image column.
- Smarty HTTP 402, live customer-image verification, deadline capture and data backfill remain outside this change.

## Local verification

- Extension: 51 tests passed, including paired collector/CSV/BE mapper image preservation.
- Final targeted BE: 9 suites / 56 tests passed; architecture and raw-data non-exposure checks included.
- Broad BE run before the final legacy-projection fallback: 349 suites / 2,844 tests passed; 26 suites could not load missing `mongodb-memory-server`/`supertest`, 2 suites skipped. Not an all-suite pass.
- FE: Etsy OrderItemPanel UI regression passed; 75 unit suites / 252 tests passed. Typecheck and production build passed. Targeted lint has no errors and 3 existing hook warnings in OrderItemPanel.
- Full FE UI run did not produce completed suites in the bounded check window with either forks or threads and was stopped. Whole-UI regression coverage and real browser rendering remain unverified.
- No commit, push, deployment, backend restart or live projection rebuild was performed for this field-display change.

## 2026-10-15 data-completeness fixes (local, not deployed)

- Country names use runtime English region names plus existing aliases; preserve the original country string even if no code is found. A read-only remap of the five rows in job `6ad02dab42f08abb13473886` recovers `CH` for `4193227395`.
- Optional CSV columns: `LNG Etsy Status`, `LNG Payment Status`, `LNG Ship By`, `LNG Shipping Service`, `LNG Order Discount`, `LNG Shipping Discount`, `LNG Order Total`. Legacy files remain accepted; absent lifecycle fields do not clear existing values. Paid date alone is not payment-state evidence.
- Collector retains explicit `is_fully_paid`, shipping method and source status instead of defaulting unknown status to New. Ship-by transport accepts explicit `fulfillment.ship_by_date` / `expected_ship_date` and validates ISO/Unix values. These deadline keys still require a fresh live Etsy payload check; the old five CSV rows contain neither field. No handling-time estimate or actual-shipped timestamp is used as a deadline.
- Etsy source status stays separate from internal production status. This change does not automatically cancel, fulfill or release production, nor enable automatic imports.
- Order-level source money is kept in `Order.externalData.etsy.financial` (integer minor units), not distributed into item discounts. No shared revenue formula is changed: the meaning of transaction cost before/after discount and quantity >1 must be reconciled against live Etsy before applying deductions. Source totals/discounts absent from the collector remain null, not fabricated zeros.
- Customization parser keeps unknown variation options, recognizes `Enter Your Custom`, and removes exact/all-fields personalization duplicates while retaining multiline customer text. Read-only replay of all five old rows yields one text entry per item and retains size/color/background/print options. No DB records were rewritten.
- Verification: extension full suite 59/59; targeted BE mapper/customization/import/payload tests 56/56; architecture 22/22; syntax and scoped diff checks pass.
- Full BE test attempt was stopped after MongoMemoryServer setup failures: `teamMembership.migration.test.js`, `staffProvisioning.persistence.test.js`, `orderProductionAudit.persistence.test.js`, `leave.lifecycle.test.js` (driver metadata / hook timeouts). This is not a full-suite pass.
- Still pending: actual VM capture with updated extension, backend restart, safe reimport/backfill of the five orders, and Smarty credentials. No push/commit, production deployment or Smarty configuration change in this step.
