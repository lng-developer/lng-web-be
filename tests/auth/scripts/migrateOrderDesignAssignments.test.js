const { buildOrderDesignAssignmentPlan } = require('../../../src/modules/auth/scripts/migrateOrderDesignAssignments');

test('plans only Sales and Design members and leaders for own/global operational roles', () => {
  const plan = buildOrderDesignAssignmentPlan({
    rolesByCode: new Map([
      ['CS_OPERATOR', { _id: 'role-sales-member' }],
      ['SALES_LEADER', { _id: 'role-sales-leader' }],
      ['DESIGNER', { _id: 'role-design-member' }],
      ['DESIGN_LEADER', { _id: 'role-design-leader' }],
    ]),
    accountsById: new Map([
      ['sales-member', { _id: 'sales-member', email: 'sales@example.com' }],
      ['sales-leader', { _id: 'sales-leader', email: 'sales-leader@example.com' }],
      ['design-member', { _id: 'design-member', email: 'design@example.com' }],
      ['design-leader', { _id: 'design-leader', email: 'design-leader@example.com' }],
      ['dev-member', { _id: 'dev-member', email: 'dev@example.com' }],
    ]),
    teamsById: new Map([
      ['sales-team', { _id: 'sales-team', code: 'SALE1' }],
      ['design-team', { _id: 'design-team', code: 'DES' }],
      ['dev-team', { _id: 'dev-team', code: 'DEV' }],
    ]),
    memberships: [
      { accountId: 'sales-member', teamId: 'sales-team', memberType: 'member' },
      { accountId: 'sales-leader', teamId: 'sales-team', memberType: 'leader' },
      { accountId: 'design-member', teamId: 'design-team', memberType: 'member' },
      { accountId: 'design-leader', teamId: 'design-team', memberType: 'leader' },
      { accountId: 'dev-member', teamId: 'dev-team', memberType: 'member' },
    ],
    assignments: [],
  });

  expect(plan.create.map((target) => [target.accountId, target.roleCode, target.scopeType]).sort()).toEqual([
    ['design-leader', 'DESIGN_LEADER', 'global'],
    ['design-member', 'DESIGNER', 'own'],
    ['sales-leader', 'SALES_LEADER', 'global'],
    ['sales-member', 'CS_OPERATOR', 'own'],
  ]);
  expect(plan.deactivate).toEqual([]);
});

test('deactivates obsolete global member assignments while retaining intended assignments', () => {
  const plan = buildOrderDesignAssignmentPlan({
    rolesByCode: new Map([
      ['CS_OPERATOR', { _id: 'role-sales-member' }],
      ['SALES_LEADER', { _id: 'role-sales-leader' }],
      ['DESIGNER', { _id: 'role-design-member' }],
      ['DESIGN_LEADER', { _id: 'role-design-leader' }],
    ]),
    accountsById: new Map([['sales-member', { _id: 'sales-member', email: 'sales@example.com' }]]),
    teamsById: new Map([['sales-team', { _id: 'sales-team', code: 'SALE1' }]]),
    memberships: [{ accountId: 'sales-member', teamId: 'sales-team', memberType: 'member' }],
    assignments: [
      { _id: 'old-global', accountId: 'sales-member', roleId: 'role-sales-member', scopeType: 'global', scopeId: null, status: 'active' },
      { _id: 'own-role', accountId: 'sales-member', roleId: 'role-sales-member', scopeType: 'own', scopeId: null, status: 'active' },
    ],
  });

  expect(plan.create).toEqual([]);
  expect(plan.keep).toHaveLength(1);
  expect(plan.deactivate).toEqual([expect.objectContaining({ assignmentId: 'old-global' })]);
});

test('deactivates every legacy global CS operator assignment, including accounts outside SALE1', () => {
  const plan = buildOrderDesignAssignmentPlan({
    rolesByCode: new Map([
      ['CS_OPERATOR', { _id: 'role-sales-member' }],
      ['SALES_LEADER', { _id: 'role-sales-leader' }],
      ['DESIGNER', { _id: 'role-design-member' }],
      ['DESIGN_LEADER', { _id: 'role-design-leader' }],
    ]),
    accountsById: new Map(),
    teamsById: new Map(),
    memberships: [],
    assignments: [{
      _id: 'legacy-global',
      accountId: 'legacy-account',
      roleId: 'role-sales-member',
      scopeType: 'global',
      scopeId: null,
      status: 'active',
    }],
  });

  expect(plan.deactivate).toEqual([expect.objectContaining({ assignmentId: 'legacy-global' })]);
});
