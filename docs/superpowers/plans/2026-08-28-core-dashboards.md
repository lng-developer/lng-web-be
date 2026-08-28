# Core Dashboards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the shared Operations Dashboard with scoped Portal, HR, and System dashboard landings.

**Architecture:** Portal reuses the report module's existing operations overview. HR makes its existing dashboard permission-aware. System adds a dashboard read model in the `system` module and obtains cross-module data only through public ports. Frontend routing and navigation point every application core to its own landing route.

**Tech Stack:** React, TypeScript, Ant Design, TanStack Query, Node.js, Express, Mongoose, Jest, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-28-core-dashboards-design.md`

## Global Constraints

- No new dependency and no shared dashboard business module.
- Cross-module backend calls use `public.js` only.
- Dashboard sections are omitted when the account lacks their read permission.
- Keep `/operations-dashboard` as a redirect to `/portal/dashboard`.
- Do not commit without explicit user approval.

---

### Task 1: Portal dashboard route and navigation

**Files:**
- Modify: `C:\lng_system\lng-web\lng-web-fe\src\app\layout\appNavigation.ts`
- Modify: `C:\lng_system\lng-web\lng-web-fe\src\app\router\router.tsx`
- Modify: `C:\lng_system\lng-web\lng-web-fe\src\features\foundation\OperationsDashboardPage.tsx`
- Modify: `C:\lng_system\lng-web\lng-web-fe\src\features\foundation\useOperationsDashboard.tsx`
- Test: `C:\lng_system\lng-web\lng-web-fe\src\test\app\layout\appNavigation.test.ts`

**Interfaces:**
- Consumes: `GET /api/reports/operations/overview` through the existing report API client.
- Produces: `/portal/dashboard` and a compatibility redirect from `/operations-dashboard`.

- [ ] Write a failing route/navigation test asserting Portal's Dashboard item targets `/portal/dashboard` and the legacy path redirects there.
- [ ] Run `npx vitest run src/test/app/layout/appNavigation.test.ts --project unit` and confirm the route expectation fails.
- [ ] Replace the shared dashboard route with a Portal route, update the existing dashboard hook to use the report overview plus only permitted portal queries, and redirect the legacy route.
- [ ] Run the focused navigation test and `npm run typecheck`.

### Task 2: Permission-aware HR dashboard

**Files:**
- Modify: `src/modules/hr/controllers/hrDashboard.controller.js`
- Modify: `src/modules/hr/services/hrDashboard.service.js`
- Modify: `src/modules/hr/dtos/hrDashboard.dto.js`
- Modify: `src/modules/hr/routes/index.js`
- Test: `tests/hr/services/hrDashboard.service.test.js`
- Modify: `C:\lng_system\lng-web\lng-web-fe\src\app\layout\appNavigation.ts`
- Modify: `C:\lng_system\lng-web\lng-web-fe\src\app\router\router.tsx`
- Create: `C:\lng_system\lng-web\lng-web-fe\src\features\hr\pages\HrDashboardPage.tsx`
- Test: `C:\lng_system\lng-web\lng-web-fe\src\test\hr\pages\HrDashboardPage.test.tsx`

**Interfaces:**
- Consumes: `GET /api/hr/dashboard?dateKey=YYYY-MM-DD&days=1|7|30`.
- Produces: `{ level: 'PERSONAL' | 'TEAM' | 'OPERATIONS', sections: object }`, with no unauthorized section.

- [ ] Write failing service tests for personal-only, team-scoped, and HR-operations contexts; each test asserts unavailable sections are absent.
- [ ] Run `npm test -- --runInBand tests/hr/services/hrDashboard.service.test.js` and confirm the old dashboard does not distinguish levels.
- [ ] Pass `req.auth` into the HR dashboard service, resolve the highest allowed level, build only that DTO section through HR-owned repositories/services, and validate `dateKey`/`days` in the controller.
- [ ] Add `/hr/dashboard`, redirect the HR dashboard navigation item to it, and render the returned level with existing personal/team/operations cards.
- [ ] Run the focused BE service/route tests, focused FE page test, `npm run test:architecture -- --runInBand`, and FE typecheck.

### Task 3: System dashboard read model

**Files:**
- Modify: `src/modules/system/public.js`
- Modify: `src/modules/system/routes/index.js`
- Create: `src/modules/system/controllers/systemDashboard.controller.js`
- Create: `src/modules/system/services/systemDashboard.service.js`
- Create: `src/modules/system/dtos/systemDashboard.dto.js`
- Modify: `src/modules/auth/public.js`
- Modify: `src/modules/audit/public.js`
- Test: `tests/system/services/systemDashboard.service.test.js`
- Test: `tests/system/routes/index.test.js`
- Modify: `C:\lng_system\lng-web\lng-web-fe\src\app\layout\appNavigation.ts`
- Modify: `C:\lng_system\lng-web\lng-web-fe\src\app\router\router.tsx`
- Create: `C:\lng_system\lng-web\lng-web-fe\src\features\system\api\systemDashboardApi.ts`
- Create: `C:\lng_system\lng-web\lng-web-fe\src\features\system\pages\SystemDashboardPage.tsx`
- Test: `C:\lng_system\lng-web\lng-web-fe\src\test\system\pages\SystemDashboardPage.test.tsx`

**Interfaces:**
- Produces: `GET /api/system/dashboard` → `{ health?: SystemHealthDto, access?: { accountCount: number }, recentAudit?: AuditEventDto[] }`.
- `health` requires `AUDIT:READ`; `access` requires `AUTH:READ`; `recentAudit` requires `AUDIT:READ`.

- [ ] Write failing service tests proving each section is present only for its read permission and that no direct model imports are used outside its owner module.
- [ ] Run `npm test -- --runInBand tests/system/services/systemDashboard.service.test.js` and confirm the endpoint does not exist.
- [ ] Add narrow public-port read functions for auth account counts and recent audit events; implement the System service by calling those ports and `systemHealth.service.getHealth()`.
- [ ] Add an authenticated `/dashboard` route under `system`, use a DTO to omit unauthorized sections, and add route validation/permission tests.
- [ ] Add `/system/dashboard` navigation and a FE page with one React Query request, loading/error states, and links to Accounts, Audit, and Monitoring only when that section exists.
- [ ] Run the focused BE/FE tests, architecture test, and FE typecheck.

### Task 4: Integration verification

**Files:**
- Modify: `C:\lng_system\lng-web\lng-web-fe\src\test\app\router\LazyRouteContract.test.tsx`
- Modify: `C:\lng_system\lng-web\lng-web-fe\src\test\app\layout\AppSidebar.test.tsx`

**Interfaces:**
- Verifies all three dashboard paths and the legacy redirect.

- [ ] Write failing route tests for `/portal/dashboard`, `/hr/dashboard`, `/system/dashboard`, and `/operations-dashboard` redirect behavior.
- [ ] Run the focused route test and confirm absent paths fail.
- [ ] Add only the lazy-route registrations and sidebar assertions needed to make the route contract pass.
- [ ] Run `npm run test:architecture -- --runInBand`, all focused dashboard BE tests, `npm run typecheck`, and the focused FE navigation/dashboard tests.
- [ ] Inspect `git diff --check` and `git diff`; do not commit unless the user requests it.
