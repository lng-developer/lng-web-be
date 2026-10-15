# Teams setup after Microsoft login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Offer non-blocking Teams consent to the canonical Portal account after either Microsoft SSO or password login, without delaying chat or creating duplicate accounts.

**Architecture:** Keep the backend as authority for canonical Accounts, verified Microsoft identity matching, encrypted refresh grants, and caller-scoped OAuth state. Move setup discovery from direct chat into one authenticated-shell component that reuses the existing status/start endpoints and React Query cache. Portal Socket.IO, REST fallback, and the outbox remain independent of Teams consent.

**Tech Stack:** Node.js, Express, Mongoose, Jest, React, TypeScript, Ant Design, TanStack Query, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-15-teams-setup-after-microsoft-login-design.md`

## Global Constraints

- Microsoft SSO and password login resolve to one canonical Portal Account; never link by display name or unverified email.
- Preserve the existing password/profile setup gate before chat; Teams consent never bypasses it.
- Do not return, log, or render Graph tokens, tenant IDs, or Graph diagnostics.
- Portal message ACK, Socket.IO delivery, and outbox processing are independent of Teams consent and Graph availability.
- Reuse the existing encrypted refresh-grant storage and `/api/integration/teams/oauth/status` and `/start` endpoints; add no dependency.

## Review Focus

- Password login with a known Microsoft identity and `NOT_CONNECTED` shows an offer but no automatic Microsoft popup; Task 3.
- Returning from a successful popup removes the prompt without full-page refresh; Task 3.
- `REAUTH_REQUIRED` does not expose Graph failure detail; Task 3.
- Microsoft SSO casing resolves the existing canonical account rather than provisioning another; Task 1.
- Portal chat still sends when Teams OAuth state is unavailable; Task 4.

---

### Task 1: Pin the shared Portal/Microsoft account identity contract

**Files:**
- Modify: `tests/auth/services/authManager.service.test.js`
- Modify only if a test exposes a gap: `src/modules/auth/services/authManager.service.js`

**Interfaces:**
- Consumes: `authManager.loginWithMicrosoft(idToken, httpContext)`.
- Produces: regression-protected lookup by Microsoft subject first, then normalized verified email, with no display-name link.

- [ ] **Step 1: Write the failing identity regression tests**

Add tests proving a password Account at `User@lngwork.co` is selected for a Microsoft token at `user@lngwork.co`, linked to its subject, and not recreated; prove an existing subject wins before email lookup.

- [ ] **Step 2: Run the focused test to verify intended behavior**

Run: `npm test -- --runInBand tests/auth/services/authManager.service.test.js`

Expected: the new cases fail only if canonical lookup or subject precedence differs from the contract.

- [ ] **Step 3: Make the minimal service correction if necessary**

Keep `loginWithMicrosoft(idToken, httpContext)` in `src/modules/auth/services/authManager.service.js`; normalize the verified token email, look up subject before email, and never add display-name linking.

- [ ] **Step 4: Run the focused test to verify it passes**

Run: `npm test -- --runInBand tests/auth/services/authManager.service.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/auth/services/authManager.service.test.js src/modules/auth/services/authManager.service.js
git commit -m "test(auth): protect microsoft account linking"
```

### Task 2: Extract the existing Teams OAuth browser API from chat

**Files:**
- Create: `C:/Users/stack/Task/lng-web-fe/src/features/integration/teams/api/teamsOAuthApi.ts`
- Modify: `C:/Users/stack/Task/lng-web-fe/src/features/portal/chat/api/chatApi.ts`
- Modify: `C:/Users/stack/Task/lng-web-fe/src/features/portal/chat/pages/ChatWorkspacePage.tsx`
- Test: `C:/Users/stack/Task/lng-web-fe/src/test/portal/chat/pages/ChatWorkspacePage.test.tsx`

**Interfaces:**
- Consumes: authenticated HTTP client and the existing OAuth status/start routes.
- Produces: `getTeamsOAuthStatus(): Promise<TeamsOAuthStatus>` and `startTeamsOAuth(): Promise<{ authorizationUrl: string }>` from `features/integration/teams/api/teamsOAuthApi.ts`.

- [ ] **Step 1: Write the failing moved-import test**

Update the chat workspace test so its Teams OAuth mocks import from `features/integration/teams/api/teamsOAuthApi` while preserving existing chat assertions.

- [ ] **Step 2: Run it to prove the module is absent**

Run: `npm test -- --runInBand src/test/portal/chat/pages/ChatWorkspacePage.test.tsx`

Expected: FAIL because the extracted module does not exist.

- [ ] **Step 3: Extract the two functions and status type**

Move only `TeamsOAuthStatus`, `getTeamsOAuthStatus`, and `startTeamsOAuth` to the new integration API. Leave chat transport and polling in `chatApi.ts`; update the chat import.

- [ ] **Step 4: Run the focused test**

Run: `npm test -- --runInBand src/test/portal/chat/pages/ChatWorkspacePage.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/integration/teams/api/teamsOAuthApi.ts src/features/portal/chat/api/chatApi.ts src/features/portal/chat/pages/ChatWorkspacePage.tsx src/test/portal/chat/pages/ChatWorkspacePage.test.tsx
git commit -m "refactor(teams): extract oauth browser api"
```

### Task 3: Mount one non-blocking Teams setup prompt in the authenticated shell

**Files:**
- Create: `C:/Users/stack/Task/lng-web-fe/src/app/layout/TeamsSetupPrompt.tsx`
- Create: `C:/Users/stack/Task/lng-web-fe/src/app/layout/TeamsSetupPrompt.module.scss`
- Modify: `C:/Users/stack/Task/lng-web-fe/src/app/layout/AppShell.tsx`
- Modify: `C:/Users/stack/Task/lng-web-fe/src/features/portal/chat/pages/ChatWorkspacePage.tsx`
- Test: `C:/Users/stack/Task/lng-web-fe/src/test/app/layout/AppShell.test.tsx`

**Interfaces:**
- Consumes: `getTeamsOAuthStatus`, `startTeamsOAuth`, and React Query key `['teams-oauth-status']`.
- Produces: `TeamsSetupPrompt`, rendered once in `AppShell`; it returns null for disabled, non-Microsoft, and `CONNECTED` callers.

- [ ] **Step 1: Write the failing shell tests**

Assert `NOT_CONNECTED` and `REAUTH_REQUIRED` render concise setup/reconnect copy; `CONNECTED` and `userLinked: false` render nothing; dismissal hides it for the mounted session; Connect opens the returned URL in a popup without navigating the shell.

- [ ] **Step 2: Run the test to prove the shell has no prompt**

Run: `npm test -- --runInBand src/test/app/layout/AppShell.test.tsx`

Expected: FAIL because `TeamsSetupPrompt` is not mounted.

- [ ] **Step 3: Implement and mount `TeamsSetupPrompt`**

Query `['teams-oauth-status']`; persist dismissal only in `sessionStorage`; create the popup synchronously before fetching `authorizationUrl`; invalidate the status query when window focus returns; remove the prompt only when `grantStatus === 'CONNECTED'`.

- [ ] **Step 4: Make the chat header passive**

Remove the chat-header Connect action and popup logic. If a connection indicator remains, it is status-only and is never the sole discovery path.

- [ ] **Step 5: Run shell and chat tests**

Run: `npm test -- --runInBand src/test/app/layout/AppShell.test.tsx src/test/portal/chat/pages/ChatWorkspacePage.test.tsx`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/app/layout/TeamsSetupPrompt.tsx src/app/layout/TeamsSetupPrompt.module.scss src/app/layout/AppShell.tsx src/features/portal/chat/pages/ChatWorkspacePage.tsx src/test/app/layout/AppShell.test.tsx src/test/portal/chat/pages/ChatWorkspacePage.test.tsx
git commit -m "feat(teams): prompt for setup after login"
```

