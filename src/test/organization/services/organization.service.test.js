jest.mock('../../../modules/auth/public', () => ({
  syncScopeRegistry: jest.fn(),
  getCurrentAccount: jest.fn(),
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
  findActiveByTeamAndAccount: jest.fn(),
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
  const httpContext = { requestId: 'organization-request-1', ipAddress: '127.0.0.1', userAgent: 'jest' };
  const actorAuth = { accountId: leaderAccountId, permissions: ['TEAMS:WRITE'] };

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
    }, { session: expect.any(Object) });
    expect(authPublic.syncScopeRegistry).toHaveBeenCalledWith({
      scopeType: 'department',
      scopeId: departmentId,
      name: 'Operations Department',
      status: organizationStatuses.ACTIVE,
    }, undefined, undefined, { session: expect.any(Object) });
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
    }, { session: expect.any(Object) });
    expect(authPublic.syncScopeRegistry).toHaveBeenCalledWith({
      scopeType: 'team',
      scopeId: teamId,
      name: 'Sales Team',
      status: organizationStatuses.ACTIVE,
    }, undefined, undefined, { session: expect.any(Object) });
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

  test('listDepartments limits scoped manager to own department', async () => {
    departmentRepository.list.mockResolvedValue({
      items: [{
        _id: departmentId,
        name: 'Operations Department',
        code: 'OPERATIONS',
        status: organizationStatuses.ACTIVE,
      }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const result = await organizationService.listDepartments({}, {
      actorAuth: {
        permissions: [],
        scopes: [{
          scopeType: 'department',
          scopeId: departmentId,
          permissions: ['TEAMS:READ'],
        }],
      },
    });

    expect(departmentRepository.list).toHaveBeenCalledWith({ ids: [departmentId] });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: departmentId });
  });

  test('listDepartments treats scoped TEAMS:WRITE as readable department scope', async () => {
    departmentRepository.list.mockResolvedValue({
      items: [{
        _id: departmentId,
        name: 'Operations Department',
        code: 'OPERATIONS',
        status: organizationStatuses.ACTIVE,
      }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    await organizationService.listDepartments({}, {
      actorAuth: {
        permissions: [],
        scopes: [{
          scopeType: 'department',
          scopeId: departmentId,
          permissions: ['TEAMS:WRITE'],
        }],
      },
    });

    expect(departmentRepository.list).toHaveBeenCalledWith({ ids: [departmentId] });
  });

  test('listTeams limits scoped leader to own team', async () => {
    teamRepository.list.mockResolvedValue({
      items: [{
        _id: teamId,
        name: 'Sales Team',
        code: 'SALES',
        departmentId,
        status: organizationStatuses.ACTIVE,
      }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const result = await organizationService.listTeams({}, {
      actorAuth: {
        permissions: [],
        scopes: [{
          scopeType: 'team',
          scopeId: teamId,
          permissions: ['TEAMS:READ'],
        }],
      },
    });

    expect(teamRepository.list).toHaveBeenCalledWith({ ids: [teamId] });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({ id: teamId });
  });

  test('listTeams limits scoped manager to own department teams', async () => {
    teamRepository.list.mockResolvedValue({
      items: [{
        _id: teamId,
        name: 'Sales Team',
        code: 'SALES',
        departmentId,
        status: organizationStatuses.ACTIVE,
      }],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    });

    const result = await organizationService.listTeams({}, {
      actorAuth: {
        permissions: [],
        scopes: [{
          scopeType: 'department',
          scopeId: departmentId,
          permissions: ['TEAMS:READ'],
        }],
      },
    });

    expect(teamRepository.list).toHaveBeenCalledWith({ departmentIds: [departmentId] });
    expect(result.items).toHaveLength(1);
  });

  test('listTeams includes both department and team scoped access', async () => {
    const otherTeamId = '660000000000000000000102';
    teamRepository.list.mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });

    await organizationService.listTeams({}, {
      actorAuth: {
        permissions: [],
        scopes: [
          {
            scopeType: 'department',
            scopeId: departmentId,
            permissions: ['TEAMS:WRITE'],
          },
          {
            scopeType: 'team',
            scopeId: otherTeamId,
            permissions: ['TEAMS:READ'],
          },
        ],
      },
    });

    expect(teamRepository.list).toHaveBeenCalledWith({
      ids: [otherTeamId],
      departmentIds: [departmentId],
    });
  });

  test('getTeam allows read through department scoped TEAMS:WRITE', async () => {
    teamRepository.findById.mockResolvedValue({
      _id: teamId,
      name: 'Sales Team',
      code: 'SALES',
      departmentId,
      status: organizationStatuses.ACTIVE,
    });
    authPublic.canAccessScope.mockImplementation((auth, permission, scope) => (
      permission === 'TEAMS:WRITE'
        && scope.scopeType === 'department'
        && String(scope.scopeId) === departmentId
    ));

    const result = await organizationService.getTeam(teamId, {
      actorAuth: {
        permissions: [],
        scopes: [{
          scopeType: 'department',
          scopeId: departmentId,
          permissions: ['TEAMS:WRITE'],
        }],
      },
    });

    expect(result).toMatchObject({ id: teamId });
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
        roles: ['TEAM_LEADER'],
        permissions: ['TEAMS:READ'],
      })
      .mockResolvedValueOnce({
        account: { _id: memberAccountId, email: 'member@example.com' },
        roles: ['OPERATOR'],
        permissions: ['ORDERS:READ'],
      });

    const result = await organizationService.listTeamMembers(teamId);

    expect(result.team).toMatchObject({ id: teamId, code: 'SALES' });
    expect(result.leaders).toHaveLength(1);
    expect(result.members).toHaveLength(1);
    expect(result.leaders[0]).toMatchObject({
      accountId: leaderAccountId,
      employeeCode: null,
      email: 'leader@example.com',
      memberType: teamMemberTypes.LEADER,
    });
    expect(result.members[0]).toMatchObject({
      accountId: memberAccountId,
      employeeCode: null,
      email: 'member@example.com',
      memberType: teamMemberTypes.MEMBER,
    });
  });

  test('listTeamMembers rejects scoped leader outside own team', async () => {
    teamRepository.findById.mockResolvedValue({
      _id: teamId,
      name: 'Sales Team',
      code: 'SALES',
      departmentId,
      status: organizationStatuses.ACTIVE,
    });
    authPublic.canAccessScope.mockImplementation((auth, permission, scope) => (
      permission === 'TEAMS:READ'
        && scope.scopeType === 'team'
        && String(scope.scopeId) === '660000000000000000000102'
    ));

    await expect(organizationService.listTeamMembers(teamId, {
      actorAuth: {
        permissions: [],
        scopes: [{
          scopeType: 'team',
          scopeId: '660000000000000000000102',
          permissions: ['TEAMS:READ'],
        }],
      },
    })).rejects.toMatchObject({
      statusCode: 403,
      code: 'AUTHORIZATION_ERROR',
    });
  });

  test('addTeamMember accepts an account without a profile', async () => {
    teamRepository.findById.mockResolvedValue({
      _id: teamId,
      name: 'Sales Team',
      code: 'SALES',
      departmentId,
      status: organizationStatuses.ACTIVE,
    });
    authPublic.getCurrentAccount.mockResolvedValue({
      account: { _id: memberAccountId, email: 'j2533@demo.lng.co' },
      roles: ['OPERATOR'],
      permissions: ['ORDERS:READ'],
    });
    teamMembershipRepository.upsertActive.mockResolvedValue({
      accountId: memberAccountId,
      teamId,
      memberType: teamMemberTypes.LEADER,
    });
    teamMembershipRepository.findActiveByAccountId.mockResolvedValue(null);

    const actorAuth = { accountId: leaderAccountId, permissions: ['TEAMS:WRITE'] };
    const result = await organizationService.addTeamMember(teamId, {
      accountId: memberAccountId,
      memberType: teamMemberTypes.LEADER,
    }, { actorAuth, httpContext });

    expect(authPublic.getCurrentAccount).toHaveBeenCalledWith(memberAccountId);
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
      employeeCode: null,
      fullName: null,
      email: 'j2533@demo.lng.co',
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
    }, { actorAuth, httpContext });

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
      { session: expect.any(Object), authContext: actorAuth, httpContext },
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
      { session: expect.any(Object), authContext: undefined, httpContext: undefined },
    );
    expect(authPublic.ensureTeamMemberAssignment).toHaveBeenCalledWith(
      memberAccountId,
      teamId,
      { session: expect.any(Object), authContext: undefined, httpContext: undefined },
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

  test('addTeamMember allows team leader to add staff inside own team', async () => {
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
    authPublic.canAccessScope.mockImplementation((auth, permission, scope) => (
      permission === 'TEAMS:WRITE'
        && scope.scopeType === 'team'
        && String(scope.scopeId) === teamId
    ));
    teamMembershipRepository.findActiveByAccountId.mockResolvedValue(null);
    teamMembershipRepository.upsertActive.mockResolvedValue({
      accountId: memberAccountId,
      teamId,
      memberType: teamMemberTypes.MEMBER,
    });

    const result = await organizationService.addTeamMember(
      teamId,
      {
        accountId: memberAccountId,
        memberType: teamMemberTypes.MEMBER,
      },
      {
        actorAuth: {
          accountId: leaderAccountId,
          permissions: [],
          scopes: [{
            scopeType: 'team',
            scopeId: teamId,
            permissions: ['TEAMS:WRITE'],
          }],
        },
      },
    );

    expect(authPublic.canAccessScope).toHaveBeenCalledWith(
      expect.any(Object),
      'TEAMS:WRITE',
      { scopeType: 'team', scopeId: teamId },
    );
    expect(result).toMatchObject({
      accountId: memberAccountId,
      memberType: teamMemberTypes.MEMBER,
    });
  });

  test('addTeamMember rejects team leader promoting another leader', async () => {
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
    authPublic.canAccessScope.mockImplementation((auth, permission, scope) => (
      permission === 'TEAMS:WRITE'
        && scope.scopeType === 'team'
        && String(scope.scopeId) === teamId
    ));

    await expect(organizationService.addTeamMember(
      teamId,
      {
        accountId: memberAccountId,
        memberType: teamMemberTypes.LEADER,
      },
      {
        actorAuth: {
          accountId: leaderAccountId,
          permissions: [],
          scopes: [{
            scopeType: 'team',
            scopeId: teamId,
            permissions: ['TEAMS:WRITE'],
          }],
        },
      },
    )).rejects.toMatchObject({
      statusCode: 403,
      code: 'AUTHORIZATION_ERROR',
    });

    expect(teamMembershipRepository.upsertActive).not.toHaveBeenCalled();
  });

  test('removeTeamMember deactivates membership and team scoped auth assignments', async () => {
    teamRepository.findById.mockResolvedValue({
      _id: teamId,
      name: 'Sales Team',
      code: 'SALES',
      departmentId,
      status: organizationStatuses.ACTIVE,
    });
    teamMembershipRepository.findActiveByTeamAndAccount.mockResolvedValue({
      accountId: memberAccountId,
      teamId,
      memberType: teamMemberTypes.MEMBER,
    });
    teamMembershipRepository.deactivate.mockResolvedValue({
      accountId: memberAccountId,
      teamId,
      memberType: teamMemberTypes.MEMBER,
    });

    const actorAuth = {
      accountId: '660000000000000000000999',
      permissions: [],
      scopes: [{
        scopeType: 'department',
        scopeId: departmentId,
        permissions: ['TEAMS:WRITE'],
      }],
    };
    const result = await organizationService.removeTeamMember(
      teamId,
      memberAccountId,
      {
        actorAuth,
        httpContext,
      },
    );

    expect(teamMembershipRepository.deactivate).toHaveBeenCalledWith(
      teamId, memberAccountId, { session: expect.any(Object) },
    );
    expect(authPublic.deactivateTeamRoleAssignments).toHaveBeenCalledWith(
      memberAccountId, teamId, { session: expect.any(Object), authContext: actorAuth, httpContext },
    );
    expect(result).toEqual({ removed: true });
  });

  test('removeTeamMember allows team leader to remove staff inside own team', async () => {
    teamRepository.findById.mockResolvedValue({
      _id: teamId,
      name: 'Sales Team',
      code: 'SALES',
      departmentId,
      status: organizationStatuses.ACTIVE,
    });
    authPublic.canAccessScope.mockImplementation((auth, permission, scope) => (
      permission === 'TEAMS:WRITE'
        && scope.scopeType === 'team'
        && String(scope.scopeId) === teamId
    ));
    teamMembershipRepository.findActiveByTeamAndAccount.mockResolvedValue({
      accountId: memberAccountId,
      teamId,
      memberType: teamMemberTypes.MEMBER,
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
          accountId: leaderAccountId,
          permissions: [],
          scopes: [{
            scopeType: 'team',
            scopeId: teamId,
            permissions: ['TEAMS:WRITE'],
          }],
        },
      },
    );

    expect(result).toEqual({ removed: true });
  });

  test('removeTeamMember rejects team leader removing another leader', async () => {
    teamRepository.findById.mockResolvedValue({
      _id: teamId,
      name: 'Sales Team',
      code: 'SALES',
      departmentId,
      status: organizationStatuses.ACTIVE,
    });
    authPublic.canAccessScope.mockImplementation((auth, permission, scope) => (
      permission === 'TEAMS:WRITE'
        && scope.scopeType === 'team'
        && String(scope.scopeId) === teamId
    ));
    teamMembershipRepository.findActiveByTeamAndAccount.mockResolvedValue({
      accountId: leaderAccountId,
      teamId,
      memberType: teamMemberTypes.LEADER,
    });

    await expect(organizationService.removeTeamMember(
      teamId,
      leaderAccountId,
      {
        actorAuth: {
          accountId: memberAccountId,
          permissions: [],
          scopes: [{
            scopeType: 'team',
            scopeId: teamId,
            permissions: ['TEAMS:WRITE'],
          }],
        },
      },
    )).rejects.toMatchObject({
      statusCode: 403,
      code: 'AUTHORIZATION_ERROR',
    });

    expect(teamMembershipRepository.deactivate).not.toHaveBeenCalled();
  });
});
