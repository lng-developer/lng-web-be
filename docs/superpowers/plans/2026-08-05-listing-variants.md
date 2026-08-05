# Listing Variants Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve per-order product type, template, and PSD configuration through a ListingVariant instead of mutating one Listing configuration between orders.

**Architecture:** Catalog owns ListingVariant and exposes CRUD, resolution, and PSD readiness ports. Mapping resolves product type first, then asks Catalog for the matching configuration. Design tasks and Production consume the resolved `listingVariantId`; legacy Listing fields and listing-scoped PSD tasks remain readable only while a Listing has no variants.

**Tech Stack:** Node.js, Express, Mongoose, Joi, Jest, React, TypeScript, Ant Design, Vitest.

## Global Constraints

- Unique `{ listingId: 1, productTypeGroupId: 1 }`.
- Never fall back to the default variant when product type is known.
- Return `LISTING_VARIANT_NOT_FOUND` when variants exist but the selected product type has no match.
- Keep legacy Listing configuration fields during this migration.
- Vendor configuration remains in Vendor; Mapping rules only resolve product type.

---

### Task 1: Catalog entity and API

- [ ] Add ListingVariant model, repository, DTO, validators, service, public port, controller, routes, and focused tests.
- [ ] Add `defaultVariantId` to Listing without removing legacy fields.
- [ ] Add idempotent backfill from each configured legacy Listing.

### Task 2: Mapping resolution

- [ ] Add a failing Mapping test for variant selection and missing-variant blocking.
- [ ] Resolve ListingVariant after SKU/customization product type resolution.
- [ ] Snapshot effective variant template and assets in FulfillmentPlan/Production inputs.

### Task 3: Catalog frontend

- [ ] Add ListingVariant API types and CRUD calls.
- [ ] Add a variant manager inside Listing details with create/edit/default actions.
- [ ] Add focused API and UI tests.

### Task 4: Verification

- [ ] Add Catalog variant PSD readiness and asset update/upload contracts with focused tests.
- [ ] Add `listingVariantId` to DesignTask, candidate creation, uniqueness, approval, and DTOs while retaining listing-scoped legacy tasks.
- [ ] Make Production load the selected variant from FulfillmentPlan instead of reloading legacy Listing configuration.
- [ ] Replace raw asset ID inputs with variant readiness, Request PSD, and file upload actions.

### Task 5: Verification

- [ ] Run focused Catalog/Mapping and FE Catalog tests.
- [ ] Run architecture, full BE tests, FE lint/unit/UI/build, and diff checks.
