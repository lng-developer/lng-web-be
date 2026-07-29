# Staff Provisioning Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Atomically provision a staff account, access assignments, HR profile, and annual leave balance, then enforce password and personal-profile setup before access to business APIs.

**Architecture:** HR owns the provisioning command and company fields. A narrow Auth public port creates the Account and access assignments inside HR's MongoDB transaction; HR then creates the profile and balance. Auth owns credentials and the account-setup gate; HR owns the self-service personal field whitelist.

**Tech Stack:** Node.js CommonJS, Express 5, Mongoose, Joi, Jest.

## Global Constraints

- Login name is `employeeCode`; do not add a second username.
- The default password `123456` is a server-side Auth constant and is never sent by FE.
- Provision Account, AccessAssignment, HrEmployeeProfile, and current-year ANNUAL LeaveBalance in one transaction or write none.
- HR writes company fields only. Staff writes their own personal fields only. Compensation is not self-service.
- Setup gating is server-side. FE redirects never grant access.
- Existing account and employee-profile endpoints retain their current behavior.

---

## File Structure

- Auth: `models/account.model.js`, `dtos/auth.dto.js`, `services/authManager.service.js`, `services/authAdmin.service.js`, `public.js`, `validators/auth.validator.js`, `controllers/auth.controller.js`, `routes/index.js`.
- HR: create `services/staffProvisioning.service.js`; update employee validator, DTO, service, controller, and routes.
- Tests: extend existing auth-manager/auth-admin/employee-profile tests; create `src/test/hr/services/staffProvisioning.service.test.js`.

### Task 1: Account setup state and own-password command

**Files:**
- Modify: `src/modules/auth/models/account.model.js`
- Modify: `src/modules/auth/dtos/auth.dto.js`
- Modify: `src/modules/auth/validators/auth.validator.js`
- Modify: `src/modules/auth/services/authManager.service.js`
- Modify: `src/modules/auth/controllers/auth.controller.js`
- Modify: `src/modules/auth/routes/index.js`
- Test: `src/test/auth/services/authManager.service.test.js`
- Test: `src/test/auth/controllers/auth.controller.test.js`

**Produces:** `account.mustChangePassword`, `POST /api/auth/me/change-password`, and safe login/refresh/me DTO setup state.

- [ ] **Step 1: Write failing tests**

```js
test('login exposes mustChangePassword without hashes', async () => {
  const result = await authManager.login('EMP-0241', '123456', {});
  expect(result.account.mustChangePassword).toBe(true);
  expect(result.account).not.toHaveProperty('passwordHash');
});

test('own password change verifies the temporary password', async () => {
  await expect(authManager.changeOwnPassword(accountId, {
    currentPassword: 'wrong', newPassword: 'secure-password-1',
  }, {})).rejects.toMatchObject({ statusCode: 401 });
});
```

- [ ] **Step 2: Run failing tests**

Run: `npm test -- src/test/auth/services/authManager.service.test.js src/test/auth/controllers/auth.controller.test.js --runInBand`

Expected: FAIL because the flag and command do not exist.

- [ ] **Step 3: Implement the smallest Auth contract**

Add the required Boolean `mustChangePassword` model field with default `false`. Add it only to safe account/session/context DTOs. Define:

```js
const changeOwnPasswordSchema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().min(6).required(),
});
```

Implement `changeOwnPassword(accountId, payload, httpContext)`: load hash/salt, verify current password, hash the new password, persist the new hash/salt with `mustChangePassword: false`, revoke other refresh sessions, and record `ACCOUNT_INITIAL_PASSWORD_CHANGED`. Mount `POST /api/auth/me/change-password` behind `authenticate`.

- [ ] **Step 4: Verify**

Run: `npm test -- src/test/auth/services/authManager.service.test.js src/test/auth/controllers/auth.controller.test.js --runInBand`

