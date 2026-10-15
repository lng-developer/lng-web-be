# Etsy extension order + image test handoff

## Remote Orders from web (protocol v1)

Update BE → FE → extension before testing. Protocol: [etsy-remote-order-api.md](etsy-remote-order-api.md). The generated Postman inventory currently does not include extension-command routes.

1. Keep schedules, Ads, tracking and vendor submission disabled. This change does not run imports or restart services by itself.
2. Reload the extension in the Etsy VM, enter the session token for the correct shop/backend, and confirm the Etsy account in that browser matches. Finish or explicitly clear any manual preview first; remote work will not overwrite it.
3. In Integrations → Extensions → Automation, choose the online Etsy VM. Request Orders with maximum **1**. This queues a WEB task and automatically imports; do not click manual Confirm Import in the VM.
4. Inspect command status and requested count. Open its import-job link; compare order ID, customization, listing image and attached files. SUCCEEDED means import/manifest complete, not ready for production. Zero orders is a valid success with no job.
5. For lost HTTP responses, the extension resumes the same CSV/key/job. Completion acknowledgement retries do not collect again. Online heartbeat is not task ownership; the task lease is renewed separately every minute.
6. If Chrome closes or the lease/session is lost, do not erase storage or submit another import blindly. The extension preserves its remote checkpoint and stops automatic claiming until that interrupted work is reconciled. Re-entering a token is not permission to restart an expired task. A dedicated operator recovery/reset UI is not part of this change.

No live VM/Etsy/backend import was executed as automated verification. Test one order explicitly before increasing the count (1–200; not a date or New-only filter).

Implementation branches: BE `codex/etsy-extension-provider`; extension `codex/etsy-lng-web-be`. No develop merge or deployment is part of this change.

See the extension's `docs/etsy-manual-import.md` for the operator flow and acceptance checks.

## Contracts

- `GET /api/auth/me` with an Extension Token: existing authentication validates expiry/revocation/environment, then returns `{tokenType:'EXTENSION',shop:{id,name}}` for the token's single active shop. No client Shop ID is accepted. The existing JWT account response is unchanged. Restart local BE after this update before configuring the extension.

- `POST /api/integration/external-order-imports/etsy-sold-order-items`: existing multipart CSV; `Idempotency-Key` identifies an immutable capture. Optional CSV columns `LNG Expected Files` (0–20) and `LNG Needs Review` preserve image expectations before mapping. Selected shop must match the Extension Token scope. Reusing a key with different input returns 409.
- `GET /api/integration/external-order-imports/:jobId/progress`: existing authorized progress. Order-import status and downstream mapping progress are distinct; image attachment can proceed once order import is terminal.
- `POST /api/integration/external-order-imports/:jobId/etsy-assets`: multipart `file`, `sha256`. ORDERS:WRITE on the job's shop; Etsy job required. Media recomputes the hash, checks size/type/signature and owns persistence. Returns `{mediaAssetId,filename,contentType,sha256,reused}`.
- `POST /api/integration/external-order-imports/:jobId/etsy-customization-manifest`: `{entries:[{externalOrderId,externalItemId,assets:[{mediaAssetId}]}]}`. Max 100 entries/request, 20 assets/item. Server resolves a successful raw record, checks every asset belongs to the same job/shop, merges customization and queues mapping. Per-entry statuses: `accepted`, `needsReview`, `retry`, `failed`.

No Etsy URL, cookie, bearer or binary data is accepted in the manifest. Media metadata is resolved server-side, not trusted from the client. APIs return shaped results, not Mongo documents.

## Before staging

- Use an isolated test DB and non-submitting worker configuration. Do not run seeds or migrations against production for this test.
- Install indexes using the team's reviewed deployment process. New Media index: `{shopId:1,ownerType:1,ownerId:1,sha256:1}`, unique with partial filter `{ownerType:'ETSY_IMPORT',uploadStatus:'READY',discardedAt:null}`. Confirm existing import job `{shopId:1,source:1,idempotencyKey:1}` unique partial index. No live index operation was executed by this implementation.
- Pre-existing provider jobs have no `requestHash`. Replaying their old key is rejected as unverifiable rather than accepting potentially changed data. Resume their known job directly or create a new explicit capture; do not reuse an old key with new contents.
- Original browser files are restricted to PNG/JPEG/WebP <=10 MiB. Server validates signatures; this is not antivirus scanning or a full image-decoder validation.

## Verification boundaries

Local verification on 2026-10-14:

- Extension: 43/43 tests passed, including the paired BE CSV round-trip.
- Final focused BE run: 65 suites, 477/477 tests passed (Catalog, Customization, external import, Etsy contract, Media, architecture and API docs).
- Broad BE run before the final missing-header regression: 349 suites passed, 2 skipped; 2,837 tests passed and 13 skipped. Another 26 suites failed to load due to missing `mongodb-memory-server` / `supertest`; this is NOT an all-suite pass. Used cached `npx --no-install jest` because the local Jest executable is also unavailable.
- Changed JavaScript syntax, extension manifest JSON and both repository diff whitespace checks passed.
- Changes remain uncommitted locally; no push, merge, database/index mutation or deployment performed.

Automated tests cover collector/CSV/BE round-trip, Etsy identity selection, image expectation parser, job polling, interrupted upload responses, saved-image resume, bounded retries, forbidden job/assets, content hash mismatch and queue rejection. They do not establish real Mongo concurrency or a live Etsy session.

Runtime gates remaining: live image download/CORS, original resolution, extension-worker termination, Mongo index installation/concurrent retries, and staging pipeline readback. Do not describe those as passed based on unit tests.

# Cancellation and refund status

- Pull a fresh capture after reloading the updated extension; an existing preview/CSV does not gain new status fields.
- Confirm Etsy order `4193749613` still shows Canceled / Fully refunded before using it as a test case. Expected imported source values: `CANCELLED` / `REFUNDED`, even when Etsy also reports `is_fully_paid: true`.
- Fully cancelled orders with no production task/vendor submission use the existing item cancellation workflow and IMPORT timeline. Importing them again must not reopen items or enqueue customization/address validation/mapping.
- Partial/pending cancellation and refund without full cancellation require manual review. Existing production/vendor work also requires review; source status is saved but internal production state is not silently cancelled.
- Production creation, vendor handoff, submit and retry check persisted marketplace state. A request already accepted by a vendor cannot be undone by importing cancellation; reconcile with the vendor manually.
- Test with one order first. Implementation/tests do not authorize modifying existing orders or submitting to a live vendor.
