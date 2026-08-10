const TeamMembership = require('../../../src/modules/organization/models/teamMembership.model');
const { organizationStatuses } = require('../../../src/modules/organization/constants');

describe('TeamMembership model', () => {
  test('enforces one active team membership per account', () => {
    const indexes = TeamMembership.schema.indexes();
    const accountUniqueIndex = indexes.find(([fields, options]) => (
      fields.accountId === 1
      && options.unique === true
      && options.partialFilterExpression?.status === organizationStatuses.ACTIVE
    ));

    expect(accountUniqueIndex).toBeDefined();
  });
});
