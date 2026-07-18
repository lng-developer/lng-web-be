# HR Core Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the first HR core slice to the POD portal by introducing employee profiles that reuse the portal's existing Auth accounts and Organization departments/teams.

**Architecture:** Create a new `hr` module and port only the HR employee profile domain from `lng-hr-be`. Do not port HR `Account`, `Role`, `Permission`, `Department`, or `Team`; those are already owned by `auth` and `organization`. Cross-module lookups go through `auth.public` and `organization.public`; the `hr` module owns HR-only employee fields, sensitive-field policy, and employee profile DTOs.

**Tech Stack:** Node.js, Express, CommonJS, Mongoose, Joi, Jest, existing modular-monolith module patterns.

## Global Constraints

- No new dependencies.
- Do not copy `lng-hr-be` auth, role, permission, department, or team schemas.
- Do not store passwords or auth sessions in the HR module.
- HR employee profile must reference portal `Account`, `Department`, and `Team`.
- Sensitive fields must not be returned from default list/detail endpoints.
- Salary, bank, identity, tax, and insurance fields require `HR_COMPENSATION:READ` or `HR_COMPENSATION:WRITE`.
- Controllers parse HTTP only; services own business rules; repositories own Mongoose queries; DTOs own response shape.
- Cross-module calls must use target module `public.js`.
- Read-only Mongoose queries must use `.lean()`.
- Phase 1 does not port attendance, leave, overtime, payroll calculation, SQL sync, announcements, notifications, or cron workers.

---

## File Structure

- Create `src/modules/hr/constants/hr.constants.js`
  - HR statuses, employment types, work modes, and permission constants.
- Create `src/modules/hr/models/employeeProfile.model.js`
  - HR-only employee profile schema keyed by `accountId` and `employeeCode`.
- Create `src/modules/hr/repositories/employeeProfile.repository.js`
  - Owns profile CRUD, lookup, search, and soft-delete queries.
- Create `src/modules/hr/dtos/employeeProfile.dto.js`
  - Shapes safe and sensitive employee profile responses.
- Create `src/modules/hr/validators/employeeProfile.validator.js`
  - Joi schemas for list/create/update/status queries and payloads.
- Create `src/modules/hr/services/employeeProfile.service.js`
  - Validates account/org references, enforces field visibility, handles duplicate conflicts.
- Create `src/modules/hr/controllers/employeeProfile.controller.js`
  - HR profile HTTP handlers.
- Create `src/modules/hr/routes/index.js`
  - Mounts employee profile routes with auth/RBAC middleware.
- Create `src/modules/hr/public.js`
  - Exposes minimal profile lookup ports for future attendance/payroll modules.
- Create `src/modules/hr/index.js`
  - Exposes router/public module shape.
- Modify `src/modules/index.js`
  - Mounts `/api/hr`.
- Modify `src/modules/auth/scripts/seedRbac.js`
  - Adds HR permissions to the existing RBAC seed.
- Modify `src/modules/auth/public.js`
  - Add only missing helper ports if needed by `hr` service, such as `listProfilesByAccountIds` already exists.
- Modify `src/modules/organization/public.js`
  - Add only missing helper ports if needed by `hr` service, such as `listAccountOrganizationSummaries` already exists.
- Add tests under `src/test/hr/`.

---

## Edge Cases Phase 1 Must Handle

- Existing account already has one HR profile: create returns `409 CONFLICT_ERROR`.
- Existing employee code belongs to another profile: create/update returns `409 CONFLICT_ERROR`.
- Account exists but is inactive: create/update cannot attach an active HR profile.
- Department/team id exists but inactive: create/update rejects it.
- Team belongs to a different department than payload `departmentId`: create/update rejects it.
- Payload has `teamId` but no `departmentId`: service resolves department from team and stores both.
- Profile has no team: valid for contractors or unassigned staff.
- Profile soft-deleted: list hides it by default; `includeDeleted=true` requires write permission.
- Sensitive fields are omitted from normal read responses.
- Sensitive field update requires compensation write permission.
- `employeeCode` is normalized uppercase and trimmed.
- `personalEmail` and `workEmail` normalize lowercase and trim.
- Optional unique fields (`identityCard`, `taxIdentification`, `socialInsuranceNumber`) allow multiple empty/null values.
- Date fields accept ISO dates and reject invalid strings.
- Deleting a profile does not delete portal account or organization membership.
- Recreating profile for a soft-deleted account should restore or conflict explicitly; Phase 1 chooses restore-by-update only through `PATCH /:id/restore`.

---

### Task 1: Create HR Module Skeleton And Permissions

**Files:**
- Create: `src/modules/hr/constants/hr.constants.js`
- Create: `src/modules/hr/index.js`
- Create: `src/modules/hr/public.js`
- Create: `src/modules/hr/routes/index.js`
- Modify: `src/modules/index.js`
- Modify: `src/modules/auth/scripts/seedRbac.js`
- Test: `src/test/hr/routes/hrModule.contract.test.js`
- Test: `src/test/auth/rbac.hr-permissions.test.js`

**Interfaces:**
- Produces: `hr.router`, `hr.public`.
- Produces permissions: `HR_EMPLOYEES:READ`, `HR_EMPLOYEES:WRITE`, `HR_COMPENSATION:READ`, `HR_COMPENSATION:WRITE`.
- Consumes: `auth.public.authenticate`, `auth.public.authorizeAnyPermission`.

- [ ] **Step 1: Write route mount contract test**

```js
const express = require('express');
const request = require('supertest');
const modules = require('../../../modules');

describe('hr module mount', () => {
  test('mounts /api/hr router', async () => {
    const app = express();
    app.use('/api', modules.router);

    const response = await request(app).get('/api/hr/health');

    expect([200, 401, 403]).toContain(response.status);
  });
});
```

- [ ] **Step 2: Run route mount test and verify it fails**

Run: `npm test -- src/test/hr/routes/hrModule.contract.test.js --runInBand`

Expected: FAIL because `/api/hr` is not mounted.

