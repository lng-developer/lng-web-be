# Order Tracking Deadline Alerts & Realtime Socket Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement automated tracking deadline monitoring (48h warning for seller, 24h & overdue alerts for seller and team leaders) and real-time Socket.IO notification delivery replacing 60-second polling.

**Architecture:**
- **Organization Public Port:** Add `listLeadersForAccountIds` to retrieve active team leaders of assigned sellers.
- **Order Deadline Scanner & Scheduler:** Background scheduler running periodically with distributed lock to find active unshipped orders within 48h, 24h, or past `shipByDate`, dispatching tiered notifications to sellers and leaders with deterministic deduplication keys.
- **Realtime Socket Notifications (Backend):** Introduce `notificationEvents` in the `notification` module. When a notification is created, emit `notification.created` over Socket.IO to the recipient's personal room `account:${recipientAccountId}`.
- **Realtime Socket Notifications (Frontend):** Extend `ChatSocket` with `notification.created` server-to-client event. In `useNotificationCenter` and `useImportantNotificationWatcher`, listen for incoming notifications to invalidate React Query caches and pop up alerts immediately without polling delay.

**Tech Stack:** Node.js, Express, Mongoose, Socket.io, BullMQ/Redis distributed locks, React, TanStack Query, Vitest/Jest.

