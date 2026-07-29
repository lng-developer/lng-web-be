jest.mock('../../../modules/auth/public', () => ({
  syncScopeRegistry: jest.fn(),
}));

jest.mock('../../../modules/shop/repositories/shop.repository', () => ({
  create: jest.fn(),
  findById: jest.fn(),
  updateStatus: jest.fn(),
  list: jest.fn(),
}));

const authPublic = require('../../../modules/auth/public');
const mongoose = require('mongoose');
const shopRepository = require('../../../modules/shop/repositories/shop.repository');
const shopService = require('../../../modules/shop/services/shop.service');

describe('shopService', () => {
  const shopId = '660000000000000000000001';
  const otherShopId = '660000000000000000000002';

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(mongoose, 'startSession').mockResolvedValue({
      withTransaction: async (callback) => callback(),
      endSession: jest.fn(),
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('createShop creates shop and syncs ScopeRegistry', async () => {
    shopRepository.create.mockResolvedValue({
      _id: shopId,
      name: 'LNG Amazon US',
      currency: 'USD',
      status: 'ACTIVE',
    });
    authPublic.syncScopeRegistry.mockResolvedValue({});

    const result = await shopService.createShop({
      name: 'LNG Amazon US',
      currency: 'USD',
    });

    expect(shopRepository.create).toHaveBeenCalledWith({
      name: 'LNG Amazon US',
      currency: 'USD',
      status: 'ACTIVE',
    }, { session: expect.any(Object) });
    expect(authPublic.syncScopeRegistry).toHaveBeenCalledWith({
      scopeType: 'shop',
      scopeId: shopId,
      name: 'LNG Amazon US',
      status: 'active',
    }, undefined, undefined, { session: expect.any(Object) });
    expect(result).toMatchObject({
      id: shopId,
      name: 'LNG Amazon US',
      status: 'ACTIVE',
    });
  });

  test('updateShopStatus syncs inactive ScopeRegistry status', async () => {
    shopRepository.updateStatus.mockResolvedValue({
      _id: shopId,
      name: 'LNG Amazon US',
      currency: 'USD',
      status: 'SUSPENDED',
    });
    authPublic.syncScopeRegistry.mockResolvedValue({});

    const result = await shopService.updateShopStatus(shopId, 'SUSPENDED');

    expect(shopRepository.updateStatus).toHaveBeenCalledWith(
      shopId, 'SUSPENDED', { session: expect.any(Object) },
    );
    expect(authPublic.syncScopeRegistry).toHaveBeenCalledWith({
      scopeType: 'shop',
      scopeId: shopId,
      name: 'LNG Amazon US',
      status: 'inactive',
    }, undefined, undefined, { session: expect.any(Object) });
    expect(result.status).toBe('SUSPENDED');
  });

  test('global SHOPS:READ can list all shops', async () => {
    shopRepository.list.mockResolvedValue({
      items: [{ _id: shopId, name: 'LNG Amazon US', currency: 'USD', status: 'ACTIVE' }],
      total: 1,
      page: 1,
      limit: 20,
    });

    const result = await shopService.listShops(
      { page: 1, limit: 20 },
      { permissions: ['SHOPS:READ'], scopes: [] },
    );

    expect(shopRepository.list).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(result.items).toHaveLength(1);
    expect(result.pagination).toEqual({ total: 1, page: 1, limit: 20 });
  });

  test('scoped SHOPS:READ can only list assigned shops', async () => {
    shopRepository.list.mockResolvedValue({
      items: [{ _id: shopId, name: 'LNG Amazon US', currency: 'USD', status: 'ACTIVE' }],
      total: 1,
      page: 1,
      limit: 20,
    });

    await shopService.listShops(
      { page: 1, limit: 20 },
      {
        permissions: [],
        scopes: [
          { scopeType: 'shop', scopeId: shopId, permissions: ['SHOPS:READ'] },
          { scopeType: 'shop', scopeId: otherShopId, permissions: ['SHOPS:WRITE'] },
        ],
      },
    );

    expect(shopRepository.list).toHaveBeenCalledWith({
      page: 1,
      limit: 20,
      shopIds: [shopId],
    });
  });

  test('scoped FINANCE:READ can list assigned shops for finance filters', async () => {
    shopRepository.list.mockResolvedValue({
      items: [{ _id: shopId, name: 'LNG Amazon US', currency: 'USD', status: 'ACTIVE' }],
      total: 1,
      page: 1,
      limit: 100,
    });

    const result = await shopService.listShops(
      { page: 1, limit: 100 },
      {
        permissions: [],
        scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['FINANCE:READ'] }],
      },
    );

    expect(shopRepository.list).toHaveBeenCalledWith({
      page: 1,
      limit: 100,
      shopIds: [shopId],
    });
    expect(result.items).toEqual([expect.objectContaining({ id: shopId, name: 'LNG Amazon US' })]);
  });

  test('no scoped access returns empty paginated list', async () => {
    const result = await shopService.listShops(
      { page: 2, limit: 10 },
      { permissions: [], scopes: [] },
    );

    expect(shopRepository.list).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: [],
      pagination: {
        total: 0,
        page: 2,
        limit: 10,
      },
    });
  });
});