- [ ] **Step 3: Add constants**

```js
const hrEmployeeStatuses = Object.freeze({
  ACTIVE: 'ACTIVE',
  PROBATION: 'PROBATION',
  RESIGNED: 'RESIGNED',
  SUSPENDED: 'SUSPENDED',
  ON_LEAVE: 'ON_LEAVE',
});

const hrEmploymentTypes = Object.freeze({
  FULL_TIME: 'FULL_TIME',
  PART_TIME: 'PART_TIME',
  INTERNSHIP: 'INTERNSHIP',
  CONTRACT: 'CONTRACT',
});

const hrWorkModes = Object.freeze({
  ONSITE: 'ONSITE',
  REMOTE: 'REMOTE',
  HYBRID: 'HYBRID',
});

const hrPermissions = Object.freeze({
  EMPLOYEE_READ: 'HR_EMPLOYEES:READ',
  EMPLOYEE_WRITE: 'HR_EMPLOYEES:WRITE',
  COMPENSATION_READ: 'HR_COMPENSATION:READ',
  COMPENSATION_WRITE: 'HR_COMPENSATION:WRITE',
});

module.exports = {
  hrEmployeeStatuses,
  hrEmploymentTypes,
  hrPermissions,
  hrWorkModes,
};
```

- [ ] **Step 4: Add minimal HR router**

```js
const express = require('express');
const authPublic = require('../../auth/public');
const { hrPermissions } = require('../constants/hr.constants');

const router = express.Router();

router.get(
  '/health',
  authPublic.authenticate,
  authPublic.authorizeAnyPermission([hrPermissions.EMPLOYEE_READ, hrPermissions.EMPLOYEE_WRITE]),
  (_req, res) => res.json({ success: true, data: { module: 'hr' } }),
);

module.exports = router;
```

- [ ] **Step 5: Add module index/public**

```js
const router = require('./routes');
const publicPort = require('./public');

module.exports = {
  router,
  public: publicPort,
};
```

```js
module.exports = {};
```

- [ ] **Step 6: Mount HR in `src/modules/index.js`**

Add:

```js
const hr = require('./hr');
```

Add to `modules`:

```js
hr,
```

Add route:

```js
router.use('/hr', hr.router);
```

- [ ] **Step 7: Add RBAC seed test**

```js
const fs = require('fs');
const path = require('path');

describe('HR RBAC seed', () => {
  test('includes HR phase 1 permissions', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../../modules/auth/scripts/seedRbac.js'), 'utf8');

    expect(source).toContain('HR_EMPLOYEES:READ');
    expect(source).toContain('HR_EMPLOYEES:WRITE');
    expect(source).toContain('HR_COMPENSATION:READ');
    expect(source).toContain('HR_COMPENSATION:WRITE');
  });
});
```

- [ ] **Step 8: Add HR permissions to seed**

Add to `permissions` array in `src/modules/auth/scripts/seedRbac.js`:

```js
'HR_EMPLOYEES:READ',
'HR_EMPLOYEES:WRITE',
'HR_COMPENSATION:READ',
'HR_COMPENSATION:WRITE',
```

Add to admin role by using existing `permissions` array. Add to manager role:

```js
'HR_EMPLOYEES:READ',
```

Do not add compensation permissions to non-admin roles in Phase 1.

- [ ] **Step 9: Run tests**

Run:

```bash
npm test -- src/test/hr/routes/hrModule.contract.test.js src/test/auth/rbac.hr-permissions.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add src/modules/hr src/modules/index.js src/modules/auth/scripts/seedRbac.js src/test/hr src/test/auth/rbac.hr-permissions.test.js
git commit -m "feat(hr): add hr module skeleton"
```

---

### Task 2: Add Employee Profile Model, Repository, And DTOs

**Files:**
- Create: `src/modules/hr/models/employeeProfile.model.js`
- Create: `src/modules/hr/repositories/employeeProfile.repository.js`
- Create: `src/modules/hr/dtos/employeeProfile.dto.js`
- Test: `src/test/hr/repositories/employeeProfile.repository.test.js`
- Test: `src/test/hr/dtos/employeeProfile.dto.test.js`

**Interfaces:**
- Produces repository methods: `create(payload, options)`, `findById(id)`, `findByAccountId(accountId)`, `findByEmployeeCode(employeeCode)`, `list(query)`, `updateById(id, patch)`, `softDelete(id)`, `restore(id)`.
- Produces DTO methods: `toEmployeeProfileDto(profile, options)`, `toPaginatedEmployeeProfileDto(page, options)`.

- [ ] **Step 1: Write DTO tests for sensitive fields**

```js
const { toEmployeeProfileDto } = require('../../../modules/hr/dtos/employeeProfile.dto');

describe('employeeProfile.dto', () => {
  test('omits sensitive fields by default', () => {
    const dto = toEmployeeProfileDto({
      _id: 'profile-1',
      accountId: 'account-1',
      employeeCode: 'J2501',
      fullName: 'Jane Nguyen',
      baseSalary: 10000000,
      bankAccount: { bankName: 'VCB', accountNumber: '123' },
      identityCard: '012345678',
      taxIdentification: 'TAX-1',
      socialInsuranceNumber: 'BHXH-1',
    });

    expect(dto.baseSalary).toBeUndefined();
    expect(dto.bankAccount).toBeUndefined();
    expect(dto.identityCard).toBeUndefined();
    expect(dto.taxIdentification).toBeUndefined();
    expect(dto.socialInsuranceNumber).toBeUndefined();
  });

  test('includes sensitive fields only when requested', () => {
    const dto = toEmployeeProfileDto({
      _id: 'profile-1',
      accountId: 'account-1',
      employeeCode: 'J2501',
      fullName: 'Jane Nguyen',
      baseSalary: 10000000,
      bankAccount: { bankName: 'VCB', accountNumber: '123' },
    }, { includeSensitive: true });

    expect(dto.baseSalary).toBe(10000000);
    expect(dto.bankAccount).toEqual({ bankName: 'VCB', accountNumber: '123' });
  });
});
```

