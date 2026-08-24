# Extension Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver shop-scoped management of extension agents, redacted extension tokens, heartbeat status, token revocation, and per-agent order-import commands.

**Architecture:** The backend exposes a read model from `integration/extensionCommand` that joins agents to redacted Auth token metadata through Auth's public port. Existing command and token endpoints remain the mutation boundary, with scope authorization enforced before token read/revoke. The frontend adds an extension-management panel using the existing TanStack Query integration API and Ant Design table/modal components.

**Tech Stack:** Node.js, Express, Mongoose, Joi, Jest; React, TypeScript, TanStack Query, Ant Design, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-22-extension-management-design.md`

## Global Constraints

- Never return raw extension tokens or `tokenHash` outside the existing one-time create response.
- Filter every management read and mutation through scoped RBAC for the owning shop.
- Use module public ports for cross-module calls; no cross-module model/repository imports.
- `ONLINE` means `lastSeenAt` is within 90 seconds; offline agents remain visible.
- Queue `IMPORT_NEW_ORDERS` for one online agent only; do not add a broadcast action.
- Do not create commits unless explicitly requested by the user.

---

### Task 1: Auth token metadata and shop-scoped revocation

**Files:**
- Modify: `src/modules/auth/repositories/extensionToken.repository.js`
- Modify: `src/modules/auth/services/extensionToken.service.js`
- Modify: `src/modules/auth/controllers/extensionToken.controller.js`
- Modify: `src/modules/auth/public.js`
- Test: `tests/auth/services/extensionToken.service.test.js`
- Test: `tests/auth/routes/index.test.js`

**Interfaces:**
- Consumes: Authenticated user context `{ tokenType, accountId, scopes }` and `authPublic.canAccessScope()`.
- Produces: `getExtensionTokenMetadataByIds(ids)` returning redacted DTOs keyed by token ID, plus scope-checked `list` and `revoke` operations.

- [ ] **Step 1: Write failing service tests**

```js
test('returns redacted metadata for requested extension token ids', async () => {
  repository.findByIds.mockResolvedValue([{ _id: tokenId, name: 'RDC 01', tokenHint: 'ab12', shopId, environment: 'development' }]);
  await expect(service.getMetadataByIds([tokenId])).resolves.toEqual([{ id: tokenId, name: 'RDC 01', tokenHint: 'ab12', shopId, environment: 'development' }]);
});

test('rejects revoking a token outside the caller shop scope', async () => {
  repository.findById.mockResolvedValue({ _id: tokenId, shopId: otherShopId });
  await expect(service.revoke(tokenId, authForShop(shopId))).rejects.toMatchObject({ statusCode: 403 });
});
```

- [ ] **Step 2: Run the focused tests and verify red**

Run: `npm test -- tests/auth/services/extensionToken.service.test.js --runInBand`

Expected: FAIL because metadata lookup and scope-aware revoke do not exist.

- [ ] **Step 3: Implement the smallest Auth changes**

```js
function findByIds(ids) {
  return ExtensionToken.find({ _id: { $in: ids } }).lean();
}

