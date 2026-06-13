const TeamMembership = require('./teamMembership.model');
const { organizationStatuses } = require('../constants');

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
