const { buildSalesLeaderPlan } = require('../../../src/modules/auth/scripts/migrateSalesLeaderOrders');

test('plans one global Sales Leader assignment for active leaders in sales teams', () => {
  const plan = buildSalesLeaderPlan({
    salesLeaderRole: { _id: 'role-sales-leader' },
    accountsById: new Map([
      ['account-1', { _id: 'account-1', email: 'leader@example.com' }],
      ['account-2', { _id: 'account-2', email: 'non-sales@example.com' }],
    ]),
    teamsById: new Map([
      ['team-sales', { _id: 'team-sales', code: 'SALE1' }],
      ['team-design', { _id: 'team-design', code: 'DES' }],
    ]),
    memberships: [
      { accountId: 'account-1', teamId: 'team-sales', memberType: 'leader' },
      { accountId: 'account-2', teamId: 'team-design', memberType: 'leader' },
    ],
    assignments: [],
  });

  expect(plan.create).toEqual([expect.objectContaining({
    accountId: 'account-1',
    teamCode: 'SALE1',
    scopeType: 'global',
  })]);
  expect(plan.keep).toEqual([]);
});

test('does not duplicate an active global Sales Leader assignment', () => {
  const plan = buildSalesLeaderPlan({
    salesLeaderRole: { _id: 'role-sales-leader' },
    accountsById: new Map([['account-1', { _id: 'account-1', email: 'leader@example.com' }]]),
    teamsById: new Map([['team-sales', { _id: 'team-sales', code: 'KD' }]]),
    memberships: [{ accountId: 'account-1', teamId: 'team-sales', memberType: 'leader' }],
    assignments: [{ accountId: 'account-1', roleId: 'role-sales-leader', scopeType: 'global', scopeId: null, status: 'active' }],
  });

  expect(plan.create).toEqual([]);
  expect(plan.keep).toHaveLength(1);
});
