jest.mock('../../../src/modules/organization/models/team.model', () => ({ find: jest.fn() }));
jest.mock('../../../src/modules/organization/models/teamMembership.model', () => ({ find: jest.fn() }));
jest.mock('../../../src/modules/hr/public', () => ({
  getEmployeeProfileByAccountId: jest.fn(),
  syncEmployeeProfileTeam: jest.fn(),
}));

const Team = require('../../../src/modules/organization/models/team.model');
const TeamMembership = require('../../../src/modules/organization/models/teamMembership.model');
const hrPublic = require('../../../src/modules/hr/public');
const {
  reconcileEmployeeProfileDepartments,
} = require('../../../src/modules/organization/scripts/reconcileEmployeeProfileDepartments');

function findResult(items) {
  return { select: jest.fn().mockReturnValue({ lean: jest.fn().mockResolvedValue(items) }) };
}

describe('reconcileEmployeeProfileDepartments', () => {
  const departmentId = '660000000000000000000001';
  const teamId = '660000000000000000000101';
  const accountId = '660000000000000000000201';

  beforeEach(() => {
    jest.clearAllMocks();
    Team.find.mockReturnValue(findResult([{ _id: teamId, departmentId }]));
    TeamMembership.find.mockReturnValue(findResult([{ accountId, teamId }]));
    hrPublic.getEmployeeProfileByAccountId.mockResolvedValue({
      accountId,
      teamId,
      departmentId: null,
    });
  });

  test('reports mismatched profile departments without writing by default', async () => {
    await expect(reconcileEmployeeProfileDepartments()).resolves.toMatchObject({
      apply: false,
      scannedMemberships: 1,
      wouldUpdate: 1,
      updated: 0,
    });
    expect(hrPublic.syncEmployeeProfileTeam).not.toHaveBeenCalled();
  });

  test('updates a mismatched profile only when apply is enabled', async () => {
    await expect(reconcileEmployeeProfileDepartments({ apply: true })).resolves.toMatchObject({
      apply: true,
      updated: 1,
    });
    expect(hrPublic.syncEmployeeProfileTeam).toHaveBeenCalledWith(accountId, teamId, { departmentId });
  });
});
