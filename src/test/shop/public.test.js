const shopRepository = require('../../modules/shop/repositories/shop.repository');
const shopPublic = require('../../modules/shop/public');

jest.mock('../../modules/shop/repositories/shop.repository', () => ({
  findById: jest.fn(),
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
