const {
  buildProductionScaleAssignmentPlan,
} = require('../../../src/modules/auth/scripts/migrateProductionScaleAssignments');

test('plans Scale team roles without changing unrelated CS operator assignments', () => {
  const plan = buildProductionScaleAssignmentPlan({
    rolesByCode: new Map([
      ['SCALE_OPERATOR', { _id: 'role-scale-operator' }],
      ['SCALE_LEADER', { _id: 'role-scale-leader' }],
      ['CS_OPERATOR', { _id: 'role-cs-operator' }],
    ]),
    accountsById: new Map([
      ['scale-member', { _id: 'scale-member', email: 'scale@example.com' }],
      ['scale-leader', { _id: 'scale-leader', email: 'scale-leader@example.com' }],
      ['sales-member', { _id: 'sales-member', email: 'sales@example.com' }],
    ]),
    teamsById: new Map([
      ['design-team', { _id: 'design-team', code: 'DES' }],
      ['sales-team', { _id: 'sales-team', code: 'SALE1' }],
    ]),
    memberships: [
      { accountId: 'scale-member', teamId: 'design-team', memberType: 'member' },
      { accountId: 'scale-leader', teamId: 'design-team', memberType: 'leader' },
      { accountId: 'sales-member', teamId: 'sales-team', memberType: 'member' },
    ],
    assignments: [
      {
        _id: 'scale-cs-role', accountId: 'scale-member', roleId: 'role-cs-operator',
        scopeType: 'own', scopeId: null, status: 'active',
      },
      {
        _id: 'sales-own', accountId: 'sales-member', roleId: 'role-cs-operator',
        scopeType: 'own', scopeId: null, status: 'active',
      },
    ],
  });

  expect(plan.create.map((target) => [target.accountId, target.roleCode, target.scopeType]).sort()).toEqual([
    ['scale-leader', 'SCALE_LEADER', 'global'],
    ['scale-member', 'SCALE_OPERATOR', 'own'],
  ]);
  expect(plan.deactivate).toEqual([]);
});
