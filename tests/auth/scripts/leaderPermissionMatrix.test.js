const { buildLeaderPermissionPlan } = require('../../../src/modules/auth/scripts/migrateLeaderPermissionMatrix');

const hr = ['HR_EMPLOYEES:READ', 'HR_SCHEDULE:READ', 'HR_ATTENDANCE:READ', 'HR_LEAVE:READ', 'HR_LEAVE:APPROVE', 'HR_OVERTIME:READ', 'HR_OVERTIME:APPROVE', 'HR_CALENDAR:READ', 'HR_SATURDAY_ROTATION:WRITE'];
function fixture() {
  return {
    permissions: [...hr, 'REPORTS:READ', 'CATALOG:READ', 'DESIGN:REVIEW'].map(code => ({ _id: code, code })),
    roles: [{ _id: 'leader', code: 'LEADER', name: 'Leader', permissions: [...hr, 'REPORTS:READ'] }, { _id: 'sales', code: 'SALES_LEADER', permissions: ['CATALOG:READ'] }, { _id: 'design', code: 'DESIGN_LEADER', permissions: ['CATALOG:READ', 'DESIGN:REVIEW'] }],
    scopedRules: [{ _id: 'rule', roleId: 'leader', scopeType: 'team', scopeId: 'A', permissions: ['REPORTS:READ'] }],
    assignments: [{ _id: 'a', accountId: 'user', roleId: 'leader', scopeType: 'team', scopeId: 'A', status: 'active', customPermissions: ['CATALOG:READ'] }, { _id: 'b', accountId: 'user', roleId: 'design', scopeType: 'team', scopeId: 'A', status: 'active' }],
  };
}
test('normalizes leader inheritance and extras without removing separate Design grants', () => {
  const context = fixture();
  const before = JSON.stringify(context);
  const plan = buildLeaderPermissionPlan(context);
  expect(JSON.stringify(context)).toBe(before);
  expect(plan.blockers).toEqual([]);
  expect(plan.changes.find(c => c.id === 'leader').after.permissions).toEqual(hr);
  expect(plan.changes.find(c => c.id === 'rule').after.permissions).toEqual(hr);
  expect(plan.changes.find(c => c.id === 'a').after.customPermissions).toEqual([]);
  expect(plan.changes.some(c => c.id === 'design' || c.id === 'b')).toBe(false);
  expect(plan.impacts.find(i => i.accountId === 'user').removed).toContain('REPORTS:READ');
  expect(plan.impacts.find(i => i.accountId === 'user').after).toContain('DESIGN:REVIEW');
});
test('preserves explicit deny override and flags non-team leaders rather than broadening scopes', () => {
  const context = fixture();
  context.assignments[0].overridePermissions = [];
  context.assignments[0].scopeType = 'global';
  const plan = buildLeaderPermissionPlan(context);
  expect(plan.blockers).toContain('NON_TEAM_ASSIGNMENT:a');
  expect(plan.impacts[0].after).not.toContain('HR_LEAVE:APPROVE');
});
test('keeps Sales report within its assigned team and does not bypass explicit overrides', () => {
  const context = fixture();
  context.assignments = [{ _id: 's', roleId: 'sales', accountId: 'seller', scopeType: 'team', scopeId: 'S', status: 'active' }];
  context.scopedRules.push({ _id: 'sr', roleId: 'sales', scopeType: 'team', scopeId: 'S', permissions: ['CATALOG:READ'] });
  const plan = buildLeaderPermissionPlan(context);
  expect(plan.changes.find(c => c.id === 'sr').after.permissions).toContain('REPORTS:READ');
  expect(plan.impacts[0]).toMatchObject({ scopeType: 'team', scopeId: 'S', added: ['REPORTS:READ'] });
  context.assignments[0].overridePermissions = ['CATALOG:READ'];
  expect(buildLeaderPermissionPlan(context).warnings).toContain('SALES_REPORT_OVERRIDE:s');
});
test('reapplying a completed plan produces no changes', () => {
  const context = fixture();
  for (const c of buildLeaderPermissionPlan(context).changes) {
    const group = { roles: context.roles, scopedRules: context.scopedRules, assignments: context.assignments }[c.collection];
    Object.assign(group.find(d => d._id === c.id), c.after);
  }
  expect(buildLeaderPermissionPlan(context).changes).toEqual([]);
});