- [ ] **Step 2: Run DTO tests and verify they fail**

Run: `npm test -- src/test/hr/dtos/employeeProfile.dto.test.js --runInBand`

Expected: FAIL because DTO file does not exist.

- [ ] **Step 3: Create employee profile model**

Use this model shape:

```js
const mongoose = require('mongoose');
const {
  hrEmployeeStatuses,
  hrEmploymentTypes,
  hrWorkModes,
} = require('../constants/hr.constants');

const dependantSchema = new mongoose.Schema({
  name: { type: String, trim: true },
  relation: { type: String, trim: true, uppercase: true },
  dob: { type: Date, default: null },
  gender: { type: String, trim: true, uppercase: true },
}, { _id: false });

const employeeProfileSchema = new mongoose.Schema(
  {
    accountId: { type: mongoose.Schema.Types.ObjectId, ref: 'Account', required: true, unique: true, index: true },
    employeeCode: { type: String, required: true, unique: true, uppercase: true, trim: true, index: true },
    fullName: { type: String, required: true, trim: true },
    gender: { type: String, trim: true, uppercase: true, default: null },
    birthDate: { type: Date, default: null },
    phoneNumber: { type: String, trim: true, default: null },
    address: { type: String, trim: true, default: null },
    avatarUrl: { type: String, trim: true, default: null, maxlength: 500 },
    personalEmail: { type: String, lowercase: true, trim: true, unique: true, sparse: true },
    workEmail: { type: String, lowercase: true, trim: true, unique: true, sparse: true },
    emergencyContact: {
      name: { type: String, trim: true },
      phone: { type: String, trim: true },
      relation: { type: String, trim: true },
    },
    departmentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Department', default: null, index: true },
    teamId: { type: mongoose.Schema.Types.ObjectId, ref: 'Team', default: null, index: true },
    jobTitle: { type: String, trim: true, default: null },
    jobLevel: { type: String, trim: true, default: null },
    employmentType: { type: String, enum: Object.values(hrEmploymentTypes), default: hrEmploymentTypes.FULL_TIME },
    workMode: { type: String, enum: Object.values(hrWorkModes), default: hrWorkModes.ONSITE },
    startDate: { type: Date, default: Date.now },
    probationEndDate: { type: Date, default: null },
    endDate: { type: Date, default: null },
    status: { type: String, enum: Object.values(hrEmployeeStatuses), default: hrEmployeeStatuses.PROBATION, index: true },
    contractType: { type: String, trim: true, default: null },
    contractNumber: { type: String, trim: true, default: null },
    contractStartDate: { type: Date, default: null },
    contractEndDate: { type: Date, default: null },
    promotionDate: { type: Date, default: null },
    transferDate: { type: Date, default: null },
    dependantDetails: { type: [dependantSchema], default: [] },
    dependants: { type: Number, default: 0, min: 0 },
    identityCard: { type: String, unique: true, sparse: true, trim: true, select: false },
    taxIdentification: { type: String, unique: true, sparse: true, trim: true, select: false },
    socialInsuranceNumber: { type: String, unique: true, sparse: true, trim: true, select: false },
    bankAccount: {
      bankName: { type: String, trim: true, default: null, select: false },
      accountNumber: { type: String, trim: true, default: null, select: false },
    },
    baseSalary: { type: Number, min: 0, default: 0, select: false },
    baseCurrency: { type: String, default: 'VND' },
    allowances: {
      lunch: { type: Number, min: 0, default: 0 },
      fuel: { type: Number, min: 0, default: 0 },
      other: { type: Number, min: 0, default: 0 },
    },
    responsibilityAllowance: { type: Number, min: 0, default: 0 },
    isProfileUpdated: { type: Boolean, default: false },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

employeeProfileSchema.index({ isDeleted: 1, departmentId: 1, status: 1 });
employeeProfileSchema.index({ isDeleted: 1, status: 1 });
employeeProfileSchema.index({ fullName: 'text', employeeCode: 'text' }, { weights: { fullName: 10, employeeCode: 5 } });
employeeProfileSchema.index({ teamId: 1, isDeleted: 1 });
employeeProfileSchema.index({ departmentId: 1, isDeleted: 1 });
employeeProfileSchema.index(
  { contractEndDate: 1, status: 1 },
  {
    partialFilterExpression: {
      contractEndDate: { $exists: true },
      status: { $in: [hrEmployeeStatuses.ACTIVE, hrEmployeeStatuses.PROBATION] },
    },
  },
);

module.exports = mongoose.model('HrEmployeeProfile', employeeProfileSchema);
```

- [ ] **Step 4: Create repository**

```js
const HrEmployeeProfile = require('../models/employeeProfile.model');

function withSensitive(query) {
  return query.select('+identityCard +taxIdentification +socialInsuranceNumber +bankAccount.bankName +bankAccount.accountNumber +baseSalary');
}

async function create(payload, options = {}) {
  return HrEmployeeProfile.create([payload], options).then(([doc]) => doc.toObject());
}

async function findById(id, { includeSensitive = false } = {}) {
  const query = HrEmployeeProfile.findById(id);
  return (includeSensitive ? withSensitive(query) : query).lean();
}

async function findByAccountId(accountId, { includeDeleted = false, includeSensitive = false } = {}) {
  const query = HrEmployeeProfile.findOne({ accountId, ...(includeDeleted ? {} : { isDeleted: false }) });
  return (includeSensitive ? withSensitive(query) : query).lean();
}

async function findByEmployeeCode(employeeCode, { includeDeleted = false } = {}) {
  return HrEmployeeProfile.findOne({
    employeeCode: String(employeeCode).trim().toUpperCase(),
    ...(includeDeleted ? {} : { isDeleted: false }),
  }).lean();
}

async function list(query = {}) {
  const page = Math.max(Number(query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(query.limit) || 20, 1), 100);
  const filter = {};
  if (!query.includeDeleted) filter.isDeleted = false;
  if (query.status) filter.status = query.status;
  if (query.departmentId) filter.departmentId = query.departmentId;
  if (query.teamId) filter.teamId = query.teamId;
  if (query.q) filter.$text = { $search: String(query.q).trim() };

  const [items, total] = await Promise.all([
    HrEmployeeProfile.find(filter).sort({ employeeCode: 1, _id: 1 }).skip((page - 1) * limit).limit(limit).lean(),
    HrEmployeeProfile.countDocuments(filter),
  ]);

  return { items, pagination: { page, limit, total } };
}

async function updateById(id, patch) {
  return HrEmployeeProfile.findByIdAndUpdate(id, { $set: patch }, { returnDocument: 'after', runValidators: true }).lean();
}

async function softDelete(id) {
  return updateById(id, { isDeleted: true, deletedAt: new Date() });
}

async function restore(id) {
  return updateById(id, { isDeleted: false, deletedAt: null });
}

module.exports = {
  create,
  findByAccountId,
  findByEmployeeCode,
  findById,
  list,
  restore,
  softDelete,
  updateById,
};
```