async function revoke(id, auth) {
  const token = await repository.findById(id);
  assertUserShopAccess(auth, token.shopId, 'ORDERS:WRITE');
  return repository.revoke(id);
}
```

Expose only redacted token metadata from `auth/public.js`; retain `tokenHash` as model-private data.

- [ ] **Step 4: Run focused Auth tests and verify green**

Run: `npm test -- tests/auth/services/extensionToken.service.test.js tests/auth/routes/index.test.js --runInBand`

Expected: PASS, with raw tokens absent from list/revoke payloads.

### Task 2: Backend extension-management read model

**Files:**
- Modify: `src/modules/integration/extensionCommand/repositories/extensionCommand.repository.js`
- Modify: `src/modules/integration/extensionCommand/services/extensionCommand.service.js`
- Modify: `src/modules/integration/extensionCommand/controllers/extensionCommand.controller.js`
- Modify: `src/modules/integration/extensionCommand/dtos/extensionCommand.dto.js`
- Modify: `src/modules/integration/extensionCommand/validators/extensionCommand.validator.js`
- Modify: `src/modules/integration/extensionCommand/routes/extensionCommand.routes.js`
- Test: `src/modules/integration/extensionCommand/__tests__/extensionCommand.service.test.js`
- Test: `src/modules/integration/extensionCommand/__tests__/extensionCommand.validator.test.js`

**Interfaces:**
- Consumes: `authPublic.getExtensionTokenMetadataByIds(ids)` and agent documents with `extensionTokenId`, `shopId`, and `lastSeenAt`.
- Produces: `GET /api/integration/extension-commands/management-agents` returning `{ items: ExtensionManagementAgent[] }`, where each item has `status: 'ONLINE' | 'OFFLINE'` and a redacted `token` object or `null`.

- [ ] **Step 1: Write failing management-service tests**

```js
test('lists accessible agents including offline status and redacted token metadata', async () => {
  repository.listAgents.mockResolvedValue([{ _id: agentId, shopId, extensionTokenId: tokenId, lastSeenAt: new Date(Date.now() - 91_000) }]);
  authPublic.getExtensionTokenMetadataByIds.mockResolvedValue([{ id: tokenId, name: 'RDC 01', tokenHint: 'ab12', shopId }]);
  await expect(service.listManagementAgents(authForShop(shopId))).resolves.toEqual(expect.objectContaining({
    items: [expect.objectContaining({ id: agentId, status: 'OFFLINE', token: expect.objectContaining({ tokenHint: 'ab12' }) })],
  }));
});

test('does not return an agent outside the caller shop scope', async () => {
  repository.listAgents.mockResolvedValue([{ _id: agentId, shopId: otherShopId, lastSeenAt: new Date() }]);
  await expect(service.listManagementAgents(authForShop(shopId))).resolves.toEqual({ items: [] });
});
```

- [ ] **Step 2: Run focused module tests and verify red**

Run: `npm test -- src/modules/integration/extensionCommand/__tests__/extensionCommand.service.test.js --runInBand`

Expected: FAIL because `listManagementAgents` and the management route do not exist.

- [ ] **Step 3: Implement repository, service, DTO, validator, and route**

```js
const ONLINE_MS = 90 * 1000;
const statusFor = (lastSeenAt) => Date.now() - new Date(lastSeenAt).getTime() <= ONLINE_MS ? 'ONLINE' : 'OFFLINE';

async function listManagementAgents(auth) {
  const agents = await repository.listAgents({});
  const accessible = agents.filter((agent) => canReadAgent(auth, agent.shopId));
  const tokens = await authPublic.getExtensionTokenMetadataByIds(accessible.map((agent) => agent.extensionTokenId));
  return { items: accessible.map((agent) => toManagementAgentDto(agent, tokensById, statusFor(agent.lastSeenAt))) };
}
```

The controller returns DTOs only. The new route uses `authenticate` and the existing read permission middleware.

- [ ] **Step 4: Run module and architecture verification**

Run: `npm test -- src/modules/integration/extensionCommand/__tests__/extensionCommand.service.test.js src/modules/integration/extensionCommand/__tests__/extensionCommand.validator.test.js --runInBand && npm run test:architecture -- --runInBand`

Expected: PASS with no forbidden cross-module imports.

### Task 3: Frontend API and management panel

**Files:**
- Modify: `C:/lng_system/lng-web/lng-web-fe-extension-command-phase1/src/features/portal/integrations/api/integrationTypes.ts`
- Modify: `C:/lng_system/lng-web/lng-web-fe-extension-command-phase1/src/features/portal/integrations/api/integrationApi.ts`
- Modify: `C:/lng_system/lng-web/lng-web-fe-extension-command-phase1/src/features/portal/integrations/api/integrationKeys.ts`
- Modify: `C:/lng_system/lng-web/lng-web-fe-extension-command-phase1/src/features/portal/integrations/pages/IntegrationWorkbenchPage.tsx`
- Modify: `C:/lng_system/lng-web/lng-web-fe-extension-command-phase1/src/features/portal/integrations/pages/IntegrationWorkbenchPage.module.css`
- Test: `C:/lng_system/lng-web/lng-web-fe-extension-command-phase1/src/test/integrationWorkbenchPage.test.tsx`

**Interfaces:**
- Consumes: `listExtensionManagementAgents()`, existing `createExtensionCommand()`, and `DELETE /api/auth/extension-tokens/:tokenId`.
- Produces: filterable management table with online/offline tags, token metadata, per-row import, and confirmed revoke action.

- [ ] **Step 1: Write failing frontend tests**

```tsx
it('renders offline agents and disables their import action', async () => {
  mockListManagementAgents.mockResolvedValue({ items: [{ id: 'a1', label: 'RDC 01', status: 'OFFLINE', token: { tokenHint: 'ab12' } }] });
  render(<IntegrationWorkbenchPage account={account} />);
  expect(await screen.findByText('RDC 01')).toBeVisible();
  expect(screen.getByRole('button', { name: /pull new orders/i })).toBeDisabled();
});

