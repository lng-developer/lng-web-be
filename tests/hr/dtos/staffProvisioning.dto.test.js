const { toAssignableRoleCatalogDto } = require('../../../src/modules/hr/dtos/staffProvisioning.dto');

describe('staff provisioning DTOs', () => {
  test('returns only role fields safe for the HR provisioning picker', () => {
    expect(toAssignableRoleCatalogDto([{
      _id: '660000000000000000000005',
      code: 'OPERATOR',
      name: 'Operator',
      description: 'Handles daily operations',
      permissions: ['660000000000000000000010'],
    }])).toEqual([{
      id: '660000000000000000000005',
      name: 'Operator',
      description: 'Handles daily operations',
    }]);
  });
});
