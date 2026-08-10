const access = require('../../../src/modules/finance/services/financeAccess.service');

describe('financeAccess.service', () => {
  const permission = 'FINANCE:READ';

  test('global read is unrestricted', () => {
    expect(access.scopedQuery({ costStatus: 'MISSING' }, { permissions: [permission] })).toEqual({ costStatus: 'MISSING' });
  });

  test('combines department, team, shop, and own assignments as an allowed union', () => {
    const auth = {
      accountId: '660000000000000000000001', permissions: [],
      scopes: [
        { scopeType: 'department', scopeId: '660000000000000000000002', permissions: [permission] },
        { scopeType: 'team', scopeId: '660000000000000000000003', permissions: [permission] },
        { scopeType: 'shop', scopeId: '660000000000000000000004', permissions: [permission] },
        { scopeType: 'own', scopeId: null, permissions: [permission] },
      ],
    };
    expect(access.scopedQuery({}, auth).accessOr).toEqual([
      { departmentId: '660000000000000000000002' },
      { teamId: '660000000000000000000003' },
      { shopId: '660000000000000000000004' },
      { sellerAccountId: '660000000000000000000001' },
    ]);
  });

  test('no assignment produces a deny-all filter', () => {
    expect(access.scopedQuery({}, { permissions: [], scopes: [] })).toEqual({ accessOr: [] });
  });
});