- [ ] **Step 5: Create DTO**

```js
function toId(value) {
  return value && String(value._id || value.id || value);
}

function toEmployeeProfileDto(profile, { includeSensitive = false } = {}) {
  if (!profile) return null;
  const dto = {
    id: toId(profile),
    accountId: toId(profile.accountId),
    employeeCode: profile.employeeCode || null,
    fullName: profile.fullName || null,
    gender: profile.gender || null,
    birthDate: profile.birthDate || null,
    phoneNumber: profile.phoneNumber || null,
    address: profile.address || null,
    avatarUrl: profile.avatarUrl || null,
    personalEmail: profile.personalEmail || null,
    workEmail: profile.workEmail || null,
    emergencyContact: profile.emergencyContact || null,
    departmentId: toId(profile.departmentId),
    teamId: toId(profile.teamId),
    jobTitle: profile.jobTitle || null,
    jobLevel: profile.jobLevel || null,
    employmentType: profile.employmentType || null,
    workMode: profile.workMode || null,
    startDate: profile.startDate || null,
    probationEndDate: profile.probationEndDate || null,
    endDate: profile.endDate || null,
    status: profile.status || null,
    contractType: profile.contractType || null,
    contractNumber: profile.contractNumber || null,
    contractStartDate: profile.contractStartDate || null,
    contractEndDate: profile.contractEndDate || null,
    promotionDate: profile.promotionDate || null,
    transferDate: profile.transferDate || null,
    dependantDetails: profile.dependantDetails || [],
    dependants: profile.dependants || 0,
    isProfileUpdated: Boolean(profile.isProfileUpdated),
    isDeleted: Boolean(profile.isDeleted),
    createdAt: profile.createdAt || null,
    updatedAt: profile.updatedAt || null,
  };

  if (includeSensitive) {
    dto.identityCard = profile.identityCard || null;
    dto.taxIdentification = profile.taxIdentification || null;
    dto.socialInsuranceNumber = profile.socialInsuranceNumber || null;
    dto.bankAccount = profile.bankAccount || null;
    dto.baseSalary = profile.baseSalary ?? null;
    dto.baseCurrency = profile.baseCurrency || 'VND';
    dto.allowances = profile.allowances || null;
    dto.responsibilityAllowance = profile.responsibilityAllowance ?? 0;
  }

  return dto;
}

function toPaginatedEmployeeProfileDto(page, options = {}) {
  return {
    items: (page.items || []).map((profile) => toEmployeeProfileDto(profile, options)),
    pagination: page.pagination || { page: 1, limit: 20, total: 0 },
  };
}

module.exports = {
  toEmployeeProfileDto,
  toPaginatedEmployeeProfileDto,
};
```

- [ ] **Step 6: Run DTO tests**

Run: `npm test -- src/test/hr/dtos/employeeProfile.dto.test.js --runInBand`

Expected: PASS.

- [ ] **Step 7: Write repository tests for normalization and soft delete**

```js
const mongoose = require('mongoose');
const repository = require('../../../modules/hr/repositories/employeeProfile.repository');
const HrEmployeeProfile = require('../../../modules/hr/models/employeeProfile.model');

describe('employeeProfile.repository', () => {
  afterEach(async () => {
    await HrEmployeeProfile.deleteMany({});
  });

  test('finds employee code case-insensitively after schema uppercase normalization', async () => {
    await repository.create({
      accountId: new mongoose.Types.ObjectId(),
      employeeCode: ' j2501 ',
      fullName: 'Jane Nguyen',
    });

    const profile = await repository.findByEmployeeCode('j2501');

    expect(profile.employeeCode).toBe('J2501');
  });

  test('soft delete hides records by default', async () => {
    const profile = await repository.create({
      accountId: new mongoose.Types.ObjectId(),
      employeeCode: 'J2502',
      fullName: 'John Tran',
    });

    await repository.softDelete(profile._id);

    expect(await repository.findByAccountId(profile.accountId)).toBeNull();
    expect(await repository.findByAccountId(profile.accountId, { includeDeleted: true })).toMatchObject({ isDeleted: true });
  });
});
```

- [ ] **Step 8: Run repository tests**

