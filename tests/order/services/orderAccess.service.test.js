jest.mock('../../../src/modules/auth/public', () => ({
  canAccessScope: jest.fn(),
}));

jest.mock('../../../src/modules/organization/public', () => ({
  listTeamMembers: jest.fn(),
  listTeamMemberAccess: jest.fn(),
}));

const authPublic = require('../../../src/modules/auth/public');
const organizationPublic = require('../../../src/modules/organization/public');
const access = require('../../../src/modules/order/services/orderAccess.service');

describe('orderAccess.service', () => {
  const shopId = '660000000000000000000201';

  beforeEach(() => {
    jest.clearAllMocks();
    authPublic.canAccessScope.mockReturnValue(false);
    organizationPublic.listTeamMemberAccess.mockResolvedValue([]);
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

  test('uses the current account as the fallback constraint for own-scoped readers', async () => {
    const authContext = {
      accountId: '660000000000000000000901',
      permissions: [],
      scopes: [{ scopeType: 'own', scopeId: null, permissions: ['ORDERS:READ'] }],
    };

    await expect(access.getOrderReadConstraint(authContext)).resolves.toEqual({
      shopIds: [],
      assignedStaffIds: ['660000000000000000000901'],
    });
  });

  test('allows an own-scoped reader to read an order assigned to their account', async () => {
    const authContext = {
      accountId: '660000000000000000000901',
      permissions: [],
      scopes: [{ scopeType: 'own', scopeId: null, permissions: ['ORDERS:READ'] }],
    };

    await expect(access.canReadOrder({ shopId, assignedStaffIds: [authContext.accountId] }, authContext)).resolves.toBe(true);
    await expect(access.canReadOrder({ shopId, assignedStaffIds: ['660000000000000000000902'] }, authContext)).resolves.toBe(false);
  });

  test('allows own-scoped writers only on orders assigned to their account', async () => {
    const authContext = {
      accountId: '660000000000000000000901',
      permissions: [],
      scopes: [{ scopeType: 'own', scopeId: null, permissions: ['ORDERS:WRITE'] }],
    };

    await expect(access.canWriteOrder({ shopId, assignedStaffIds: [authContext.accountId] }, authContext)).resolves.toBe(true);
    await expect(access.canWriteOrder({ shopId, assignedStaffIds: ['660000000000000000000902'] }, authContext)).resolves.toBe(false);
    await expect(access.assertCanWriteOrder({ shopId, assignedStaffIds: [] }, authContext)).rejects.toMatchObject({
      statusCode: 403,
      code: 'AUTHORIZATION_ERROR',
    });
  });

  test('constrains a team member to own assigned orders', async () => {
    const authContext = {
      accountId: '660000000000000000000901',
      permissions: [],
      scopes: [{
        scopeType: 'team',
        scopeId: '660000000000000000000101',
        permissions: ['ORDERS:READ', 'ORDERS:WRITE'],
      }],
    };
    organizationPublic.listTeamMemberAccess.mockResolvedValue([
      { accountId: '660000000000000000000900', memberType: 'LEADER' },
      { accountId: authContext.accountId, memberType: 'MEMBER' },
      { accountId: '660000000000000000000902', memberType: 'MEMBER' },
    ]);

    await expect(access.getOrderReadConstraint(authContext)).resolves.toEqual({
      shopIds: [],
      assignedStaffIds: [authContext.accountId],
    });
    await expect(access.canReadOrder({ shopId, assignedStaffIds: [authContext.accountId] }, authContext)).resolves.toBe(true);
    await expect(access.canReadOrder({ shopId, assignedStaffIds: ['660000000000000000000902'] }, authContext)).resolves.toBe(false);
  });

  test('allows a team leader to read every assigned order in their team', async () => {
    const authContext = {
      accountId: '660000000000000000000900',
      permissions: [],
      scopes: [{
        scopeType: 'team',
        scopeId: '660000000000000000000101',
        permissions: ['ORDERS:READ', 'ORDERS:WRITE'],
      }],
    };
    organizationPublic.listTeamMemberAccess.mockResolvedValue([
      { accountId: authContext.accountId, memberType: 'leader' },
      { accountId: '660000000000000000000901', memberType: 'MEMBER' },
      { accountId: '660000000000000000000902', memberType: 'MEMBER' },
    ]);

    await expect(access.getOrderReadConstraint(authContext)).resolves.toEqual({
      shopIds: [],
      assignedStaffIds: [
        authContext.accountId,
        '660000000000000000000901',
        '660000000000000000000902',
      ],
    });
    await expect(access.canReadOrder({ shopId, assignedStaffIds: ['660000000000000000000902'] }, authContext)).resolves.toBe(true);
  });
});
