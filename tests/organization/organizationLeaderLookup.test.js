const organizationPublic = require('../../src/modules/organization/public');
const organizationService = require('../../src/modules/organization/services/organization.service');
const teamMembershipRepository = require('../../src/modules/organization/repositories/teamMembership.repository');

jest.mock('../../src/modules/organization/repositories/teamMembership.repository', () => ({
  listActiveOrganizationByAccountIds: jest.fn(),
  listActiveLeadersByTeamIds: jest.fn(),
}));

describe('organizationPublic.listLeadersForAccountIds', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns empty array when accountIds is empty', async () => {
    const result = await organizationPublic.listLeadersForAccountIds([]);
    expect(result).toEqual([]);
    expect(teamMembershipRepository.listActiveOrganizationByAccountIds).not.toHaveBeenCalled();
  });

  it('returns unique leader account IDs for teams of the given staff accounts', async () => {
    teamMembershipRepository.listActiveOrganizationByAccountIds.mockResolvedValue([
      { accountId: 'staff-1', team: { id: 'team-1', name: 'Team Alpha' } },
      { accountId: 'staff-2', team: { id: 'team-1', name: 'Team Alpha' } },
      { accountId: 'staff-3', team: { id: 'team-2', name: 'Team Beta' } },
    ]);
    teamMembershipRepository.listActiveLeadersByTeamIds.mockResolvedValue(['leader-1', 'leader-2']);

    const leaders = await organizationPublic.listLeadersForAccountIds(['staff-1', 'staff-2', 'staff-3']);

    expect(teamMembershipRepository.listActiveOrganizationByAccountIds).toHaveBeenCalledWith(['staff-1', 'staff-2', 'staff-3']);
    expect(teamMembershipRepository.listActiveLeadersByTeamIds).toHaveBeenCalledWith(['team-1', 'team-2']);
    expect(leaders).toEqual(['leader-1', 'leader-2']);
  });

  it('handles accounts with no active team gracefully', async () => {
    teamMembershipRepository.listActiveOrganizationByAccountIds.mockResolvedValue([
      { accountId: 'staff-orphan', team: null },
    ]);

    const leaders = await organizationPublic.listLeadersForAccountIds(['staff-orphan']);
    expect(leaders).toEqual([]);
    expect(teamMembershipRepository.listActiveLeadersByTeamIds).not.toHaveBeenCalled();
  });
});
