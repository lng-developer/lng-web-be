# Media Access Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop exposing provider URLs through media HTTP responses and enforce shop access for newly owned assets while preserving legacy and vendor compatibility.

**Architecture:** Keep storage records and the media public port unchanged for internal consumers. Add optional ownership to `MediaAsset`, introduce HTTP-only authorized service methods, and serialize a backend `downloadUrl` instead of `secureUrl`. Only server-authorized domain flows may set ownership.

**Tech Stack:** Node.js, Express, CommonJS, Mongoose, Jest

## Global Constraints

- Legacy assets without `shopId` remain readable with `MEDIA:READ`.
- HTTP responses never expose `secureUrl`, provider identifiers, or storage paths.
- Vendor adapters retain internal access to `secureUrl` during this phase.
- Do not add Wasabi, presigned URLs, migrations, cleanup jobs, dependencies, or indexes.
- Cross-module calls continue through `public.js`.
- Do not commit, merge, or push unless explicitly requested.

---

### Task 1: Public media response contract

**Files:**
- Modify: `src/modules/media/dtos/mediaAsset.dto.js`
- Test: `src/test/media/routes/index.test.js`

**Interfaces:**
- Consumes: media records containing `_id` and optional internal `secureUrl`.
- Produces: `toMediaAssetDto(asset)` with `downloadUrl: /api/media/assets/{id}/download` and no `secureUrl`.

- [ ] **Step 1: Write failing route assertions**

For upload and metadata responses, use a mocked record with non-null `secureUrl` and assert:

```js
expect(response.body.data.downloadUrl)
  .toBe('/api/media/assets/660000000000000000000902/download');
expect(response.body.data).not.toHaveProperty('secureUrl');
```

- [ ] **Step 2: Verify RED**

Run `npx jest src/test/media/routes/index.test.js --runInBand`.
Expected: FAIL because `downloadUrl` is absent and/or `secureUrl` is present.

- [ ] **Step 3: Implement the minimal DTO change**

```js
const id = toId(asset);
return {
  id,
  // existing safe metadata stays unchanged
  downloadUrl: id ? `/api/media/assets/${id}/download` : null,
  createdAt: asset.createdAt,
};
```

Remove only `secureUrl` from the HTTP DTO.

- [ ] **Step 4: Verify GREEN**

Run the focused route test and expect PASS.

---

### Task 2: Optional ownership persistence

**Files:**
- Modify: `src/modules/media/models/mediaAsset.model.js`
- Modify: `src/modules/media/services/mediaAsset.service.js`
- Modify: `src/modules/media/public.js`
- Test: `src/test/media/services/mediaAsset.service.test.js`

**Interfaces:**
- Consumes: `storeAsset({ ..., shopId, ownerType, ownerId })` and `storeUploadedFile(file, metadata, ownership)`.
- Produces: records with optional top-level ownership fields.

- [ ] **Step 1: Write failing persistence tests**

Assert Cloudinary and local `repository.create` payloads include:

```js
expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
  shopId: '660000000000000000000111',
  ownerType: 'PRODUCTION_TASK',
  ownerId: '660000000000000000000222',
}));
```

Prove multipart/request fields are not read; only the explicit trusted ownership argument is forwarded.

- [ ] **Step 2: Verify RED**

Run `npx jest src/test/media/services/mediaAsset.service.test.js src/test/media/routes/index.test.js --runInBand`.
Expected: FAIL because ownership is not persisted.

- [ ] **Step 3: Add optional schema fields**

```js
shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', default: null },
ownerType: { type: String, trim: true, uppercase: true, default: null },
ownerId: { type: mongoose.Schema.Types.ObjectId, default: null },
```

- [ ] **Step 4: Forward trusted ownership**

Extend `storeAsset` and both repository payloads. Extend the public helper:

