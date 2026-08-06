# HR Batch 3 Calendar Decisions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Attendance, Leave, and Overtime resolve one consistent calendar status for each employee and work date.

**Architecture:** Extend the existing `scheduleResolver` as the canonical decision point, reusing the current Calendar Override, Holiday, and Saturday Rotation repositories. Keep existing APIs and models; `calendarPolicy` becomes a compatibility wrapper around the canonical result instead of making a second decision.

**Tech Stack:** Node.js, CommonJS, Mongoose, MongoDB Memory Server, Jest.

## Global Constraints

- Precedence is `PROFILE > TEAM > DEPARTMENT > WORK_LOCATION > GLOBAL > Holiday > Saturday Rotation > Shift workdays`.
- Preserve existing persisted Attendance, Leave, Overtime, and Payroll snapshots.
- Add no dependencies or new models.
- Use repositories for Mongoose access and existing module public ports for cross-module access.
- During implementation run only changed test files. At the Batch 3 gate run `npx jest src/test/hr --runInBand --silent`.
- Run architecture tests only if a module boundary changes. Do not run the full repository suite until PR or merge preparation.

---

### Task 1: Canonical Calendar Decision

**Files:**
- Modify: `src/modules/hr/services/scheduleResolver.service.js`
- Modify: `src/modules/hr/services/calendarPolicy.service.js`
- Test: `src/test/hr/services/scheduleResolver.service.test.js`
- Test: `src/test/hr/services/calendarPolicy.service.test.js`

**Interfaces:**
- Consumes: `calendarPolicy.repository.findApplicable({ dateKey, departmentId, teamId })` and `calendarPolicy.repository.isRotationOff(profileId, workDateKey, teamId)`.
- Produces: `resolveWorkContext({ profileId, workDateKey })` with one `status`, `isWorkingDay`, `calendarOverride`, `holiday`, and `isRotationOff` decision snapshot.

- [ ] **Step 1: Write failing precedence and mapping tests**

Add resolver cases proving:

```js
test.each([
  [{ kind: 'WORKING_DAY', scopeType: 'TEAM' }, { isWorkDay: false }, true, 'WORKING_DAY'],
  [null, { isWorkDay: false }, true, 'HOLIDAY'],
  [null, { isWorkDay: true }, true, 'WORKING_DAY'],
  [null, null, true, 'REST_DAY'],
])('selects one canonical calendar decision', async (override, holiday, rotationOff, status) => {
  // Arrange the existing active schedule plus the three policy inputs.
  await expect(resolveWorkContext(input)).resolves.toMatchObject({ status });
});
```

Also retain the existing test proving override scope priority is Profile through Global.

- [ ] **Step 2: Run the resolver tests and verify RED**

Run: `npx jest src/test/hr/services/scheduleResolver.service.test.js --runInBand`

Expected: FAIL because Holiday and Rotation are not read by `scheduleResolver`.

- [ ] **Step 3: Implement the minimal canonical selection**

In `scheduleResolver.service.js`, load applicable Holiday and Rotation alongside Calendar Overrides after the schedule context is valid. Select the first effective source using the approved precedence and return only the selected decision evidence:

```js
const [overrides, holiday, isRotationOff] = await Promise.all([
  scheduleRepository.findCalendarOverrides(workDateKey, context),
  calendarPolicyRepository.findApplicable({ dateKey: workDateKey, ...context }),
  context.teamId
    ? calendarPolicyRepository.isRotationOff(profileId, workDateKey, context.teamId)
    : false,
]);
```

Keep `calendarOverride` compatible. Return a Holiday DTO-shaped snapshot only when Holiday wins and `isRotationOff: true` only when Rotation wins.

- [ ] **Step 4: Make Calendar Policy delegate the decision**

Change `resolveCalendarPolicy()` to call `scheduleResolver.resolveWorkContext()` once and derive its compatibility response from that resolved snapshot. Remove its independent Holiday/Rotation queries from this path.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run: `npx jest src/test/hr/services/scheduleResolver.service.test.js src/test/hr/services/calendarPolicy.service.test.js --runInBand`

Expected: both suites PASS.

### Task 2: Consistent Consumer Inputs

**Files:**
- Modify only if characterization fails: `src/modules/hr/services/attendance.service.js`
- Modify only if characterization fails: `src/modules/hr/services/leave.service.js`
- Modify only if characterization fails: `src/modules/hr/services/overtime.service.js`
- Test: `src/test/hr/services/attendanceImport.service.test.js`
- Test: `src/test/hr/services/leave.service.test.js`
- Test: `src/test/hr/services/overtime.service.test.js`

**Interfaces:**
- Consumes: canonical `scheduleResolver.resolveWorkContext()` result from Task 1.
- Produces: identical effective `WORKING_DAY`, `HOLIDAY`, or `REST_DAY` interpretation across the three workflows.

- [ ] **Step 1: Add characterization tests for one Holiday and one override case**

Use the existing service dependency mocks to prove:

