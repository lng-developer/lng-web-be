const shopRepository = require('../../src/modules/shop/repositories/shop.repository');
const shopPublic = require('../../src/modules/shop/public');

jest.mock('../../src/modules/shop/repositories/shop.repository', () => ({
  findById: jest.fn(),
  findByIds: jest.fn(),
  listActiveForOptions: jest.fn(),
}));

describe('shop public port', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('assertShopIsActive returns shop if ACTIVE', async () => {
    const shop = { _id: 'shop-id', name: 'LNG Amazon US', status: 'ACTIVE' };
    shopRepository.findById.mockResolvedValue(shop);

    await expect(shopPublic.assertShopIsActive('shop-id')).resolves.toBe(shop);
  });

  test('findByIds returns shops from the repository boundary', async () => {
    const shops = [{ _id: 'shop-1' }, { _id: 'shop-2' }];
    shopRepository.findByIds.mockResolvedValue(shops);

    await expect(shopPublic.findByIds(['shop-1', 'shop-2'])).resolves.toBe(shops);
    expect(shopRepository.findByIds).toHaveBeenCalledWith(['shop-1', 'shop-2']);
  });

  test('lists compact active shops through the public port', async () => {
    const shops = [{ _id: 'shop-1', name: 'LNG Amazon US' }];
    shopRepository.listActiveForOptions.mockResolvedValue(shops);

    await expect(shopPublic.listActiveShopOptions({ shopIds: ['shop-1'] })).resolves.toBe(shops);
    expect(shopRepository.listActiveForOptions).toHaveBeenCalledWith({ shopIds: ['shop-1'] });
  });

  test('assertShopIsActive throws 404 if shop does not exist', async () => {
    shopRepository.findById.mockResolvedValue(null);

    await expect(shopPublic.assertShopIsActive('missing-shop-id')).rejects.toMatchObject({
      statusCode: 404,
      code: 'RESOURCE_NOT_FOUND',
    });
  });

  test('assertShopIsActive throws 409 if shop is INACTIVE', async () => {
    shopRepository.findById.mockResolvedValue({ _id: 'shop-id', status: 'INACTIVE' });

    await expect(shopPublic.assertShopIsActive('shop-id')).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });
  });

  test('assertShopIsActive throws 409 if shop is SUSPENDED', async () => {
    shopRepository.findById.mockResolvedValue({ _id: 'shop-id', status: 'SUSPENDED' });

    await expect(shopPublic.assertShopIsActive('shop-id')).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT_ERROR',
    });
  });
});
