# Phase 2.1 — Mockup-to-listing seller workspace

Status: scope approved; storage revised to Cloudinary following the user's explicit decision. No implementation or live AI calls in this change.

## 1. Outcome and boundaries

Deliver backend support and a real seller UI for one mockup → visual analysis → seller confirmation → Phase 2 content generation → edit and approve. Amazon US apparel only. A launch remains a candidate, not a Catalog Listing.

Included: a launch list and detail workspace, P1 create/select-product forms, scoped mockup upload/preview, asynchronous analysis, editable observations, confirmed garment facts/colors, and all P2 generation/revision/approval interactions. Existing keyword-only launches continue working.

Excluded: batch uploads, multiple current mockups, image generation, artwork editing, PNG production processing, auto-scale, CSV/flat-file export, Extension, marketplace publishing, Gemini, trademark clearance, pricing/quota subsystems. No Catalog Listing/ListingVariant/DesignTask writes. No production data mutations, deployment or paid calls as part of automated verification.

## 2. Verified starting point

- Backend: `EC/listing-launch-phase-2`, HEAD `d37d8e2e`; P1/P2 implemented. Follow `docs/listingLaunch/PHASE_1_API.md` and `PHASE_2_API.md`.
- Frontend: `C:/lng_system/lng-web/lng-web-fe`, currently `develop`; no ListingLaunch UI. Both repos have unrelated untracked `.codex/`, which must be preserved. Create a frontend feature branch before edits; no develop commits.
- Media public port already supplies `storeAsset`, `getAsset`, and bounded storage primitives. Generic `/api/media/assets` uploads do not assign launch/shop ownership and cannot simply be reused as the seller authorization contract.
- Media reads map owner types to scoped permissions; add `LISTING_LAUNCH` support for scoped CATALOG read/write without broadening unrelated assets.
- Frontend has shared API, authenticated media preview, MUI/Tailwind, TanStack Query and vi/en i18n. Follow actual `src/shared` and feature paths rather than stale example paths in CONVENTIONS. Backend contract source is this checkout; the FE AGENTS path under `C:/Users/stack/Task` does not match this machine.
- Required FE `taste-skill` is unavailable (only a disabled file was found). Do not enable it implicitly; use the existing UI system and repository conventions as fallback.

## 3. Chosen approach

Use a dedicated ListingLaunch workspace, not the canonical Catalog Listing editor. Keep analysis as a separate durable run type inside `listingLaunch`, reusing the existing BullMQ connection/lifecycle patterns and provider transport where genuinely shared. Do not introduce a generic workflow engine or make P2 content runs accept unrelated result shapes.

Alternatives considered: synchronous analysis is smaller but loses durable status/recovery during browser disconnects; a multi-image/batch assistant expands scope and cost before one-image quality is measured. Neither is selected.

## 4. Seller experience

Two focused routes under the Catalog workspace: launch list and launch detail. The list supports the existing shop/state filters, pagination and resume action; it does not mix candidates with canonical Listings.

Detail has a four-step progression:

1. **Draft:** seller selects an accessible shop, enters a brief/title, creates the launch, then selects an active group/template. P1 selection remains one-time; after selection show it read-only, with “create another draft” rather than pretending it is editable.
2. **Mockup:** upload one image, preview it, replace it if necessary, then explicitly click Analyze. Uploading alone never calls AI. Explain that analysis sends this image to the configured AI provider and may incur cost.
3. **Confirm:** image beside editable detected text, theme, design description and proposed keyword; read-only warnings highlight unreadable/uncertain details. Garment brand, material, features and available colors are separate seller-entered fields. Confirm and save explicitly; no inferred material or stock facts.
4. **Content:** explicitly Generate, show progress/errors, select immutable versions, edit into a new version, select colors and Approve. AI suggests 1–3 colors; seller approval allows 1–30 valid available colors, preserving P2.

Desktop uses image/form columns inside the existing app shell; narrow viewports stack them. Use existing tokens/components, keyboard-accessible upload, labeled inputs, inline errors, feedback helpers and matching vi/en translations. Render all model/user output as plain text. Show a saved timestamp and unsaved-change warning; do not silently overwrite local edits after polling/refetch.

Poll every 2 seconds only for visible active run views, stop at terminal status/unmount, and refresh on return. Refreshing the browser restores saved draft, current image and run status. Retain request keys for retries of the same intent; a deliberate new AI attempt gets a new key. A 409 reloads authoritative state without discarding local edits without warning.