```js
const holidayContext = { status: 'HOLIDAY', isWorkingDay: false, holiday: { id: 'h1', isWorkDay: false } };
const workdayContext = { status: 'WORKING_DAY', isWorkingDay: true, calendarOverride: { kind: 'WORKING_DAY' } };
```

Attendance import must resolve Holiday from the canonical context; Leave must exclude Holiday from working-date snapshots; Overtime must classify it as `HOLIDAY`. The override case must be treated as a workday by all three.

- [ ] **Step 2: Run the three consumer suites and verify behavior**

Run: `npx jest src/test/hr/services/attendanceImport.service.test.js src/test/hr/services/leave.service.test.js src/test/hr/services/overtime.service.test.js --runInBand`

Expected: characterization tests either PASS with no production edits or fail at the exact remaining secondary interpretation.

- [ ] **Step 3: Remove only confirmed secondary interpretation**

If a test fails, replace the duplicated consumer decision with the canonical fields. Do not add another policy helper. Attendance should pass the resolver-selected `holiday`, `status`, and `isRotationOff`; Leave and Overtime should continue reading `status` and `isWorkingDay`.

- [ ] **Step 4: Re-run the three consumer suites**

Run the command from Step 2.

Expected: all three suites PASS.

### Task 3: Calendar Write Integrity And Idempotency

**Files:**
- Modify: `src/modules/hr/services/schedule.service.js`
- Modify: `src/modules/hr/services/calendarPolicy.service.js`
- Test: `src/test/hr/services/schedule.service.test.js`
- Test: `src/test/hr/services/calendarPolicy.service.test.js`

**Interfaces:**
- Consumes: existing normalized Calendar Override and Holiday payloads.
- Produces: no-op updates without write/audit, and stable missing/inactive target errors.

- [ ] **Step 1: Write failing no-op and scope tests**

Cover:

```js
expect(repository.updateCalendarOverrideById).not.toHaveBeenCalled();
expect(repository.updateHoliday).not.toHaveBeenCalled();
expect(auditPublic.record).not.toHaveBeenCalled();
```

Also cover missing and inactive Department/Team targets for both create and destination-scope update. Expected errors are `RESOURCE_NOT_FOUND` for missing and `CONFLICT_ERROR` for inactive.

- [ ] **Step 2: Run focused service tests and verify RED**

Run: `npx jest src/test/hr/services/schedule.service.test.js src/test/hr/services/calendarPolicy.service.test.js --runInBand`

- [ ] **Step 3: Implement minimal normalized comparison and scope assertions**

Reuse `hasPayloadChanges()` in `schedule.service.js` for Calendar Override updates. In `calendarPolicy.service.js`, compare the normalized Holiday patch with the current record before persistence. Update `assertOrganizationScopes()` to reject null and non-active Organization records using the existing `notFound()` and conflict error patterns.

- [ ] **Step 4: Re-run focused service tests and verify GREEN**

Run the command from Step 2.

Expected: both suites PASS.

### Task 4: Duplicate Race Persistence And Batch Gate

**Files:**
- Create: `src/test/hr/services/calendarOverride.persistence.test.js`
- Modify only if persistence test exposes a defect: `src/modules/hr/repositories/schedule.repository.js`

**Interfaces:**
- Consumes: existing partial unique index `{ dateKey, scopeType, scopeId }` for active overrides.
- Produces: one successful active Calendar Override under concurrent duplicate creation; the loser maps to `CONFLICT_ERROR`.

- [ ] **Step 1: Write the persistence test**

Use `MongoMemoryReplSet` and two concurrent service calls for the same active Global override:

```js
const results = await Promise.allSettled([
  service.createCalendarOverride(payload, auth),
  service.createCalendarOverride(payload, auth),
]);
expect(results.map(({ status }) => status).sort()).toEqual(['fulfilled', 'rejected']);
expect(results.find(({ status }) => status === 'rejected').reason)
  .toMatchObject({ code: 'CONFLICT_ERROR' });
```

Verify the database contains exactly one active record.

- [ ] **Step 2: Run persistence and Batch 3 focused suites**

Run: `npx jest src/test/hr/services/calendarOverride.persistence.test.js src/test/hr/services/scheduleResolver.service.test.js src/test/hr/services/calendarPolicy.service.test.js src/test/hr/services/schedule.service.test.js src/test/hr/services/attendanceImport.service.test.js src/test/hr/services/leave.service.test.js src/test/hr/services/overtime.service.test.js --runInBand`

Expected: all suites PASS.

- [ ] **Step 3: Run syntax and diff checks**

Run `node -c` for every changed production JavaScript file, followed by `git diff --check`.

Expected: exit code 0.

- [ ] **Step 4: Run the HR batch gate**

Run: `npx jest src/test/hr --runInBand --silent`

Expected: all HR suites PASS. Do not run `npm test` in this batch.

- [ ] **Step 5: Review and commit implementation**

Inspect `git diff` and commit only Batch 3 production/tests:

```bash
git commit -m "fix(hr): unify calendar decisions"
```