**Spec:** [docs/superpowers/specs/2026-07-28-pod-assignee-notifications-design.md](file:///mnt/c/lng_system/lng-web/lng-web-be/docs/superpowers/specs/2026-07-28-pod-assignee-notifications-design.md) (un-deferring Tracking-Overdue Alerts & adding Socket delivery).

## Global Constraints
- Strict modular monolith: cross-module access strictly via target module's `public.js`.
- No direct Mongoose queries outside of repositories.
- Controllers wrap with `asyncHandler`, services use `AppError` and `logger`.
- Lean queries on all read-only Mongoose calls (`.lean()`).
- Preserve existing dirty worktree files in `media/`.
- All tests run in-band and must pass 100%.

## Review Focus
1. **Deduplication:** A single order must never spam the same recipient multiple times on the same day for the same urgency level.
2. **Leader Resolution:** When a seller has no assigned team or team has no leader, notifications must still be delivered to the seller without throwing.
3. **Shipped/Cancelled Exclusion:** Orders already shipped or cancelled must be strictly skipped even if `shipByDate` is in the past.
4. **Socket Authentication & Isolation:** Sockets must only receive notifications addressed to their authenticated `accountId`.
5. **Realtime UI Responsiveness:** Incoming socket events must immediately update the unread counter badge and trigger toast alerts without requiring a page refresh.

---

### Task 1: Add `listLeadersForAccountIds` to Organization Public Port

**Files:**
- Modify: `src/modules/organization/repositories/teamMembership.repository.js`
- Modify: `src/modules/organization/services/organization.service.js`
- Modify: `src/modules/organization/public.js`
- Test: `tests/organization/organizationLeaderLookup.test.js`

- [x] **Step 1.1: Write failing test for leader lookup by account IDs**
  Create `tests/organization/organizationLeaderLookup.test.js` testing that given a list of staff `accountIds`, the method returns the account IDs of active leaders for their teams.
- [x] **Step 1.2: Implement `listTeamLeadersByAccountIds` in repository and service**
  In `teamMembership.repository.js`, implement query finding active teams of the given accounts and then active members of those teams with `memberType: 'leader'`.
  In `organization.service.js`, add `listLeadersForAccountIds(accountIds)`.
- [x] **Step 1.3: Expose through `src/modules/organization/public.js`**
  Add `listLeadersForAccountIds` to `public.js`.
- [x] **Step 1.4: Run tests to verify**
  Run `npm run test:organization -- --runInBand`. Confirm passes.

---

### Task 2: Realtime Socket Notification Broadcast in Backend

**Files:**
- Create: `src/modules/notification/events.js`
- Modify: `src/modules/notification/services/notification.service.js`
- Modify: `src/realtime/chatSocket.js`
- Test: `tests/notification/notificationSocketBroadcast.test.js`

- [x] **Step 2.1: Write failing unit test for notification event emission**
  Test that calling `notification.service.notify` emits `notification.created` on `notificationEvents` with the DTO payload.
- [x] **Step 2.2: Create `notificationEvents` EventEmitter**
  Create `src/modules/notification/events.js` exporting `new EventEmitter()`.
- [x] **Step 2.3: Emit event on successful notification creation**
  In `src/modules/notification/services/notification.service.js`, emit `notification.created` with `toNotificationDto(created)` after `repository.create(payload)`.
- [x] **Step 2.4: Attach Socket.IO broadcast in `chatSocket.js`**
  In `src/realtime/chatSocket.js`, subscribe to `notificationEvents.on('notification.created', ...)` and emit `io.to('account:' + notification.recipientAccountId).emit('notification.created', notification)`.
- [x] **Step 2.5: Verify notification tests and syntax**
  Run `node -c src/realtime/chatSocket.js` and `npm test -- tests/notification/`.

---

### Task 3: Order Tracking Deadline Scanner & Scheduler

**Files:**
- Modify: `src/modules/order/repositories/order.repository.js`
- Create: `src/modules/order/services/orderTrackingDeadlineScanner.service.js`
- Modify: `src/modules/order/public.js`
- Modify: `src/server.js`
- Test: `tests/order/orderTrackingDeadlineScanner.test.js`

- [x] **Step 3.1: Write failing tests for deadline scanner**
  Create `tests/order/orderTrackingDeadlineScanner.test.js`:
  - 48h warning: sends to seller only.
  - 24h warning: sends to seller and leader.
  - Overdue alert: sends to seller and leader with overdue copy.
  - Deduplication prevents duplicate notifications on same day.
  - Shipped and cancelled orders are ignored.
- [x] **Step 3.2: Add repository query for tracking deadline candidates**
  In `src/modules/order/repositories/order.repository.js`, add `findTrackingDeadlineCandidates({ cutoffDate })` finding orders with `status` not in `['SHIPPED', 'CANCELLED']`, `shipByDate: { $lte: cutoffDate, $ne: null }`.
- [x] **Step 3.3: Implement scanner service logic with tiered alerts**
  In `src/modules/order/services/orderTrackingDeadlineScanner.service.js`:
  - Query candidates within next 48 hours.
  - Categorize: `OVERDUE` (past shipByDate), `DUE_IN_24H` (<= 24h), `DUE_IN_48H` (<= 48h).
  - Resolve leaders via `organizationPublic.listLeadersForAccountIds`.
  - Dispatch notifications via `notificationPublic.notify` with stable `deduplicationKey`.
- [x] **Step 3.4: Add distributed lock scheduler and bootstrap in `server.js`**
  Add `startOrderTrackingDeadlineScheduler` and `stopOrderTrackingDeadlineScheduler` using `withDistributedLock('scheduler:order_tracking_deadline', 120000, ...)`.
  Hook into `server.js` bootstrap and shutdown sequence.
- [x] **Step 3.5: Run order test suite and architecture tests**
  Run `npm test -- tests/order/orderTrackingDeadlineScanner.test.js` and `npm run test:architecture -- --runInBand`.

---

### Task 4: Frontend Socket Listener for Realtime Notifications

**Files:**
- Modify: `src/features/portal/chat/realtime/chatSocket.ts`
- Modify: `src/features/notifications/useNotificationCenter.ts`
- Modify: `src/features/notifications/hooks/useImportantNotificationWatcher.ts`
- Modify: `src/shared/i18n/locales/en/common.json`
- Modify: `src/shared/i18n/locales/vi/common.json`
- Test: `src/test/notifications/useNotificationCenterSocket.test.tsx`

- [x] **Step 4.1: Extend socket types with notification events**
  In `src/features/portal/chat/realtime/chatSocket.ts`, add `'notification.created': (notification: NotificationItem) => void` to `ServerToClientEvents`.
- [x] **Step 4.2: Update `useNotificationCenter` to invalidate queries on socket event**
  In `src/features/notifications/useNotificationCenter.ts`, listen for `notification.created` on socket to immediately invalidate `['notifications']`.
- [x] **Step 4.3: Update `useImportantNotificationWatcher` to trigger instant alerts**
  In `src/features/notifications/hooks/useImportantNotificationWatcher.ts`, attach socket listener to display `alertImportantNotification(...)` immediately when an important notification arrives.
- [x] **Step 4.4: Add i18n copy for deadline notification types**
  Add localized notification title/message templates for `ORDER_TRACKING_DUE_48H`, `ORDER_TRACKING_DUE_24H`, `ORDER_TRACKING_OVERDUE` in both `en/common.json` and `vi/common.json`.
- [x] **Step 4.5: Verify frontend typecheck and tests**
  Run `npm run typecheck` and `vitest run` on notification tests.

---

### Task 5: End-to-End Verification & Integration

- [x] **Step 5.1: Run full Backend verification**
  Run `npm test -- --runInBand` and `npm run test:architecture -- --runInBand`.
- [x] **Step 5.2: Run full Frontend typecheck and linting**
  Run `npm run typecheck` in `lng-web-fe`.
- [x] **Step 5.3: Verify git status and diff cleanliness**
  Ensure only related files are changed and user's unrelated dirty worktree files remain intact.