## 5. Upload and media ownership

Add a launch-scoped multipart upload endpoint. Authenticate and check CATALOG:WRITE on the exact active shop/launch before accepting file bytes. Only PRODUCT_SELECTED launches can upload in this release. Reject arbitrary asset IDs, filesystem paths, external URLs and client-provided ownership.

Pilot limits: exactly one file, PNG/JPEG/WebP, at most 10 MiB, decoded image at most 40 million pixels; reject animation/multiple frames, unsupported types, corrupt or undecodable images. Check extension, declared MIME and actual decoded format. These are internal app limits, not provider guarantees.

No installed image decoder was found in backend package.json. Add one narrowly scoped backend dependency (`sharp`) for safe decode, orientation and re-encoding; do not hand-write image parsers. Normalize to a JPEG preview with white background, maximum 2048-pixel longest edge, no enlargement, quality 90 and stripped metadata. Keep the normalized asset at most 10 MiB. The UI explains that this is an analysis preview, not a retained original print file; the same preview is shown to the seller and sent to AI.

Cloudinary is the durable storage for this feature, as explicitly selected by the user. Store through `media.public.storeAsset` with server-assigned `shopId`, `ownerType=LISTING_LAUNCH`, `ownerId=launchId`, uploadedBy and source metadata. Extend this public port narrowly to request Cloudinary authenticated delivery for new mockups. Do not change global storage configuration or defaults for existing upload consumers. Missing Cloudinary configuration or upload failure returns a safe storage-unavailable error; never silently fall back to durable local storage.

Upload new mockups with Cloudinary delivery type `authenticated`. Persist that delivery type in MediaAsset; missing values on legacy Cloudinary records mean the existing `upload` behavior. Use the persisted type consistently for signed server-side reads and deletion. Keep existing assets and URLs unchanged; no migration or conversion of old media. Shared public URL helpers must return no public URL for authenticated assets.

Preview/download goes through the existing backend media route after scoped authorization, without redirecting or returning the Cloudinary signed URL to the browser. Server-side signed reads use persisted provider identifiers and the configured Cloudinary account, never a client-supplied URL; bound network time, bytes and redirects. Set private/no-store response caching for protected mockup reads. A signed URL is a bearer link, not a shop permission check or inherently expiring credential; keep it out of DTOs and logs. Worker reads through the same Media storage boundary, then sends bounded image bytes to AI. No shared disk between API and worker is required.

Local disk is only bounded temporary scratch for validation/normalization and protected reads, not the image archive. Clean temporary files in finally paths and document cleanup of abandoned scratch after a process crash. Durable original uploads are not retained locally. Cloudinary storage and delivery usage still grows with retained images; operator usage monitoring and a later retention policy remain necessary.

Temporary uploads are cleaned on success, validation failure, authorization exit after parsing and aborted requests. Save media first, then compare-and-swap the launch pointer. On a definite pointer conflict, retain the old pointer and discard only the new unattached upload through Media with expected metadata. After an ambiguous database failure, read back before cleanup; if attachment cannot be disproved, retain the asset and log a safe orphan-cleanup warning instead of risking deletion of an attached image. No automatic deletion of previously attached images: historical runs can still refer to them. Storage retention/garbage collection is outside this release and must be disclosed.

Media DTOs for this flow expose safe ID, dimensions, size and authenticated preview/download route only, not storage paths/credentials/provider URLs. Analysis accepts only READY, non-discarded media belonging to this exact launch and shop. A guessed image or run ID never crosses shop boundaries.

## 6. State and data contract

Extend Launch with `mockupAssetId` (nullable), `mockupRevision` (integer, absent means 0), and `latestMockupAnalysisRunId` (nullable). Keep `referenceAssetIds` semantics unchanged; those legacy references do not grant image access or become analysis inputs.

Each successful upload/replacement increments mockupRevision and contentInputVersion, clears approvedContent and the current analysis pointer, and invalidates any confirmed visual context. Do not erase product facts or content history. Compare both expected revisions during upload to prevent concurrent edits overwriting each other.

New `ListingMockupAnalysisRun` stores immutable launch/shop/requestKey/requestHash, asset ID/hash/revision, provider/model/prompt version, requester, status, lease timestamps, safe errors/usage and immutable validated result on success. Status is QUEUED → RUNNING → SUCCEEDED or FAILED, matching P2 terminology. Result fields:

- `detectedText`: string, 0–2000 Unicode code points; empty when no legible text.
- `theme`: string, 0–300 code points.
- `designDescription`: string, 0–2000 code points.
- `suggestedKeyword`: string, 0–200 code points.
- `warnings`: 0–10 enum entries: UNREADABLE_TEXT, LOW_DETAIL, AMBIGUOUS_DESIGN, NO_CLEAR_DESIGN.

All fields are required in structured output; unknown properties and excess lengths fail validation. Empty observations are allowed so the model need not invent facts. Seller must supply non-empty confirmed description and keyword before generation. Do not present a numeric confidence as calibrated accuracy.

Use unique (launchId,requestKey), partial unique active-run-per-launch, and bounded recovery/list indexes. Same key plus same command replays before readiness/freshness checks, but only after authorization; same key with different command returns 409. New key while an analysis is active returns 409. Never store image base64, raw provider responses or secret credentials in Mongo/logs.

Extend contentInputs with an optional `designContext`: sourceAnalysisRunId, assetId, assetHash, mockupRevision, seller-corrected detectedText/theme/designDescription and server-owned confirmedBy/confirmedAt. No designContext means legacy text-only behavior when no mockup is attached.

Extend the existing PUT content-inputs request with optional visual confirmation fields. For a launch with a mockup, require a SUCCEEDED run matching the current image/revision, `mockupConfirmed=true`, corrected observations, factsConfirmed=true and expectedInputVersion. Validate the complete input and write confirmation plus product facts atomically. The server derives asset/hash/revision and confirmation identity; clients cannot assign provenance. Existing text-only requests remain valid for launches without mockups.

Generation requires usable confirmed designContext whenever a mockup is attached. Include the confirmed context in the immutable content snapshot/hash and text prompt; never send an unconfirmed analysis directly to content generation. Preserve old hashes by omitting the new snapshot property entirely for legacy inputs, not inserting a null property. Historical runs/manual revisions remain readable and valid under their original snapshots. Bump the prompt version for new generation requests; keep historical metadata immutable.

Re-analysis alone does not clear an already valid confirmation/approval; accepting different observations does. Replacement immediately invalidates them. An old analysis may finish into its own historical run, but cannot change the current pointer/confirmation; its DTO reports isStale. Confirmation and content completion/approval races use repository transactions/CAS and existing P2 stale checks.

## 7. HTTP additions

All routes are below `/api/listing-launches/:id`, use standard DTO/error envelopes, route authentication and service-level exact-shop authorization.

| Endpoint | Contract |
| --- | --- |
| POST `/mockup` | multipart file + expectedMockupRevision + expectedInputVersion; 201 updated safe detail; 409 stale revision; 413 too large; 400 invalid image |
| POST `/mockup-analyses` | JSON requestKey UUID + expectedMockupRevision; 202 newly queued, 200 replay; safe dispatch warning if accepted but Redis unavailable |
| GET `/mockup-analyses/:runId` | 200 safe run/result/isStale; foreign-launch child 404 |
| PUT `/content-inputs` | existing endpoint extended with optional mockup confirmation contract; 200 updated detail; 409 if source is stale/not usable |

Existing GET launch detail adds safe mockup metadata, latest analysis summary and confirmation usability. Keep list responses compact; do not include full analysis/results/snapshots. Media's existing authenticated preview endpoint handles LISTING_LAUNCH owners. No generic media permission is required in addition to the authorized Catalog action.

## 8. Provider and worker behavior

Use OpenAI Responses image input with the normalized image as a base64 data URL, detail=high, `store:false`, strict structured JSON output, no tools and no user-supplied URL fetching. Read bytes from Cloudinary through Media with byte bounds and verify against the saved asset hash. Cloudinary upload/read must preserve the normalized bytes (no additional provider transformations); hash mismatch fails before any paid AI call. Treat image text and all seller data as untrusted observations, never executable instructions. Ask only for visible design observations, not garment claims, personal identification or legal clearance.

Reuse native-fetch timeout/error handling from P2; extracting a small shared transport inside listingLaunch is acceptable now that there are two consumers. Do not build a provider framework. New runtime config: LISTING_MOCKUP_ANALYSIS_ENABLED (default false), LISTING_MOCKUP_ANALYSIS_MODEL (required when enabled); reuse server OPENAI_API_KEY. No key/model controls in seller UI. Configured model must support both image input and strict output; pilot verifies account access.

