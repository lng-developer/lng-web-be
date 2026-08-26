const Account = require('../../../src/modules/auth/models/account.model');

describe('Account model indexes', () => {
  test('indexes the active chat directory by its email sort order', () => {
    expect(Account.schema.indexes().map(([fields]) => fields)).toContainEqual({
      status: 1,
      email: 1,
    });
  });
});