```js
async function storeUploadedFile(file, metadata = {}, ownership = {}) {
  return mediaAssetService.storeAsset({
    // existing validated file fields
    shopId: ownership.shopId || null,
    ownerType: ownership.ownerType || null,
    ownerId: ownership.ownerId || null,
  });
}
```

- [ ] **Step 5: Verify GREEN and syntax**

Run focused tests and `node -c` for the three changed production files.

---

### Task 3: HTTP shop-scope authorization

**Files:**
- Modify: `src/modules/media/services/mediaAsset.service.js`
- Modify: `src/modules/media/controllers/mediaAsset.controller.js`
- Test: `src/test/media/services/mediaAsset.service.test.js`
- Test: `src/test/media/routes/index.test.js`

**Interfaces:**
- Produces: `getAuthorizedAsset(assetId, authContext)` and `withAuthorizedAssetLocalReadFile(assetId, authContext, callback)`.
- Uses: `authPublic.canAccessScope(authContext, 'MEDIA:READ', { scopeType: 'SHOP', scopeId })`.

- [ ] **Step 1: Write failing authorization tests**

Cover matching shop access, denied cross-shop access returning `403 AUTHORIZATION_ERROR`, and legacy assets without `shopId` remaining readable.

- [ ] **Step 2: Verify RED**

Run focused media tests. Expected: FAIL because authorized methods do not exist.

- [ ] **Step 3: Implement one shared guard**

```js
function assertAssetReadAccess(asset, authContext = {}) {
  if (!asset.shopId) return;
  const allowed = authPublic.canAccessScope(
    authContext,
    'MEDIA:READ',
    { scopeType: 'SHOP', scopeId: asset.shopId },
  );
  if (!allowed) {
    throw new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
  }
}
```

Reuse it in both HTTP-facing service methods. Keep existing internal methods unchanged.

- [ ] **Step 4: Wire controllers**

```js
service.getAuthorizedAsset(req.params.assetId, req.auth)
service.withAuthorizedAssetLocalReadFile(req.params.assetId, req.auth, callback)
```

- [ ] **Step 5: Verify GREEN**

Run focused tests and syntax checks.

---

### Task 4: Production-owned uploads

**Files:**
- Modify: `src/modules/production/services/productionTask.service.js`
- Test: `src/test/production/services/productionTask.service.test.js`

**Interfaces:**
- Consumes: already-authorized production task containing `_id` and `shopId`.
- Produces: trusted ownership in the existing `mediaPublic.storeAsset` call.

- [ ] **Step 1: Write a failing ownership test**

```js
expect(mediaPublic.storeAsset).toHaveBeenCalledWith(expect.objectContaining({
  shopId,
  ownerType: 'PRODUCTION_TASK',
  ownerId: taskId,
}));
```

- [ ] **Step 2: Verify RED**

Run the relevant production test by name. Expected: FAIL because ownership is absent.

- [ ] **Step 3: Pass ownership from the loaded task**

```js
shopId: task.shopId,
ownerType: 'PRODUCTION_TASK',
ownerId: task._id || task.id,
```

Do not accept these values from request payloads.

- [ ] **Step 4: Verify GREEN**

Run the focused production service suite and syntax check.

---

### Task 5: Compatibility and architecture verification

**Files:**
- Test only unless verification exposes a regression requiring the smallest root-cause fix.

- [ ] **Step 1: Run focused suites**

```powershell
npx jest src/test/media src/test/production/services/productionTask.service.test.js --runInBand
```

- [ ] **Step 2: Run architecture checks**

```powershell
npm run test:architecture -- --runInBand
```

- [ ] **Step 3: Run broad verification**

```powershell
npm test -- --runInBand
```

Report a timeout separately; never call a timed-out suite passing.

- [ ] **Step 4: Inspect final scope**

```powershell
git diff --check
git diff -- src/modules/media src/modules/production/services/productionTask.service.js src/test/media src/test/production/services/productionTask.service.test.js
```

Confirm no secret, migration, dependency, index, Wasabi code, commit, or unrelated cleanup entered the diff.

