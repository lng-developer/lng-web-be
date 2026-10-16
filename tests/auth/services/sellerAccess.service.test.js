const { personalSellerAccountId } = require('../../../src/modules/auth/services/sellerAccess.service');

test('ordinary Sales uses SKU ownership even when granted shop or team access', () => {
  expect(personalSellerAccountId({ accountId: 'seller-a', scopes: [{ roles: ['SALES'], scopeType: 'team' }] })).toBe('seller-a');
  expect(personalSellerAccountId({ accountId: 'seller-a', roles: ['SALES'] })).toBe('seller-a');
});

test('administrative, leader, and system access is not silently narrowed', () => {
  for (const role of ['ADMIN', 'SUPER_ADMIN', 'SYSTEM_ADMIN', 'SALES_LEADER']) {
    expect(personalSellerAccountId({ accountId: 'a', roles: ['SALES', role] })).toBeNull();
  }
  expect(personalSellerAccountId({ system: true, accountId: 'a', roles: ['SALES'] })).toBeNull();
});
