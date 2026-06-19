jest.mock('../../../modules/auth/public', () => ({
  syncScopeRegistry: jest.fn(),
  getCurrentAccount: jest.fn(),
  findProfileByEmployeeCode: jest.fn(),
  listAssignableProfiles: jest.fn(),
  canAccessScope: jest.fn(),
  ensureTeamLeaderAssignment: jest.fn(),
  ensureTeamMemberAssignment: jest.fn(),
  deactivateTeamRoleAssignments: jest.fn(),
}));

jest.mock('../../../modules/organization/repositories/department.repository', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  list: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../modules/organization/repositories/team.repository', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  list: jest.fn(),
  update: jest.fn(),
}));

jest.mock('../../../modules/organization/repositories/teamMembership.repository', () => ({
  upsertActive: jest.fn(),
  findActiveByAccountId: jest.fn(),
  deactivateActiveByAccountId: jest.fn(),
  deactivate: jest.fn(),
  listActiveByTeam: jest.fn(),
  listActiveAccountIds: jest.fn(),
  listActiveOrganizationByAccountIds: jest.fn(),
}));

const mongoose = require('mongoose');
const authPublic = require('../../../modules/auth/public');
const departmentRepository = require('../../../modules/organization/repositories/department.repository');
const teamRepository = require('../../../modules/organization/repositories/team.repository');
const teamMembershipRepository = require('../../../modules/organization/repositories/teamMembership.repository');
const organizationService = require('../../../modules/organization/services/organization.service');
const { organizationStatuses, teamMemberTypes } = require('../../../modules/organization/constants');

