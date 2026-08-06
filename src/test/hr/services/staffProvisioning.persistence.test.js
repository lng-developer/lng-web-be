const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');

const Account = require('../../../modules/auth/models/account.model');
const AccessAssignment = require('../../../modules/auth/models/accessAssignment.model');
const Role = require('../../../modules/auth/models/role.model');
const AuditEvent = require('../../../modules/audit/models/auditEvent.model');
const Department = require('../../../modules/organization/models/department.model');
const Team = require('../../../modules/organization/models/team.model');
const EmployeeProfile = require('../../../modules/hr/models/employeeProfile.model');
const LeaveBalance = require('../../../modules/hr/models/leaveBalance.model');
const auditPublic = require('../../../modules/audit/public');
const leaveRepository = require('../../../modules/hr/repositories/leave.repository');
const { provisionStaff } = require('../../../modules/hr/services/staffProvisioning.service');

let mongo;
let department;
let role;
let team;

jest.setTimeout(120000);

function payload(email) {
  return {
    employeeCode: `EMP-${email.split('@')[0]}`.toUpperCase(),
    workEmail: email,
    fullName: 'Provisioned Staff',
    departmentId: String(department._id),
    teamId: String(team._id),
    employmentType: 'FULL_TIME',
    workMode: 'ONSITE',
    startDate: '2026-07-29',
    probationEndDate: null,
    assignments: [{ roleId: String(role._id), scopeType: 'global', scopeId: null }],
  };
}

async function expectNoProvisionedRecords() {
  await expect(Promise.all([
    Account.countDocuments({}),
    AccessAssignment.countDocuments({}),
    EmployeeProfile.countDocuments({}),
    LeaveBalance.countDocuments({}),
    AuditEvent.countDocuments({}),
  ])).resolves.toEqual([0, 0, 0, 0, 0]);
}

describe('staff provisioning persisted transaction', () => {
  beforeAll(async () => {
    mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    await mongoose.connect(mongo.getUri('staff_provisioning_persistence_test'));
    await Promise.all([
      Account.init(),
      AccessAssignment.init(),
      Role.init(),
      AuditEvent.init(),
      Department.init(),
      Team.init(),
      EmployeeProfile.init(),
      LeaveBalance.init(),
    ]);
  });

  afterAll(async () => {
    await mongoose.disconnect();
    await mongo.stop();
  });

  beforeEach(async () => {
    await Promise.all([
      Account.deleteMany({}),
      AccessAssignment.deleteMany({}),
      Role.deleteMany({}),
      AuditEvent.deleteMany({}),
      Department.deleteMany({}),
      Team.deleteMany({}),
      EmployeeProfile.deleteMany({}),
      LeaveBalance.deleteMany({}),
    ]);
    jest.restoreAllMocks();
    department = await Department.create({ name: 'Operations', code: 'OPS', status: 'active' });
    team = await Team.create({ name: 'Fulfillment', code: 'FULFILLMENT', departmentId: department._id, status: 'active' });
    role = await Role.create({ name: 'Staff', code: 'STAFF', permissions: [] });
  });

  test('rolls back account, access, profile, balance, and audits when balance initialization fails', async () => {
    jest.spyOn(leaveRepository, 'ensureBalance').mockRejectedValueOnce(new Error('balance unavailable'));

    await expect(provisionStaff(payload('balance@lng.co'), {
      accountId: String(new mongoose.Types.ObjectId()), permissions: ['HR_EMPLOYEES:WRITE'],
    })).rejects.toThrow('balance unavailable');

    await expectNoProvisionedRecords();
  });

  test('rolls back account, access, profile, balance, and audits when profile audit fails', async () => {
    const originalRecord = auditPublic.record;
    jest.spyOn(auditPublic, 'record').mockImplementation((event, options) => (
      event.action === 'HR_STAFF_PROVISIONED'
        ? Promise.reject(new Error('audit unavailable'))
        : originalRecord(event, options)
    ));

    await expect(provisionStaff(payload('audit@lng.co'), {
      accountId: String(new mongoose.Types.ObjectId()), permissions: ['HR_EMPLOYEES:WRITE'],
    })).rejects.toThrow('audit unavailable');

    await expectNoProvisionedRecords();
  });
});
