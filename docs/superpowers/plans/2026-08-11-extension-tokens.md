# Extension Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add shop-scoped, environment-bound extension tokens and an Access Control UI to issue, copy once, list, and revoke them.

**Architecture:** Auth owns the hashed credential record, lookup, and management API. Authentication turns a valid token into an `ORDERS:WRITE` Shop scope; the Access Control UI never receives a raw credential except the create response.

**Tech Stack:** Node.js, Express, Mongoose, Jest; React, TypeScript, Ant Design, TanStack Query, Vitest.

## Global Constraints

- Preserve JWT login/session behavior.
- Store only SHA-256 hashes and never return a raw token after creation.
- Environment must match the backend runtime environment.
- Tokens have one Shop scope, `ORDERS:WRITE`, optional expiry, and independent revocation.
- Do not modify unrelated dirty worktrees.

---

### Task 1: Token Persistence and Authentication

**Files:**
- Create: `src/modules/auth/models/extensionToken.model.js`
- Create: `src/modules/auth/repositories/extensionToken.repository.js`
- Create: `src/modules/auth/services/extensionToken.service.js`
- Modify: `src/modules/auth/middlewares/authenticate.js`
- Test: `tests/auth/services/extensionToken.service.test.js`
- Test: `tests/auth/middlewares/authenticate.test.js`

- [ ] **Step 1: Write failing tests for one-time raw token output and restricted authentication**

```js
test('returns raw token only from create and persists only tokenHash', async () => {
  const result = await service.create({ name: 'Dev PC', shopId, environment: 'development', createdByAccountId });
  expect(result.token).toMatch(/^lng_ext_/);
  expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ tokenHash: expect.any(String) }));
});

test('returns only a Shop-scoped ORDERS:WRITE context for a valid token', async () => {
  expect((await service.authenticate('lng_ext_test')).scopes[0].permissions).toEqual(['ORDERS:WRITE']);
});
```

- [ ] **Step 2: Run red tests**

Run: `npm test -- tests/auth/services/extensionToken.service.test.js tests/auth/middlewares/authenticate.test.js --runInBand`

- [ ] **Step 3: Implement model, repository, service, and middleware fallback after the tests fail for missing behavior**
- [ ] **Step 4: Run the same tests green**

### Task 2: Management API

**Files:**
- Create: `src/modules/auth/controllers/extensionToken.controller.js`
- Modify: `src/modules/auth/validators/auth.validator.js`
- Modify: `src/modules/auth/routes/index.js`
- Modify: `docs/auth/AUTH_RBAC_API.md`
- Test: `tests/auth/routes/index.test.js`

- [ ] **Step 1: Write failing route tests for `AUTH:WRITE`, optional future expiry, list redaction, and revoke**
- [ ] **Step 2: Run red test**

Run: `npm test -- tests/auth/routes/index.test.js --runInBand`

- [ ] **Step 3: Add `POST`, `GET`, and `DELETE /api/auth/extension-tokens` with strict validation**

```js
router.post('/extension-tokens', authenticate, requireAuthWrite, asyncHandler(controller.create));
router.get('/extension-tokens', authenticate, requireAuthWrite, asyncHandler(controller.list));
router.delete('/extension-tokens/:tokenId', authenticate, requireAuthWrite, asyncHandler(controller.revoke));
```

- [ ] **Step 4: Run route test green and document the one-time token response**

### Task 3: Access Control UI

**Files:**
- Create: `src/features/auth/extension-tokens/api/extensionTokensApi.ts`
- Modify: `src/features/auth/access-control/pages/AccessControlPage.tsx`
- Modify: `src/features/auth/access-control/pages/AccessControlPage.module.scss`
- Test: `src/test/auth/access-control/AccessControlPage.test.tsx`

- [ ] **Step 1: Write failing UI tests for the tokens tab, create modal, copy-once modal, and revoke action**
- [ ] **Step 2: Run red test**

Run: `npm test -- src/test/auth/access-control/AccessControlPage.test.tsx`

- [ ] **Step 3: Add the API client and `Extension Tokens` tab**

```tsx
<Table rowKey="id" dataSource={tokens} columns={tokenColumns} />
<Modal open={Boolean(createdToken)} onCancel={() => setCreatedToken(undefined)} />
```

- [ ] **Step 4: Run UI test green**

### Task 4: Verification and Commits

**Files:**
- Modify only files from Tasks 1-3 and Auth API documentation.

- [ ] **Step 1: Run backend verification**

Run: `npm run test:auth -- --runInBand && npm run test:architecture -- --runInBand`

- [ ] **Step 2: Run frontend verification**

Run: `npm test && npm run lint && npm run build`

- [ ] **Step 3: Inspect `git diff --check`, then make focused commits in each worktree**