describe('organizationService', () => {
  const departmentId = '660000000000000000000001';
  const teamId = '660000000000000000000101';
  const leaderAccountId = '660000000000000000000201';
  const memberAccountId = '660000000000000000000202';

  beforeEach(() => {
    jest.clearAllMocks();
    authPublic.canAccessScope.mockReturnValue(true);
    authPublic.ensureTeamLeaderAssignment.mockResolvedValue({});
    authPublic.ensureTeamMemberAssignment.mockResolvedValue({});
    authPublic.deactivateTeamRoleAssignments.mockResolvedValue({ deactivated: true });
    jest.spyOn(mongoose, 'startSession').mockResolvedValue({
      withTransaction: async (callback) => callback(),
      endSession: jest.fn(),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('createDepartment creates department and syncs auth scope registry', async () => {
    const department = {
      _id: departmentId,
      name: 'Operations Department',
      code: 'OPERATIONS',
      status: organizationStatuses.ACTIVE,
    };

    departmentRepository.create.mockResolvedValue(department);
    authPublic.syncScopeRegistry.mockResolvedValue({});

    const result = await organizationService.createDepartment({
      name: 'Operations Department',
      code: 'operations',
    });

    expect(departmentRepository.create).toHaveBeenCalledWith({
      name: 'Operations Department',
      code: 'OPERATIONS',
      status: organizationStatuses.ACTIVE,
    });
    expect(authPublic.syncScopeRegistry).toHaveBeenCalledWith({
      scopeType: 'department',
      scopeId: departmentId,
      name: 'Operations Department',
      status: organizationStatuses.ACTIVE,
    });
    expect(result).toMatchObject({
      id: departmentId,
      code: 'OPERATIONS',
    });
  });

  test('createTeam requires an active department and syncs auth scope registry', async () => {
    const department = {
      _id: departmentId,
      status: organizationStatuses.ACTIVE,
    };
    const team = {
      _id: teamId,
      name: 'Sales Team',
      code: 'SALES',
      departmentId,
      status: organizationStatuses.ACTIVE,
    };

    departmentRepository.findById.mockResolvedValue(department);
    teamRepository.create.mockResolvedValue(team);
    authPublic.syncScopeRegistry.mockResolvedValue({});

    const result = await organizationService.createTeam({
      name: 'Sales Team',
      code: 'sales',
      departmentId,
    });

    expect(teamRepository.create).toHaveBeenCalledWith({
      name: 'Sales Team',
      code: 'SALES',
      departmentId,
      status: organizationStatuses.ACTIVE,
    });
    expect(authPublic.syncScopeRegistry).toHaveBeenCalledWith({
      scopeType: 'team',
      scopeId: teamId,
      name: 'Sales Team',
      status: organizationStatuses.ACTIVE,
    });
    expect(result).toMatchObject({
      id: teamId,
      departmentId,
      code: 'SALES',
    });
  });

  test('createTeam rejects missing or inactive department', async () => {
    departmentRepository.findById.mockResolvedValue({
      _id: departmentId,
      status: organizationStatuses.INACTIVE,
    });

    await expect(organizationService.createTeam({
      name: 'Sales Team',
      code: 'SALES',
      departmentId,
    })).rejects.toMatchObject({
      statusCode: 404,
    });

    expect(teamRepository.create).not.toHaveBeenCalled();
  });

  test('listMemberCandidates excludes accounts with active team membership', async () => {
    teamMembershipRepository.listActiveAccountIds.mockResolvedValue([memberAccountId]);
    authPublic.listAssignableProfiles.mockResolvedValue([
      {
        accountId: leaderAccountId,
        employeeCode: 'J2506',
        fullName: 'Leader',
      },
    ]);

    const result = await organizationService.listMemberCandidates({
      search: 'J25',
      limit: 20,
    });

    expect(authPublic.listAssignableProfiles).toHaveBeenCalledWith({
      excludedAccountIds: [memberAccountId],
      search: 'J25',
      limit: 20,
    });
    expect(result).toEqual([
      {
        accountId: leaderAccountId,
        employeeCode: 'J2506',
        fullName: 'Leader',
      },
    ]);
  });

  test('listAccountOrganizationSummaries maps active membership team and department', async () => {
    teamMembershipRepository.listActiveOrganizationByAccountIds.mockResolvedValue([{
      accountId: memberAccountId,
      memberType: teamMemberTypes.MEMBER,
      team: {
        id: teamId,
        name: 'Sales Team',
        code: 'SALES',
        status: organizationStatuses.ACTIVE,
      },
      department: {
        id: departmentId,
        name: 'Operations Department',
        code: 'OPERATIONS',
        status: organizationStatuses.ACTIVE,
      },
    }]);

    const result = await organizationService.listAccountOrganizationSummaries([memberAccountId]);

    expect(teamMembershipRepository.listActiveOrganizationByAccountIds).toHaveBeenCalledWith([memberAccountId]);
    expect(result).toEqual([{
      accountId: memberAccountId,
      memberType: teamMemberTypes.MEMBER,
      team: {
        id: teamId,
        name: 'Sales Team',
        code: 'SALES',
        status: organizationStatuses.ACTIVE,
      },
      department: {
        id: departmentId,
        name: 'Operations Department',
        code: 'OPERATIONS',
        status: organizationStatuses.ACTIVE,
      },
    }]);
  });

  test('listTeamMembers groups leaders and members', async () => {
    teamRepository.findById.mockResolvedValue({
      _id: teamId,
      name: 'Sales Team',
      code: 'SALES',
      departmentId,
      status: organizationStatuses.ACTIVE,
    });
    teamMembershipRepository.listActiveByTeam.mockResolvedValue([
      {
        accountId: leaderAccountId,
        teamId,
        memberType: teamMemberTypes.LEADER,
      },
      {
        accountId: memberAccountId,
        teamId,
        memberType: teamMemberTypes.MEMBER,
      },
    ]);
    authPublic.getCurrentAccount
      .mockResolvedValueOnce({
        account: { _id: leaderAccountId, email: 'leader@example.com' },
        profile: { _id: '660000000000000000000301', employeeCode: 'J2506', fullName: 'Leader' },
        roles: ['TEAM_LEADER'],
        permissions: ['TEAMS:READ'],
      })
      .mockResolvedValueOnce({
        account: { _id: memberAccountId, email: 'member@example.com' },
        profile: { _id: '660000000000000000000302', employeeCode: 'J2514', fullName: 'Member' },
        roles: ['OPERATOR'],
        permissions: ['ORDERS:READ'],
      });

    const result = await organizationService.listTeamMembers(teamId);

    expect(result.team).toMatchObject({ id: teamId, code: 'SALES' });
    expect(result.leaders).toHaveLength(1);
    expect(result.members).toHaveLength(1);
    expect(result.leaders[0]).toMatchObject({
      accountId: leaderAccountId,
      employeeCode: 'J2506',
      memberType: teamMemberTypes.LEADER,
    });
    expect(result.members[0]).toMatchObject({
      accountId: memberAccountId,
      employeeCode: 'J2514',
      memberType: teamMemberTypes.MEMBER,
    });
  });

  test('addTeamMember resolves employeeCode to accountId', async () => {
    teamRepository.findById.mockResolvedValue({
      _id: teamId,
      name: 'Sales Team',
      code: 'SALES',
      departmentId,
      status: organizationStatuses.ACTIVE,
    });
    authPublic.findProfileByEmployeeCode.mockResolvedValue({
      accountId: memberAccountId,
      employeeCode: 'J2533',
    });
    authPublic.getCurrentAccount.mockResolvedValue({
      account: { _id: memberAccountId, email: 'j2533@demo.lng.co' },
      profile: { _id: '660000000000000000000303', employeeCode: 'J2533', fullName: 'J2533 Football Shop Operator' },
      roles: ['OPERATOR'],
      permissions: ['ORDERS:READ'],
    });
    teamMembershipRepository.upsertActive.mockResolvedValue({
      accountId: memberAccountId,
      teamId,
      memberType: teamMemberTypes.LEADER,
    });
    teamMembershipRepository.findActiveByAccountId.mockResolvedValue(null);

    const result = await organizationService.addTeamMember(teamId, {
      employeeCode: 'j2533',
      memberType: teamMemberTypes.LEADER,
    });

    expect(authPublic.findProfileByEmployeeCode).toHaveBeenCalledWith('j2533');
    expect(teamMembershipRepository.upsertActive).toHaveBeenCalledWith(
      {
        accountId: memberAccountId,
        teamId,
        memberType: teamMemberTypes.LEADER,
      },
      { session: expect.any(Object) },
    );
    expect(teamMembershipRepository.deactivateActiveByAccountId).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      accountId: memberAccountId,
      employeeCode: 'J2533',
      memberType: teamMemberTypes.LEADER,
      moved: false,
    });
  });

  test('addTeamMember updates member type when account is already in the selected team', async () => {
    teamRepository.findById.mockResolvedValue({
      _id: teamId,
      name: 'Sales Team',
      code: 'SALES',
      departmentId,
      status: organizationStatuses.ACTIVE,
    });
    authPublic.getCurrentAccount.mockResolvedValue({
      account: { _id: memberAccountId, email: 'member@example.com' },
      profile: { _id: '660000000000000000000302', employeeCode: 'J2514', fullName: 'Member' },
      roles: ['OPERATOR'],
      permissions: ['ORDERS:READ'],
    });
    teamMembershipRepository.findActiveByAccountId.mockResolvedValue({
      accountId: memberAccountId,
      teamId,
      memberType: teamMemberTypes.MEMBER,
    });
    teamMembershipRepository.upsertActive.mockResolvedValue({
      accountId: memberAccountId,
      teamId,
      memberType: teamMemberTypes.LEADER,
    });

    const result = await organizationService.addTeamMember(teamId, {
      accountId: memberAccountId,
      memberType: teamMemberTypes.LEADER,
    });

    expect(teamMembershipRepository.deactivateActiveByAccountId).not.toHaveBeenCalled();
    expect(teamMembershipRepository.upsertActive).toHaveBeenCalledWith(
      {
        accountId: memberAccountId,
        teamId,
        memberType: teamMemberTypes.LEADER,
      },
      { session: expect.any(Object) },
    );
    expect(result).toMatchObject({
      accountId: memberAccountId,
      memberType: teamMemberTypes.LEADER,
      moved: false,
    });
    expect(authPublic.ensureTeamLeaderAssignment).toHaveBeenCalledWith(
      memberAccountId,
      teamId,
      { session: expect.any(Object) },
    );
  });

  test('addTeamMember auto moves account from the previous active team', async () => {
    const previousTeamId = '660000000000000000000102';

    teamRepository.findById.mockResolvedValue({
      _id: teamId,
      name: 'Sales Team',
      code: 'SALES',
      departmentId,
      status: organizationStatuses.ACTIVE,
    });
    authPublic.getCurrentAccount.mockResolvedValue({
      account: { _id: memberAccountId, email: 'member@example.com' },
      profile: { _id: '660000000000000000000302', employeeCode: 'J2514', fullName: 'Member' },
      roles: ['OPERATOR'],
      permissions: ['ORDERS:READ'],
    });
    teamMembershipRepository.findActiveByAccountId.mockResolvedValue({
      accountId: memberAccountId,
      teamId: previousTeamId,
      memberType: teamMemberTypes.MEMBER,
    });
    teamMembershipRepository.upsertActive.mockResolvedValue({
      accountId: memberAccountId,
      teamId,
      memberType: teamMemberTypes.MEMBER,
    });

    const result = await organizationService.addTeamMember(teamId, {
      accountId: memberAccountId,
      memberType: teamMemberTypes.MEMBER,
    });

    expect(teamMembershipRepository.deactivateActiveByAccountId).toHaveBeenCalledWith(
      memberAccountId,
      { session: expect.any(Object) },
    );
    expect(teamMembershipRepository.upsertActive).toHaveBeenCalledWith(
      {
        accountId: memberAccountId,
        teamId,
        memberType: teamMemberTypes.MEMBER,
      },
      { session: expect.any(Object) },
    );
    expect(result).toMatchObject({
      accountId: memberAccountId,
      moved: true,
    });
    expect(authPublic.deactivateTeamRoleAssignments).toHaveBeenCalledWith(
      memberAccountId,
      previousTeamId,
      { session: expect.any(Object) },
    );
    expect(authPublic.ensureTeamMemberAssignment).toHaveBeenCalledWith(
      memberAccountId,
      teamId,
      { session: expect.any(Object) },
    );
  });

  test('addTeamMember rejects manager outside the target team department', async () => {
    teamRepository.findById.mockResolvedValue({
      _id: teamId,
      name: 'Sales Team',
      code: 'SALES',
      departmentId,
      status: organizationStatuses.ACTIVE,
    });
    authPublic.getCurrentAccount.mockResolvedValue({
      account: { _id: memberAccountId, email: 'member@example.com' },
      profile: { _id: '660000000000000000000302', employeeCode: 'J2514', fullName: 'Member' },
      roles: ['USER'],
      permissions: ['ORDERS:READ'],
    });
    authPublic.canAccessScope.mockReturnValue(false);

    await expect(organizationService.addTeamMember(
      teamId,
      {
        accountId: memberAccountId,
        memberType: teamMemberTypes.MEMBER,
      },
      {
        actorAuth: {
          accountId: '660000000000000000000999',
          permissions: [],
          scopes: [],
        },
      },
    )).rejects.toMatchObject({
      statusCode: 403,
      code: 'AUTHORIZATION_ERROR',
    });

    expect(authPublic.canAccessScope).toHaveBeenCalledWith(
      expect.any(Object),
      'TEAMS:WRITE',
      { scopeType: 'department', scopeId: departmentId },
    );
    expect(teamMembershipRepository.upsertActive).not.toHaveBeenCalled();
    expect(authPublic.ensureTeamMemberAssignment).not.toHaveBeenCalled();
  });

  test('removeTeamMember deactivates membership and team scoped auth assignments', async () => {
    teamRepository.findById.mockResolvedValue({
      _id: teamId,
      name: 'Sales Team',
      code: 'SALES',
      departmentId,
      status: organizationStatuses.ACTIVE,
    });
    teamMembershipRepository.deactivate.mockResolvedValue({
      accountId: memberAccountId,
      teamId,
      memberType: teamMemberTypes.MEMBER,
    });

    const result = await organizationService.removeTeamMember(
      teamId,
      memberAccountId,
      {
        actorAuth: {
          accountId: '660000000000000000000999',
          permissions: [],
          scopes: [{
            scopeType: 'department',
            scopeId: departmentId,
            permissions: ['TEAMS:WRITE'],
          }],
        },
      },
    );

    expect(teamMembershipRepository.deactivate).toHaveBeenCalledWith(teamId, memberAccountId);
    expect(authPublic.deactivateTeamRoleAssignments).toHaveBeenCalledWith(memberAccountId, teamId);
    expect(result).toEqual({ removed: true });
  });
});
