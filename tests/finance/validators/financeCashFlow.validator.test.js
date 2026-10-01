const { validate, listCashFlowQuerySchema } = require('../../../src/modules/finance/validators/financeCashFlow.validator');
const { accessibleShopIds } = require('../../../src/modules/finance/services/financeAccess.service');

describe('finance cash flow validation and access', () => {
  test('accepts only known cash-flow query fields', () => {
    const result = validate(listCashFlowQuerySchema, {
      status: 'UNLINKED',
      currency: 'usd',
      page: 2,
      limit: 20,
      unsafe: true,
    });

    expect(result.details).toBeUndefined();
    expect(result.value).toEqual({ status: 'UNLINKED', currency: 'USD', page: 2, limit: 20 });
  });

  test('returns only shop scopes for a non-global Finance reader', () => {
    expect(accessibleShopIds({
      scopes: [
        { scopeType: 'shop', scopeId: 'shop-1', permissions: ['FINANCE:READ'] },
        { scopeType: 'team', scopeId: 'team-1', permissions: ['FINANCE:READ'] },
      ],
    })).toEqual(['shop-1']);
  });
})
