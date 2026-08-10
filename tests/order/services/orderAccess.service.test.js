jest.mock('../../../src/modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

const authPublic = require('../../../src/modules/auth/public');
const access = require('../../../src/modules/order/services/orderAccess.service');

describe('orderAccess.service', () => {
  const shopId = '660000000000000000000201';

  beforeEach(() => {
    jest.clearAllMocks();
    authPublic.canAccessScope.mockReturnValue(false);
  });

  test('treats scoped write access as read and write access', () => {
    authPublic.canAccessScope.mockImplementation((_auth, permission) => permission === 'ORDERS:WRITE');

    expect(access.canReadShop(shopId, { permissions: [], scopes: [] })).toBe(true);
    expect(access.canWriteShop(shopId, { permissions: [], scopes: [] })).toBe(true);
  });

  test('does not treat scoped read access as write access', () => {
    authPublic.canAccessScope.mockImplementation((_auth, permission) => permission === 'ORDERS:READ');

    expect(access.canWriteShop(shopId, { permissions: [], scopes: [] })).toBe(false);
  });

  test('does not treat global read access as write access', () => {
    const authContext = { permissions: ['ORDERS:READ'] };

    expect(access.canReadShop(shopId, authContext)).toBe(true);
    expect(access.canWriteShop(shopId, authContext)).toBe(false);
  });

  test('rejects unauthorized shop access with the authorization AppError contract', () => {
    const authContext = { permissions: [], scopes: [] };

    expect(() => access.assertCanReadShop(shopId, authContext)).toThrow(expect.objectContaining({
      statusCode: 403,
      code: 'AUTHORIZATION_ERROR',
      isOperational: true,
    }));
    expect(() => access.assertCanWriteShop(shopId, authContext)).toThrow(expect.objectContaining({
      statusCode: 403,
      code: 'AUTHORIZATION_ERROR',
      isOperational: true,
    }));
  });

  test('returns null for global read, scoped read and write shop IDs, or no access', () => {
    expect(access.getReadableShopIds({ permissions: ['ORDERS:WRITE'] })).toBeNull();
    expect(access.getReadableShopIds({
      permissions: [],
      scopes: [
        { scopeType: 'shop', scopeId: shopId, permissions: ['ORDERS:READ'] },
        { scopeType: 'shop', scopeId: shopId, permissions: ['ORDERS:WRITE'] },
        { scopeType: 'shop', scopeId: '660000000000000000000202', permissions: ['ORDERS:WRITE'] },
      ],
    })).toEqual([shopId, '660000000000000000000202']);
    expect(access.getReadableShopIds({ permissions: [], scopes: [] })).toEqual([]);
  });

  test('uses the current account as the fallback constraint for non-shop scoped readers', () => {
    const authContext = {
      accountId: '660000000000000000000901',
      permissions: [],
      scopes: [{ scopeType: 'team', scopeId: '660000000000000000000801', permissions: ['ORDERS:READ'] }],
    };

    expect(access.getOrderReadConstraint(authContext)).toEqual({
      shopIds: [],
      assignedStaffIds: ['660000000000000000000901'],
    });
  });

  test('allows a non-shop scoped reader to read an order assigned to their account', () => {
    const authContext = {
      accountId: '660000000000000000000901',
      permissions: [],
      scopes: [{ scopeType: 'team', scopeId: '660000000000000000000801', permissions: ['ORDERS:READ'] }],
    };

    expect(access.canReadOrder({ shopId, assignedStaffIds: [authContext.accountId] }, authContext)).toBe(true);
    expect(access.canReadOrder({ shopId, assignedStaffIds: ['660000000000000000000902'] }, authContext)).toBe(false);
  });
});
