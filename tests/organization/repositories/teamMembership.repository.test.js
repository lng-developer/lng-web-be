jest.mock('mongoose', () => ({
  Types: { ObjectId: class ObjectId { constructor(value) { this.value = value; } } },
}));
jest.mock('../../../src/modules/organization/models/teamMembership.model', () => ({ find: jest.fn() }));

const TeamMembership = require('../../../src/modules/organization/models/teamMembership.model');
const repository = require('../../../src/modules/organization/repositories/teamMembership.repository');
const { organizationStatuses, teamMemberTypes } = require('../../../src/modules/organization/constants');

test('lists active leaders for the requested teams', async () => {
  const lean = jest.fn().mockResolvedValue([{ accountId: 'leader-1' }]);
  const select = jest.fn().mockReturnValue({ lean });
  TeamMembership.find.mockReturnValue({ select });

  await expect(repository.listActiveLeadersByTeamIds(['team-1'])).resolves.toEqual(['leader-1']);

  expect(TeamMembership.find).toHaveBeenCalledWith({
    teamId: { $in: [expect.anything()] },
    memberType: teamMemberTypes.LEADER,
    status: organizationStatuses.ACTIVE,
  });
});