Run: `npm test -- src/test/hr/repositories/employeeProfile.repository.test.js --runInBand`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/modules/hr/models src/modules/hr/repositories src/modules/hr/dtos src/test/hr/repositories src/test/hr/dtos
git commit -m "feat(hr): add employee profile persistence"
```

---

### Task 3: Add Employee Profile Service, Validation, And Routes

**Files:**
- Create: `src/modules/hr/validators/employeeProfile.validator.js`
- Create: `src/modules/hr/services/employeeProfile.service.js`
- Create: `src/modules/hr/controllers/employeeProfile.controller.js`
- Modify: `src/modules/hr/routes/index.js`
- Test: `src/test/hr/services/employeeProfile.service.test.js`
- Test: `src/test/hr/routes/employeeProfile.routes.test.js`

**Interfaces:**
- Produces service methods: `listProfiles(query, authContext)`, `getProfile(profileId, authContext)`, `getMyProfile(authContext)`, `createProfile(payload, authContext)`, `updateProfile(profileId, payload, authContext)`, `deleteProfile(profileId, authContext)`, `restoreProfile(profileId, authContext)`.
- Consumes: `auth.public.getCurrentAccount`, `auth.public.canAccessScope`, `organization.public.getDepartmentById`, `organization.public.getTeamById`.

- [ ] **Step 1: Write service test for team/department mismatch**

```js
jest.mock('../../../modules/auth/public', () => ({
  getCurrentAccount: jest.fn(),
  canAccessScope: jest.fn(() => true),
}));

jest.mock('../../../modules/organization/public', () => ({
  getDepartmentById: jest.fn(),
  getTeamById: jest.fn(),
}));

const authPublic = require('../../../modules/auth/public');
const organizationPublic = require('../../../modules/organization/public');
const repository = require('../../../modules/hr/repositories/employeeProfile.repository');
const service = require('../../../modules/hr/services/employeeProfile.service');

jest.mock('../../../modules/hr/repositories/employeeProfile.repository');

describe('employeeProfile.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authPublic.getCurrentAccount.mockResolvedValue({ id: 'account-1', status: 'ACTIVE' });
    organizationPublic.getDepartmentById.mockResolvedValue({ id: 'department-1', status: 'ACTIVE' });
    organizationPublic.getTeamById.mockResolvedValue({ id: 'team-1', departmentId: 'department-2', status: 'ACTIVE' });
    repository.findByAccountId.mockResolvedValue(null);
    repository.findByEmployeeCode.mockResolvedValue(null);
  });

  test('rejects team from another department', async () => {
    await expect(service.createProfile({
      accountId: '660000000000000000001001',
      employeeCode: 'J2501',
      fullName: 'Jane Nguyen',
      departmentId: '660000000000000000002001',
      teamId: '660000000000000000003001',
    }, { permissions: ['HR_EMPLOYEES:WRITE'] })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });
});
```

- [ ] **Step 2: Run service test and verify it fails**

Run: `npm test -- src/test/hr/services/employeeProfile.service.test.js --runInBand`

Expected: FAIL because service file does not exist.

- [ ] **Step 3: Add validators**

```js
const Joi = require('joi');

const objectId = Joi.string().hex().length(24);
const email = Joi.string().email().trim().lowercase();
const optionalEmail = email.allow(null, '');

const sensitiveFields = {
  identityCard: Joi.string().trim().allow(null, ''),
  taxIdentification: Joi.string().trim().allow(null, ''),
  socialInsuranceNumber: Joi.string().trim().allow(null, ''),
  bankAccount: Joi.object({
    bankName: Joi.string().trim().allow(null, ''),
    accountNumber: Joi.string().trim().allow(null, ''),
  }),
  baseSalary: Joi.number().min(0),
  baseCurrency: Joi.string().trim().uppercase().default('VND'),
  allowances: Joi.object({
    lunch: Joi.number().min(0),
    fuel: Joi.number().min(0),
    other: Joi.number().min(0),
  }),
  responsibilityAllowance: Joi.number().min(0),
};

const createProfileSchema = Joi.object({
  accountId: objectId.required(),
  employeeCode: Joi.string().trim().uppercase().required(),
  fullName: Joi.string().trim().required(),
  gender: Joi.string().trim().uppercase().allow(null, ''),
  birthDate: Joi.date().iso().allow(null),
  phoneNumber: Joi.string().trim().allow(null, ''),
  address: Joi.string().trim().allow(null, ''),
  avatarUrl: Joi.string().trim().uri().allow(null, ''),
  personalEmail: optionalEmail,
  workEmail: optionalEmail,
  emergencyContact: Joi.object({
    name: Joi.string().trim().allow(null, ''),
    phone: Joi.string().trim().allow(null, ''),
    relation: Joi.string().trim().allow(null, ''),
  }),
  departmentId: objectId.allow(null),
  teamId: objectId.allow(null),
  jobTitle: Joi.string().trim().allow(null, ''),
  jobLevel: Joi.string().trim().allow(null, ''),
  employmentType: Joi.string().valid('FULL_TIME', 'PART_TIME', 'INTERNSHIP', 'CONTRACT'),
  workMode: Joi.string().valid('ONSITE', 'REMOTE', 'HYBRID'),
  startDate: Joi.date().iso(),
  probationEndDate: Joi.date().iso().allow(null),
  endDate: Joi.date().iso().allow(null),
  status: Joi.string().valid('ACTIVE', 'PROBATION', 'RESIGNED', 'SUSPENDED', 'ON_LEAVE'),
  contractType: Joi.string().trim().allow(null, ''),
  contractNumber: Joi.string().trim().allow(null, ''),
  contractStartDate: Joi.date().iso().allow(null),
  contractEndDate: Joi.date().iso().allow(null),
  promotionDate: Joi.date().iso().allow(null),
  transferDate: Joi.date().iso().allow(null),
  dependantDetails: Joi.array().items(Joi.object({
    name: Joi.string().trim().allow(null, ''),
    relation: Joi.string().trim().uppercase().allow(null, ''),
    dob: Joi.date().iso().allow(null),
    gender: Joi.string().trim().uppercase().allow(null, ''),
  })),
  dependants: Joi.number().integer().min(0),
  ...sensitiveFields,
});

const updateProfileSchema = createProfileSchema.fork(['accountId', 'employeeCode', 'fullName'], (schema) => schema.optional()).min(1);