it('confirms and revokes the selected token without rendering its raw value', async () => {
  render(<IntegrationWorkbenchPage account={account} />);
  await user.click(await screen.findByRole('button', { name: /revoke/i }));
  await user.click(screen.getByRole('button', { name: /confirm/i }));
  expect(mockRevokeExtensionToken).toHaveBeenCalledWith('token-1');
  expect(screen.queryByText('lng_ext_')).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run the new frontend test and verify red**

Run: `npm test -- src/test/integrationWorkbenchPage.test.tsx --runInBand`

Expected: FAIL because the management query, table, and revoke action do not exist.

- [ ] **Step 3: Implement minimal FE API/query/panel changes**

```ts
export async function listExtensionManagementAgents() {
  return unwrap<{ items: ExtensionManagementAgent[] }>(await apiClient.get(`${extensionCommandPath}/management-agents`));
}

export async function revokeExtensionToken(tokenId: string) {
  return unwrap<ExtensionToken>(await apiClient.delete(`/api/auth/extension-tokens/${tokenId}`));
}
```

Render agent status using Ant Design `Tag`; display token as `${token.name} · ••••${token.tokenHint}`. Use `Modal.confirm` before revoke and invalidate management-agent, online-agent, token, and command keys after success.

- [ ] **Step 4: Run frontend verification**

Run: `npm run typecheck && npm test -- src/test/integrationWorkbenchPage.test.tsx --runInBand`

Expected: PASS with offline import disabled and token value never rendered.

### Task 4: End-to-end local proof and regression checks

**Files:**
- Modify: no production files expected
- Test: existing backend and frontend tests from Tasks 1-3

**Interfaces:**
- Consumes: local BE on port 5000, FE on port 5173, and an existing extension heartbeat.
- Produces: a visible online extension row, a queueable single import command, and a revoke result that blocks the next heartbeat.

- [ ] **Step 1: Run full relevant test suites**

Run: `npm test -- --runInBand` in `C:/lng_system/lng-web/lng-web-be-extension-command-phase1`, then `npm run typecheck` and the focused UI test in `C:/lng_system/lng-web/lng-web-fe-extension-command-phase1`.

Expected: PASS; report backend and frontend results separately.

- [ ] **Step 2: Verify the non-destructive local management path**

Open the Integration page, confirm the current heartbeat agent is listed as `ONLINE`, confirm its token is redacted, and queue one `IMPORT_NEW_ORDERS` command only after selecting that agent.

- [ ] **Step 3: Verify revoke only with user confirmation**

Before revoking a live token, show the target token name, shop, and environment and wait for explicit user confirmation. After confirmation, revoke it and verify a subsequent heartbeat receives 401.

- [ ] **Step 4: Inspect final diffs**

Run: `git diff --check` in both worktrees and `git status --short`.

Expected: no whitespace errors and no secret-bearing files.