Expected: PASS; incorrect current passwords never clear the flag.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/auth/models/account.model.js src/modules/auth/dtos/auth.dto.js src/modules/auth/validators/auth.validator.js src/modules/auth/services/authManager.service.js src/modules/auth/controllers/auth.controller.js src/modules/auth/routes/index.js src/test/auth/services/authManager.service.test.js src/test/auth/controllers/auth.controller.test.js
git commit -m "feat(auth): require initial password change"
```

### Task 2: Atomic staff-provisioning command

**Files:**
- Modify: `src/modules/auth/services/authAdmin.service.js`
- Modify: `src/modules/auth/public.js`
- Modify: `src/modules/hr/validators/employeeProfile.validator.js`
- Create: `src/modules/hr/services/staffProvisioning.service.js`
- Modify: `src/modules/hr/controllers/employeeProfile.controller.js`
- Modify: `src/modules/hr/routes/index.js`
- Modify: `src/modules/hr/dtos/employeeProfile.dto.js`
- Test: `src/test/auth/services/authAdmin.service.test.js`
- Test: `src/test/hr/services/staffProvisioning.service.test.js`
- Test: `src/test/hr/routes/employeeProfile.routes.test.js`

**Consumes:** `employeeCode`, `workEmail`, employment/company fields, and scoped role assignments.

**Produces:** `POST /api/hr/staff-provisioning` returning safe account/profile/onboarding/balance data.

- [ ] **Step 1: Write failing success and rollback tests**

```js
test('provisions account, assignments, profile, and annual balance together', async () => {
  const result = await staffProvisioning.provisionStaff(validPayload, hrAuth);
  expect(result.onboarding).toEqual({ mustChangePassword: true, profileSetupRequired: true });
  expect(result.employeeProfile.employeeCode).toBe(validPayload.employeeCode);
  expect(result.leaveBalance.leaveType).toBe('ANNUAL');
});

test('writes no account when leave balance initialization fails', async () => {
  leaveRepository.ensureBalance.mockRejectedValueOnce(new Error('balance write failed'));
  await expect(staffProvisioning.provisionStaff(validPayload, hrAuth)).rejects.toThrow('balance write failed');
  await expect(accountRepository.findByEmail(validPayload.workEmail)).resolves.toBeNull();
});
```

- [ ] **Step 2: Run failing provisioning tests**

Run: `npm test -- src/test/auth/services/authAdmin.service.test.js src/test/hr/services/staffProvisioning.service.test.js src/test/hr/routes/employeeProfile.routes.test.js --runInBand`

Expected: FAIL because the public port, service, and route are absent.

- [ ] **Step 3: Add the Auth provisioning port**

Extract the reusable internals of `authAdmin.createAccount` into:

```js
async function provisionAccount({ email, assignments }, authContext, { session }) {
  // validate roles/scopes, hash server-only '123456', create active account
  // with mustChangePassword true, then create assignments using session
}
```

Expose only `provisionAccount` from `auth/public.js`. Keep `/api/auth/accounts` unchanged.

- [ ] **Step 4: Add HR validator, transaction service, controller, and route**

Add `staffProvisioningSchema` containing only `employeeCode`, `workEmail`, `fullName`, organization, job, employment, dates, status, and `assignments`. Reject password, personal, and compensation fields.

In `provisionStaff`, open one Mongoose session and call `session.withTransaction`. Call `authPublic.provisionAccount`, create `HrEmployeeProfile` with `isProfileUpdated: false`, then call:

```js
await leaveRepository.ensureBalance(profile._id, new Date().getUTCFullYear(), 'ANNUAL', { session });
```

Write one `HR_STAFF_PROVISIONED` audit event and return a safe DTO. Mount:

```js
router.post('/staff-provisioning', authPublic.authenticate, requireEmployeeWrite, asyncHandler(employeeProfileController.provisionStaff));
```

- [ ] **Step 5: Verify success, conflicts, scope rejection, and rollback**

Run: `npm test -- src/test/auth/services/authAdmin.service.test.js src/test/hr/services/staffProvisioning.service.test.js src/test/hr/routes/employeeProfile.routes.test.js --runInBand`

Expected: PASS; duplicate code/email, inaccessible scope, invalid role, and balance failure leave no partial records.

- [ ] **Step 6: Commit**

```powershell
git add src/modules/auth/services/authAdmin.service.js src/modules/auth/public.js src/modules/hr/validators/employeeProfile.validator.js src/modules/hr/services/staffProvisioning.service.js src/modules/hr/controllers/employeeProfile.controller.js src/modules/hr/routes/index.js src/modules/hr/dtos/employeeProfile.dto.js src/test/auth/services/authAdmin.service.test.js src/test/hr/services/staffProvisioning.service.test.js src/test/hr/routes/employeeProfile.routes.test.js
git commit -m "feat(hr): provision staff atomically"
```

### Task 3: Staff-owned profile completion

**Files:**
- Modify: `src/modules/hr/validators/employeeProfile.validator.js`
- Modify: `src/modules/hr/services/employeeProfile.service.js`
- Modify: `src/modules/hr/controllers/employeeProfile.controller.js`
- Modify: `src/modules/hr/routes/index.js`
- Test: `src/test/hr/validators/employeeProfile.validator.test.js`
- Test: `src/test/hr/services/employeeProfile.service.test.js`
- Test: `src/test/hr/routes/employeeProfile.routes.test.js`

**Produces:** `PATCH /api/hr/employee-profiles/me/personal` and an own-profile DTO with `isProfileUpdated`.

- [ ] **Step 1: Write failing whitelist tests**

```js
test('staff completes only their own personal profile', async () => {
  const result = await service.completeOwnProfile(validPersonalPayload, staffAuth);
  expect(result.isProfileUpdated).toBe(true);
});

