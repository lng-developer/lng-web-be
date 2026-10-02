jest.mock('../../../src/config/database', () => ({
  connectDatabase: jest.fn(),
  disconnectDatabase: jest.fn(),
}));
jest.mock('../../../src/config/redis', () => ({ disconnectRedis: jest.fn() }));
jest.mock('../../../src/shared/utils/logger', () => ({ info: jest.fn(), error: jest.fn() }));
jest.mock('mongoose', () => ({ connection: { db: { databaseName: 'rbac-test' } }, startSession: jest.fn() }));
jest.mock('../../../src/modules/auth/models/account.model', () => ({
  find: jest.fn(() => ({ select: () => ({ lean: async () => [{ _id: 'account-oai', email: 'oai@example.test' }] }) })),
}));
jest.mock('../../../src/modules/auth/models/accessAssignment.model', () => ({
  find: jest.fn(() => ({ lean: async () => [] })),
  findOneAndUpdate: jest.fn(),
}));
jest.mock('../../../src/modules/auth/models/permission.model', () => ({
  find: jest.fn((filter) => ({ lean: async () => filter.code.$in.map((code) => ({ _id: `permission:${code}`, code })) })),
}));
jest.mock('../../../src/modules/auth/models/role.model', () => ({
  findOne: jest.fn((filter) => ({ lean: async () => ({
    _id: filter.code === 'TEAM_LEADER' ? 'role-team-leader' : 'role-leader',
    code: filter.code,
    permissions: [],
  }) })),
  updateOne: jest.fn(),
}));
jest.mock('../../../src/modules/organization/public', () => ({
  listRoleAssignmentSource: jest.fn(async () => ({
    teams: [{ _id: 'team-sales', code: 'SALE' }],
    memberships: [{ accountId: 'account-oai', teamId: 'team-sales', memberType: 'leader' }],
  })),
}));
jest.mock('../../../src/modules/auth/services/authManager.service', () => ({ invalidatePermissionCache: jest.fn() }));

const AccessAssignment = require('../../../src/modules/auth/models/accessAssignment.model');
const Role = require('../../../src/modules/auth/models/role.model');
const { buildTeamLeaderPlan, summarizeTeamLeaderPlan, migrateTeamLeaderHrScopes } = require('../../../src/modules/auth/scripts/migrateTeamLeaderHrScopes');

describe('team leader HR scope migration plan', () => {
  const leaderRole = { _id: 'role-leader', code: 'LEADER' };
  const context = {
    leaderRole,
    teamsById: new Map([['team-sales', { _id: 'team-sales', code: 'SALE' }]]),
    accountsById: new Map([['account-oai', { _id: 'account-oai', email: 'oai@example.test' }]]),
    memberships: [{ accountId: 'account-oai', teamId: 'team-sales', memberType: 'leader' }],
    assignments: [],
  };

  test('plans one scoped LEADER assignment for each organization leader without duplicates', () => {
    const plan = buildTeamLeaderPlan(context);

    expect(plan.create).toEqual([
      {
        accountId: 'account-oai',
        email: 'oai@example.test',
        teamId: 'team-sales',
        teamCode: 'SALE',
        roleId: 'role-leader',
      },
    ]);
    expect(plan.keep).toEqual([]);
    expect(summarizeTeamLeaderPlan(plan)).toMatchObject({ leaders: 1, assignmentsToCreate: 1 });
  });

  test('keeps an existing active team LEADER assignment and skips non-leaders', () => {
    const plan = buildTeamLeaderPlan({
      ...context,
      memberships: [
        ...context.memberships,
        { accountId: 'account-oai', teamId: 'team-sales', memberType: 'member' },
      ],
      assignments: [{
        accountId: 'account-oai',
        roleId: 'role-leader',
        scopeType: 'team',
        scopeId: 'team-sales',
        status: 'active',
      }],
    });

    expect(plan.create).toEqual([]);
    expect(plan.keep).toHaveLength(1);
  });

  test('defaults to a dry run without role or assignment writes', async () => {
    const result = await migrateTeamLeaderHrScopes();

    expect(result).toMatchObject({
      apply: false,
      database: 'rbac-test',
      assignmentsToCreate: 1,
      teamLeaderRolePermissionsToUpdate: true,
    });
    expect(Role.updateOne).not.toHaveBeenCalled();
    expect(AccessAssignment.findOneAndUpdate).not.toHaveBeenCalled();
  });
});