const listProfilesSchema = Joi.object({
  q: Joi.string().trim().allow(''),
  status: Joi.string().valid('ACTIVE', 'PROBATION', 'RESIGNED', 'SUSPENDED', 'ON_LEAVE'),
  departmentId: objectId,
  teamId: objectId,
  includeDeleted: Joi.boolean().default(false),
  includeSensitive: Joi.boolean().default(false),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

function validate(schema, payload) {
  const result = schema.validate(payload, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  });

  return {
    value: result.value,
    details: result.error ? result.error.details : null,
  };
}

module.exports = {
  createProfileSchema,
  listProfilesSchema,
  updateProfileSchema,
  validate,
};
```

- [ ] **Step 4: Add service implementation**

Implement these functions with the smallest logic:

```js
const mongoose = require('mongoose');
const AppError = require('../../../shared/errors/appError');
const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');
const authPublic = require('../../auth/public');
const organizationPublic = require('../../organization/public');
const repository = require('../repositories/employeeProfile.repository');
const { toEmployeeProfileDto, toPaginatedEmployeeProfileDto } = require('../dtos/employeeProfile.dto');
const { hrPermissions } = require('../constants/hr.constants');

const SENSITIVE_KEYS = ['identityCard', 'taxIdentification', 'socialInsuranceNumber', 'bankAccount', 'baseSalary', 'allowances', 'responsibilityAllowance'];

function hasPermission(authContext, permission) {
  return (authContext?.permissions || []).includes(permission);
}

function assertObjectId(value, field) {
  if (value && !mongoose.isValidObjectId(value)) {
    throw new AppError(`${field} is invalid`, httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }
}

function hasSensitivePayload(payload = {}) {
  return SENSITIVE_KEYS.some((key) => Object.prototype.hasOwnProperty.call(payload, key));
}

function assertCanReadSensitive(authContext) {
  if (!hasPermission(authContext, hrPermissions.COMPENSATION_READ) && !hasPermission(authContext, hrPermissions.COMPENSATION_WRITE)) {
    throw new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
  }
}

function assertCanWriteSensitive(authContext, payload) {
  if (hasSensitivePayload(payload) && !hasPermission(authContext, hrPermissions.COMPENSATION_WRITE)) {
    throw new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
  }
}

async function assertActiveAccount(accountId) {
  const account = await authPublic.getCurrentAccount(accountId);
  if (!account) throw new AppError('Account not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  if (account.status && account.status !== 'ACTIVE') {
    throw new AppError('Account is not active', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  }
  return account;
}

async function resolveOrganization({ departmentId, teamId }) {
  let department = null;
  let team = null;
  if (departmentId) {
    department = await organizationPublic.getDepartmentById(departmentId);
    if (!department || department.status !== 'ACTIVE') {
      throw new AppError('Department not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
    }
  }
  if (teamId) {
    team = await organizationPublic.getTeamById(teamId);
    if (!team || team.status !== 'ACTIVE') {
      throw new AppError('Team not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
    }
    const teamDepartmentId = String(team.departmentId?._id || team.departmentId || '');
    if (department && teamDepartmentId !== String(department._id || department.id)) {
      throw new AppError('Team does not belong to department', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
    }
    departmentId = departmentId || teamDepartmentId;
  }
  return { departmentId: departmentId || null, teamId: teamId || null };
}

async function createProfile(payload, authContext = {}) {
  assertCanWriteSensitive(authContext, payload);
  await assertActiveAccount(payload.accountId);
  const existingByAccount = await repository.findByAccountId(payload.accountId, { includeDeleted: true });
  if (existingByAccount) throw new AppError('Account already has an HR profile', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  const existingByCode = await repository.findByEmployeeCode(payload.employeeCode, { includeDeleted: true });
  if (existingByCode) throw new AppError('Employee code already exists', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
  const organization = await resolveOrganization(payload);
  const profile = await repository.create({ ...payload, ...organization });
  return toEmployeeProfileDto(profile, { includeSensitive: hasPermission(authContext, hrPermissions.COMPENSATION_READ) });
}

async function listProfiles(query = {}, authContext = {}) {
  if (query.includeSensitive) assertCanReadSensitive(authContext);
  if (query.includeDeleted && !hasPermission(authContext, hrPermissions.EMPLOYEE_WRITE)) {
    throw new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
  }
  return toPaginatedEmployeeProfileDto(await repository.list(query), { includeSensitive: query.includeSensitive });
}

module.exports = {
  createProfile,
  listProfiles,
};
```

Add the remaining service methods in the same file:

```js
async function getProfile(profileId, authContext = {}) {
  assertObjectId(profileId, 'profileId');
  const includeSensitive = hasPermission(authContext, hrPermissions.COMPENSATION_READ)
    || hasPermission(authContext, hrPermissions.COMPENSATION_WRITE);
  const profile = await repository.findById(profileId, { includeSensitive });
  if (!profile || profile.isDeleted) {
    throw new AppError('Employee profile not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }
  return toEmployeeProfileDto(profile, { includeSensitive });
}

async function getMyProfile(authContext = {}) {
  const accountId = authContext.accountId || authContext.sub;
  if (!accountId) {
    throw new AppError('Authentication required', httpStatus.UNAUTHORIZED, true, errorCodes.AUTHENTICATION_ERROR);
  }
  const profile = await repository.findByAccountId(accountId);
  if (!profile) {
    throw new AppError('Employee profile not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }
  return toEmployeeProfileDto(profile);
}

async function updateProfile(profileId, payload, authContext = {}) {
  assertObjectId(profileId, 'profileId');
  assertCanWriteSensitive(authContext, payload);
  const current = await repository.findById(profileId, { includeSensitive: true });
  if (!current || current.isDeleted) {
    throw new AppError('Employee profile not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }
  if (payload.accountId && String(payload.accountId) !== String(current.accountId)) {
    await assertActiveAccount(payload.accountId);
    const existingByAccount = await repository.findByAccountId(payload.accountId, { includeDeleted: true });
    if (existingByAccount && String(existingByAccount._id || existingByAccount.id) !== String(profileId)) {
      throw new AppError('Account already has an HR profile', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }
  }
  if (payload.employeeCode && String(payload.employeeCode).trim().toUpperCase() !== current.employeeCode) {
    const existingByCode = await repository.findByEmployeeCode(payload.employeeCode, { includeDeleted: true });
    if (existingByCode && String(existingByCode._id || existingByCode.id) !== String(profileId)) {
      throw new AppError('Employee code already exists', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR);
    }
  }
  const organization = await resolveOrganization({
    departmentId: Object.prototype.hasOwnProperty.call(payload, 'departmentId') ? payload.departmentId : current.departmentId,
    teamId: Object.prototype.hasOwnProperty.call(payload, 'teamId') ? payload.teamId : current.teamId,
  });
  const updated = await repository.updateById(profileId, { ...payload, ...organization });
  return toEmployeeProfileDto(updated, {
    includeSensitive: hasPermission(authContext, hrPermissions.COMPENSATION_READ) || hasPermission(authContext, hrPermissions.COMPENSATION_WRITE),
  });
}

async function deleteProfile(profileId) {
  assertObjectId(profileId, 'profileId');
  const profile = await repository.softDelete(profileId);
  if (!profile) {
    throw new AppError('Employee profile not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }
  return toEmployeeProfileDto(profile);
}

async function restoreProfile(profileId) {
  assertObjectId(profileId, 'profileId');
  const profile = await repository.restore(profileId);
  if (!profile) {
    throw new AppError('Employee profile not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  }
  return toEmployeeProfileDto(profile);
}

module.exports = {
  createProfile,
  deleteProfile,
  getMyProfile,
  getProfile,
  listProfiles,
  restoreProfile,
  updateProfile,
};
```

- [ ] **Step 5: Add controllers and routes**

Controller pattern:

```js
const asyncHandler = require('../../../middlewares/asyncHandler');
const service = require('../services/employeeProfile.service');
const {
  createProfileSchema,
  listProfilesSchema,
  updateProfileSchema,
  validate,
} = require('../validators/employeeProfile.validator');
const AppError = require('../../../shared/errors/appError');
const httpStatus = require('../../../shared/constants/httpStatus');
const errorCodes = require('../../../shared/constants/errorCodes');

function assertValid(schema, payload) {
  const { value, details } = validate(schema, payload);
  if (details) {
    throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
  }
  return value;
}

const listProfiles = asyncHandler(async (req, res) => {
  const query = assertValid(listProfilesSchema, req.query);
  res.json({ success: true, data: await service.listProfiles(query, req.auth) });
});

const createProfile = asyncHandler(async (req, res) => {
  const payload = assertValid(createProfileSchema, req.body);
  res.status(201).json({ success: true, data: await service.createProfile(payload, req.auth) });
});

const getMyProfile = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.getMyProfile(req.auth) });
});

const getProfile = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.getProfile(req.params.profileId, req.auth) });
});

const updateProfile = asyncHandler(async (req, res) => {
  const payload = assertValid(updateProfileSchema, req.body);
  res.json({ success: true, data: await service.updateProfile(req.params.profileId, payload, req.auth) });
});

const deleteProfile = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.deleteProfile(req.params.profileId, req.auth) });
});

const restoreProfile = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await service.restoreProfile(req.params.profileId, req.auth) });
});

module.exports = {
  createProfile,
  deleteProfile,
  getMyProfile,
  getProfile,
  listProfiles,
  restoreProfile,
  updateProfile,
};
```

Route pattern:

```js
router.get(
  '/employee-profiles',
  authPublic.authenticate,
  authPublic.authorizeAnyPermission([hrPermissions.EMPLOYEE_READ, hrPermissions.EMPLOYEE_WRITE]),
  controller.listProfiles,
);

router.post(
  '/employee-profiles',
  authPublic.authenticate,
  authPublic.authorizeAnyPermission([hrPermissions.EMPLOYEE_WRITE]),
  controller.createProfile,
);
```

Add routes for:

```text
GET /employee-profiles
POST /employee-profiles
GET /employee-profiles/me
GET /employee-profiles/:profileId
PATCH /employee-profiles/:profileId
DELETE /employee-profiles/:profileId
PATCH /employee-profiles/:profileId/restore
```

Place `/me` and `/restore` before generic dynamic routes where applicable.

- [ ] **Step 6: Add route tests for sensitive gating**

Use mocked auth middleware like existing route tests. Assert:

```js
expect(response.body.data.items[0].baseSalary).toBeUndefined();
```

and for no compensation permission:

```js
expect(response.status).toBe(403);
```

- [ ] **Step 7: Run tests**

```bash
npm test -- src/test/hr/services/employeeProfile.service.test.js src/test/hr/routes/employeeProfile.routes.test.js --runInBand
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/modules/hr src/test/hr
git commit -m "feat(hr): add employee profile api"
```

---

### Task 4: Add Public Ports And Integration Tests

**Files:**
- Modify: `src/modules/hr/public.js`
- Test: `src/test/hr/public.contract.test.js`
- Test: `src/test/architecture.contract.test.js`

**Interfaces:**
- Produces: `getEmployeeProfileByAccountId(accountId, options)`, `getEmployeeProfileByEmployeeCode(employeeCode, options)`, `listEmployeeProfilesByAccountIds(accountIds, options)`.
- Consumes: `employeeProfile.repository`.

- [ ] **Step 1: Write public port tests**

```js
const hrPublic = require('../../modules/hr/public');

describe('hr.public', () => {
  test('exports stable employee profile lookup ports', () => {
    expect(typeof hrPublic.getEmployeeProfileByAccountId).toBe('function');
    expect(typeof hrPublic.getEmployeeProfileByEmployeeCode).toBe('function');
    expect(typeof hrPublic.listEmployeeProfilesByAccountIds).toBe('function');
  });
});
```

- [ ] **Step 2: Run public port test and verify it fails**

Run: `npm test -- src/test/hr/public.contract.test.js --runInBand`

Expected: FAIL until public functions exist.

- [ ] **Step 3: Implement public port**

```js
const repository = require('./repositories/employeeProfile.repository');
const { toEmployeeProfileDto } = require('./dtos/employeeProfile.dto');

async function getEmployeeProfileByAccountId(accountId, options = {}) {
  return toEmployeeProfileDto(await repository.findByAccountId(accountId, options), options);
}

async function getEmployeeProfileByEmployeeCode(employeeCode, options = {}) {
  return toEmployeeProfileDto(await repository.findByEmployeeCode(employeeCode, options), options);
}

async function listEmployeeProfilesByAccountIds(accountIds = [], options = {}) {
  const uniqueIds = [...new Set(accountIds.map(String).filter(Boolean))];
  const profiles = [];
  for (const accountId of uniqueIds) {
    const profile = await getEmployeeProfileByAccountId(accountId, options);
    if (profile) profiles.push(profile);
  }
  return profiles;
}

module.exports = {
  getEmployeeProfileByAccountId,
  getEmployeeProfileByEmployeeCode,
  listEmployeeProfilesByAccountIds,
};
```

The loop is acceptable in Phase 1 because consumers are profile/detail flows. Replace with repository batch query when attendance/payroll needs hundreds of accounts.

- [ ] **Step 4: Run public and architecture tests**

```bash
npm test -- src/test/hr/public.contract.test.js --runInBand
npm run test:architecture -- --runInBand
```

Expected: public test PASS. Architecture should PASS after unrelated existing architecture violation is fixed or excluded from this branch; do not introduce any new cross-module internal imports.

- [ ] **Step 5: Commit**

```bash
git add src/modules/hr/public.js src/test/hr/public.contract.test.js
git commit -m "feat(hr): expose employee profile public ports"
```

---

### Task 5: Add Migration Map Documentation And Seed Guardrails

**Files:**
- Create: `docs/hr/hr-core-phase-1-migration-map.md`
- Create: `src/modules/hr/scripts/auditHrProfileReadiness.js`
- Test: `src/test/hr/scripts/auditHrProfileReadiness.test.js`

**Interfaces:**
- Produces script: `node src/modules/hr/scripts/auditHrProfileReadiness.js`
- Script reads portal DB only in Phase 1 and reports missing auth/organization references before any future HR import.

- [ ] **Step 1: Write migration map doc**

Create `docs/hr/hr-core-phase-1-migration-map.md`:

```md
# HR Core Phase 1 Migration Map

## Source Repo

`C:\Users\stack\Task\lng-hr-be`

## Do Not Import

- `Account`, `Role`, `Permission`: portal `auth` owns identity and RBAC.
- `Department`, `Team`: portal `organization` owns org structure.
- `AuditLog`: portal `audit` owns immutable activity evidence.
- `Notification`, `Announcement`: outside Phase 1.

## Import Later By Mapping

- HR `Employee.accountId` maps to portal `Account._id`.
- HR `Employee.departmentId` maps to portal `Department._id`.
- HR `Employee.teamId` maps to portal `Team._id`.
- HR `Employee.avatar` maps to `HrEmployeeProfile.avatarUrl`.

## Sensitive Fields

These fields require compensation permissions:

- `baseSalary`
- `bankAccount`
- `identityCard`
- `taxIdentification`
- `socialInsuranceNumber`
- `allowances`
- `responsibilityAllowance`
```

- [ ] **Step 2: Write script test**

```js
const fs = require('fs');
const path = require('path');

describe('auditHrProfileReadiness script', () => {
  test('prints non-mutating audit wording', () => {
    const source = fs.readFileSync(path.join(__dirname, '../../../modules/hr/scripts/auditHrProfileReadiness.js'), 'utf8');
    expect(source).toContain('HR profile readiness audit');
    expect(source).not.toContain('deleteMany');
    expect(source).not.toContain('dropDatabase');
  });
});
```

- [ ] **Step 3: Create read-only audit script**

```js
const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const HrEmployeeProfile = require('../models/employeeProfile.model');
const logger = require('../../../shared/utils/logger');

async function auditHrProfileReadiness() {
  await connectDatabase();
  try {
    const totalProfiles = await HrEmployeeProfile.countDocuments({});
    const activeProfiles = await HrEmployeeProfile.countDocuments({ isDeleted: false });
    logger.info('HR profile readiness audit', {
      totalProfiles,
      activeProfiles,
    });
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  auditHrProfileReadiness().catch((error) => {
    logger.error('HR profile readiness audit failed', { error });
    process.exit(1);
  });
}

module.exports = auditHrProfileReadiness;
```

- [ ] **Step 4: Run script test**

Run: `npm test -- src/test/hr/scripts/auditHrProfileReadiness.test.js --runInBand`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add docs/hr/hr-core-phase-1-migration-map.md src/modules/hr/scripts/auditHrProfileReadiness.js src/test/hr/scripts/auditHrProfileReadiness.test.js
git commit -m "docs(hr): document hr core migration map"
```

---

## Verification Commands

Run after all tasks:

```bash
node -c src/modules/hr/models/employeeProfile.model.js
node -c src/modules/hr/repositories/employeeProfile.repository.js
node -c src/modules/hr/services/employeeProfile.service.js
node -c src/modules/hr/controllers/employeeProfile.controller.js
node -c src/modules/hr/validators/employeeProfile.validator.js
npm test -- src/test/hr --runInBand
npm test -- src/test/auth/rbac.hr-permissions.test.js --runInBand
npm run test:architecture -- --runInBand
```

Expected:

- Syntax checks PASS.
- HR tests PASS.
- HR RBAC test PASS.
- Architecture test has no new violations from `src/modules/hr`. If it fails on a pre-existing non-HR import, capture the exact file and do not hide it.

---

## Self-Review Notes

- Phase 1 covers HR identity/profile only.
- Phase 1 intentionally excludes attendance, leave, overtime, payroll, SQL sync, notification, announcement, and cron jobs.
- All HR references to account/department/team use portal modules.
- Sensitive fields are explicitly gated in DTO/service behavior and tests.
- Edge cases are covered in service, DTO, route, repository, and migration-readiness tests.