### Task 4: Verify the integration boundaries and build

**Files:**
- Verify: `src/modules/integration/teamsChat/routes/teamsChat.routes.js`
- Verify: `src/modules/integration/teamsChat/controllers/teamsAdmin.controller.js`
- Verify: `C:/Users/stack/Task/lng-web-fe/src/features/portal/chat/api/chatQueries.ts`

**Interfaces:**
- Consumes: OAuth status/start, Socket.IO chat ACK, and the Teams outbox.
- Produces: evidence that setup UI did not alter authorization, chat transport, polling fallback, or outbox behavior.

- [ ] **Step 1: Run backend OAuth status regression tests**

Run: `npm test -- --runInBand tests/integration/teamsChat/controllers/teamsAdmin.controller.test.js`

Expected: PASS, including caller-scoped status with no admin diagnostic fields.

- [ ] **Step 2: Run the frontend production build**

Run: `npm run build`

Working directory: `C:/Users/stack/Task/lng-web-fe`

Expected: PASS.

- [ ] **Step 3: Run backend architecture checks**

Run: `npm run test:architecture -- --runInBand`

Expected: PASS.

- [ ] **Step 4: Smoke-test the approved matrix in development**

Verify Microsoft SSO and password login both enter their canonical account and chat immediately; prompt only eligible callers; a successful popup removes it after focus. Check sanitized outbox/mapping state only, never message bodies or tokens.