test('staff completion rejects company and compensation fields', async () => {
  await expect(service.completeOwnProfile({ departmentId, baseSalary: 1 }, staffAuth))
    .rejects.toMatchObject({ statusCode: 400 });
});
```

- [ ] **Step 2: Run failing self-profile tests**

Run: `npm test -- src/test/hr/validators/employeeProfile.validator.test.js src/test/hr/services/employeeProfile.service.test.js src/test/hr/routes/employeeProfile.routes.test.js --runInBand`

Expected: FAIL because the own-only command is absent.

- [ ] **Step 3: Implement a dedicated own-profile command**

Define `completeOwnProfileSchema` with only avatar, gender, birth date, phone, address, personal email, emergency contact, dependant details, identity/tax/social-insurance, and bank account. Require phone, address, personal email, and complete emergency contact.

Implement `completeOwnProfile(payload, authContext)` by resolving the profile only from `authContext.accountId`. It updates only whitelisted fields, sets `isProfileUpdated: true`, and audits changed field names without PII values. Do not call HR's `updateProfile` command.

- [ ] **Step 4: Mount before parameterized routes and verify**

```js
router.patch('/employee-profiles/me/personal', authPublic.authenticate, asyncHandler(employeeProfileController.completeMyProfile));
```

Run: `npm test -- src/test/hr/validators/employeeProfile.validator.test.js src/test/hr/services/employeeProfile.service.test.js src/test/hr/routes/employeeProfile.routes.test.js --runInBand`

Expected: PASS; a staff member cannot target another profile or submit HR fields.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/hr/validators/employeeProfile.validator.js src/modules/hr/services/employeeProfile.service.js src/modules/hr/controllers/employeeProfile.controller.js src/modules/hr/routes/index.js src/test/hr/validators/employeeProfile.validator.test.js src/test/hr/services/employeeProfile.service.test.js src/test/hr/routes/employeeProfile.routes.test.js
git commit -m "feat(hr): add self profile completion"
```

### Task 4: Server-side setup gate and regression suite

**Files:**
- Create: `src/modules/auth/middlewares/requireAccountSetupComplete.js`
- Modify: `src/modules/auth/public.js`
- Modify: protected module route composition files
- Test: `src/test/auth/routes/index.test.js`
- Test: `src/test/hr/routes/employeeProfile.routes.test.js`

**Produces:** `ACCOUNT_SETUP_REQUIRED` with `mustChangePassword` and `profileSetupRequired` details for protected business API calls.

- [ ] **Step 1: Write failing gate tests**

```js
test('blocks a pending account from HR business APIs', async () => {
  const response = await request(app).get('/api/hr/leave').set('Authorization', pendingPasswordToken);
  expect(response.status).toBe(403);
  expect(response.body.error.code).toBe('ACCOUNT_SETUP_REQUIRED');
});

test('allows personal completion while profile setup is pending', async () => {
  const response = await request(app).patch('/api/hr/employee-profiles/me/personal')
    .set('Authorization', pendingProfileToken).send(validPersonalPayload);
  expect(response.status).toBe(200);
});
```

- [ ] **Step 2: Run failing gate tests**

Run: `npm test -- src/test/auth/routes/index.test.js src/test/hr/routes/employeeProfile.routes.test.js --runInBand`

Expected: FAIL because authenticated pending accounts can use business routes.

- [ ] **Step 3: Implement one gate with an explicit allow-list**

Export `requireAccountSetupComplete` through `auth/public.js`. It permits only own password change, auth me/logout/refresh, own-profile read, and own-profile personal completion until both flags are clear. Mount it centrally after authentication for protected business modules instead of duplicating service checks.

- [ ] **Step 4: Run backend verification**

Run: `npm test -- src/test/auth src/test/hr --runInBand`

Expected: PASS; pending accounts cannot access protected business APIs.

- [ ] **Step 5: Commit**

```powershell
git add src/modules/auth/middlewares/requireAccountSetupComplete.js src/modules/auth/public.js src/test/auth/routes/index.test.js src/test/hr/routes/employeeProfile.routes.test.js
git commit -m "feat(auth): gate incomplete staff setup"
```