Use a separate analysis queue with `{runId}`, jobId=runId, attempts=1, concurrency=1 for pilot. Match P2 lockDuration=120000, stalledInterval=60000 and independent fixed Mongo lease=120000. Bound image retrieval to 15 seconds and the entire provider call including body read to 90 seconds. Recovery every 30 seconds handles at most 100 queued and 100 expired runs. Redis outage after reservation leaves QUEUED work recoverable. Expired RUNNING becomes FAILED/WORKER_INTERRUPTED; never automatically repeat an uncertain paid call. Share lifecycle helpers only where needed and retain bounded shutdown/intake fencing.

Bound upload and analysis submissions to 10 per minute per authenticated account on each endpoint using the existing rate-limit pattern. Document an in-process limiter as pilot-only protection, not a distributed spending cap. Provider project budget controls remain an operator prerequisite. Existing P2 content generation behavior is unchanged.

## 9. Verification and acceptance

Backend automated tests use real ephemeral Mongo replica-set transactions and mocked provider/storage transport as appropriate; transaction suites use jest.setTimeout(30000), startup/teardown hooks 60000 and runInBand. Test valid image bytes and corrupt/oversize/animated/mismatched-type images; scoped upload/preview/read rejection; CAS upload conflicts and unattached cleanup; idempotency/recovery/expired leases; injection-shaped image text; safe provider failures; confirmation/replacement races; old analysis completion; legacy snapshot hash stability; P2 regression; zero canonical Catalog/Design writes.

Cloudinary contract tests assert authenticated upload, persisted delivery type, matching signed read/delete type, safe preview headers, no signed URL disclosure, byte/hash verification and unchanged legacy upload behavior. Test timeout/oversize/storage failure cleanup and no local durable fallback. A separately authorized Cloudinary smoke test must confirm unsigned access to a new mockup is rejected and authorized backend preview/worker reads succeed; mocked SDK tests alone do not establish account-level protection. Do not change Cloudinary account settings or upload live test assets without that authorization.

Frontend tests cover draft creation, one-time selection, upload progress/errors, analysis polling, edited confirmation, disabled premature generation, version editing/approval, stale image handling, refresh/resume, wrong-scope actions, translated copy and preserving dirty forms. Use src/test with typed adapters/shared query infrastructure. Run lint, typecheck/build and focused tests before broader gates.

Browser verification is required against the actual local application at desktop and narrow widths. First use controlled local fixtures and mocked AI; report clearly that this does not prove live vision. Never seed/mutate production or call a paid provider just to make browser tests pass. Pilot with a separately authorized test account/shop and configured model/key, then measure text accuracy, seller corrections, latency, usage and failures on representative mockups. No promise of SEO ranking, factual truth or Amazon acceptance.

Completion means backend/UI paths implemented, tests and local browser flow verified, and setup instructions delivered. Live AI/Redis pilot and deployment remain separately reported gates, not implied by passing unit tests.

## 10. Sources and implementation handoff

Source inspection: `src/modules/media/public.js`, `services/mediaAsset.service.js`, `controllers/mediaAsset.controller.js`; `src/modules/listingLaunch/models`, `services`, `routes`, `prompts`; FE `AGENTS.md`, `CONVENTIONS.md`, `src/shared/media` and Catalog pages. Current Media uploader and read permissions require the targeted changes above.

Official API reference checked 2026-09-15: [OpenAI Images and vision](https://developers.openai.com/api/docs/guides/images-vision). Supports Responses image inputs via data URLs; image interpretation can be wrong. This supports the provider integration choice, not model availability or accuracy guarantees.

Cloudinary references checked 2026-09-15: [Media access control](https://cloudinary.com/documentation/control_access_to_media) for authenticated originals/derivatives and signed-link limitations; [billing and plans](https://cloudinary.com/documentation/billing_and_plans) for storage, delivery and transformation usage. No claim about the user's current plan, quota or account configuration.

After written-spec approval, create a paired BE/FE implementation plan with explicit contract, upload/analysis, confirmation/P2 compatibility, seller workspace, and end-to-end verification tasks. Preserve current BE branch unless the user requests a new one; create a named FE feature branch before implementation. No implementation is authorized by this document alone; follow the approved plan workflow.
