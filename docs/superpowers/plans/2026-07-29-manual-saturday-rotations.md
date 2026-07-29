# Manual Saturday Rotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permit a calendar writer to create or revise one Saturday rotation without a later automatic generation overwriting that manual decision.

**Architecture:** Keep `HrSaturdayRotation` as the single source of truth. Add an origin field (`GENERATED` or `MANUAL`), expose it through the existing DTO, add one create endpoint for an individual Saturday, and make monthly generation preserve manually authored rows unless that date is explicitly supplied as a custom rotation.

**Tech Stack:** Express, Joi, Mongoose, Jest.

## Global Constraints

- No new dependencies or models.
- Preserve the existing unique key `{ teamId, workDateKey }` and team-scoped RBAC.
- A manual row must use a Saturday, active members of the selected team, and respect `minPresent`.
- Existing generated records remain readable; missing `source` is treated as `GENERATED`.

---

### Task 1: Define the public manual-rotation contract

**Files:**
- Modify: `src/modules/hr/models/saturdayRotation.model.js`
- Modify: `src/modules/hr/dtos/calendarPolicy.dto.js`
- Modify: `src/modules/hr/validators/calendarPolicy.validator.js`
- Test: `src/test/hr/validators/calendarPolicy.validator.test.js`
- Test: `src/test/hr/services/calendarPolicy.service.test.js`

**Interfaces:**
- Produces a rotation with `source: 'GENERATED' | 'MANUAL'`.
- Accepts `{ teamId, dateKey, employeeProfileIds, minPresent? }` for a single manual row.

- [ ] **Step 1: Write failing tests**

```js
expect(validate(createRotationSchema, {
  teamId: '507f1f77bcf86cd799439012',
  dateKey: '2026-02-07',
  employeeProfileIds: [],
})).toEqual(expect.objectContaining({ value: expect.any(Object) }));
```

- [ ] **Step 2: Run the focused validator/service test and verify the create schema is missing.**

Run: `npx jest src/test/hr/validators/calendarPolicy.validator.test.js src/test/hr/services/calendarPolicy.service.test.js --runInBand`

- [ ] **Step 3: Implement the smallest contract additions**

```js
const rotationSources = { GENERATED: 'GENERATED', MANUAL: 'MANUAL' };
const createRotationSchema = Joi.object({ teamId: objectId.required(), dateKey: dateKey.required(), employeeProfileIds: Joi.array().items(objectId).unique().required(), minPresent: Joi.number().integer().min(0) });
```

- [ ] **Step 4: Run the focused tests and verify they pass.**

### Task 2: Persist manual rows and protect them during generation

**Files:**
- Modify: `src/modules/hr/repositories/calendarPolicy.repository.js`
- Modify: `src/modules/hr/services/calendarPolicy.service.js`
- Test: `src/test/hr/services/calendarPolicy.service.test.js`

**Interfaces:**
- Produces `createRotation(payload, authContext)`.
- Monthly generation leaves an existing `MANUAL` row unchanged unless `customRotations` provides the same date.

- [ ] **Step 1: Write failing service tests**

```js
await expect(service.createRotation({ teamId: 't1', dateKey: '2026-02-07', employeeProfileIds: ['p1'] }))
  .resolves.toMatchObject({ source: 'MANUAL', employeeProfileIds: ['p1'] });
```

- [ ] **Step 2: Run the focused service test and verify it fails because `createRotation` does not exist.**

Run: `npx jest src/test/hr/services/calendarPolicy.service.test.js --runInBand`

- [ ] **Step 3: Implement the minimal service/repository behavior**

```js
const existing = await repository.findRotationByTeamAndDate(teamId, dateKey);
if (existing?.source === 'MANUAL' && !custom.has(dateKey)) {
  items.push(toRotationDto(existing));
  continue;
}
```

- [ ] **Step 4: Run the focused service test and verify it passes.**

### Task 3: Expose the route and verify the contract

**Files:**
- Modify: `src/modules/hr/controllers/calendarPolicy.controller.js`
- Modify: `src/modules/hr/routes/index.js`
- Test: `src/test/hr/routes/calendarPolicy.routes.test.js`

**Interfaces:**
- `POST /saturday-rotations` requires `HR_CALENDAR:WRITE` and returns `201`.

- [ ] **Step 1: Write a failing route test**

```js
['POST', '/saturday-rotations', { teamId: '507f1f77bcf86cd799439012', dateKey: '2026-09-05', employeeProfileIds: [] }, 201]
```

- [ ] **Step 2: Run the route test and verify it fails with `404`.**

Run: `npx jest src/test/hr/routes/calendarPolicy.routes.test.js --runInBand`

- [ ] **Step 3: Add the controller and guarded route.**

- [ ] **Step 4: Run all calendar policy tests and syntax checks.**

Run: `npx jest src/test/hr/routes/calendarPolicy.routes.test.js src/test/hr/services/calendarPolicy.service.test.js src/test/hr/validators/calendarPolicy.validator.test.js src/test/hr/models/schedule.models.test.js --runInBand; node -c src/modules/hr/services/calendarPolicy.service.js; node -c src/modules/hr/routes/index.js`
