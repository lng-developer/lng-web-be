const mockTransaction = {
  withTransaction: jest.fn(async (work) => {
    try {
      return await work();
    } catch (error) {
      await mockTransaction.abortTransaction();
      throw error;
    }
  }),
  abortTransaction: jest.fn(),
  endSession: jest.fn(),
};

jest.mock('mongoose', () => ({
  startSession: jest.fn(async () => mockTransaction),
}));
jest.mock('../../../modules/auth/public', () => ({
  createProvisionedAccount: jest.fn(),
}));
jest.mock('../../../modules/hr/services/employeeProfile.service', () => ({
  assertCanAccessProfile: jest.fn(),
  recordProfileAudit: jest.fn(),
  resolveOrganization: jest.fn(),
}));
jest.mock('../../../modules/hr/repositories/employeeProfile.repository', () => ({
  create: jest.fn(),
  findByAccountId: jest.fn(),
  findByEmployeeCode: jest.fn(),
}));
jest.mock('../../../modules/hr/repositories/leave.repository', () => ({
  ensureBalance: jest.fn(),
}));

const authPublic = require('../../../modules/auth/public');
const employeeProfileService = require('../../../modules/hr/services/employeeProfile.service');
const employeeProfileRepository = require('../../../modules/hr/repositories/employeeProfile.repository');
const leaveRepository = require('../../../modules/hr/repositories/leave.repository');
const { provisionStaff } = require('../../../modules/hr/services/staffProvisioning.service');

const accountId = '660000000000000000000001';
const departmentId = '660000000000000000000002';
const teamId = '660000000000000000000003';
const profileId = '660000000000000000000004';
const validPayload = {
  employeeCode: 'J2501',
  workEmail: 'jane@example.com',
  fullName: 'Jane Nguyen',
  departmentId,
  teamId,
  jobTitle: 'Operator',
  jobLevel: 'L1',
  employmentType: 'FULL_TIME',
  workMode: 'ONSITE',
  startDate: '2026-07-29',
  probationEndDate: null,
  status: 'PROBATION',
  assignments: [{
    roleId: '660000000000000000000005', scopeType: 'department', scopeId: departmentId,
    customPermissionIds: [],
  }],
};
const hrWriterContext = { accountId: '660000000000000000000006', permissions: ['HR_EMPLOYEES:WRITE'] };
const requestContext = { requestId: 'request-1' };

describe('staffProvisioning service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    employeeProfileService.resolveOrganization.mockResolvedValue({ departmentId, teamId });
    employeeProfileRepository.findByAccountId.mockResolvedValue(null);
    employeeProfileRepository.findByEmployeeCode.mockResolvedValue(null);
    authPublic.createProvisionedAccount.mockResolvedValue({ _id: accountId, mustChangePassword: true });
    employeeProfileRepository.create.mockResolvedValue({
      _id: profileId, accountId, ...validPayload, departmentId, teamId, isProfileUpdated: false,
    });
    leaveRepository.ensureBalance.mockResolvedValue({ profileId, year: 2026, leaveType: 'ANNUAL' });
    employeeProfileService.recordProfileAudit.mockResolvedValue();
  });

  test('provisions account, access, profile, and annual balance in one transaction', async () => {
    const result = await provisionStaff(validPayload, hrWriterContext, requestContext);

    expect(result).toMatchObject({
      accountId,
      mustChangePassword: true,
      isProfileUpdated: false,
      leaveBalance: { year: new Date().getUTCFullYear(), leaveType: 'ANNUAL' },
    });
    expect(authPublic.createProvisionedAccount).toHaveBeenCalledWith(expect.objectContaining({
      email: validPayload.workEmail,
      session: mockTransaction,
      authContext: hrWriterContext,
      httpContext: requestContext,
    }));
    expect(employeeProfileRepository.create).toHaveBeenCalledWith(expect.objectContaining({
      accountId,
      isProfileUpdated: false,
    }), { session: mockTransaction });
    expect(leaveRepository.ensureBalance).toHaveBeenCalledWith(
      profileId,
      new Date().getUTCFullYear(),
      'ANNUAL',
      { session: mockTransaction },
    );
    expect(mockTransaction.endSession).toHaveBeenCalled();
  });

  test('rolls back when annual leave initialization fails', async () => {
    leaveRepository.ensureBalance.mockRejectedValueOnce(new Error('write failed'));

    await expect(provisionStaff(validPayload, hrWriterContext, requestContext)).rejects.toThrow('write failed');
    expect(mockTransaction.withTransaction).toHaveBeenCalled();
    expect(mockTransaction.abortTransaction).toHaveBeenCalled();
    expect(mockTransaction.endSession).toHaveBeenCalled();
  });

  test('maps a profile unique-index collision to the established conflict response', async () => {
    employeeProfileRepository.create.mockRejectedValueOnce({ code: 11000 });

    await expect(provisionStaff(validPayload, hrWriterContext, requestContext)).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
      message: 'Employee profile has duplicate fields',
    });
  });
});
