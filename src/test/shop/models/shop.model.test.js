const Shop = require('../../../modules/shop/models/shop.model');
const { shopStatuses } = Shop;

describe('Shop model', () => {
  test('creates shop with default currency USD', () => {
    const shop = new Shop({ name: 'LNG Amazon US' });

    expect(shop.currency).toBe('USD');
  });

  test('creates shop with default status ACTIVE', () => {
    const shop = new Shop({ name: 'LNG Amazon US' });

    expect(shop.status).toBe(shopStatuses.ACTIVE);
  });

  test('trims name', async () => {
    const shop = new Shop({ name: '  LNG Amazon US  ' });

    await expect(shop.validate()).resolves.toBeUndefined();

    expect(shop.name).toBe('LNG Amazon US');
  });

  test('uppercases currency', async () => {
    const shop = new Shop({ name: 'LNG Amazon US', currency: 'usd' });

    await expect(shop.validate()).resolves.toBeUndefined();

    expect(shop.currency).toBe('USD');
  });

  test('rejects invalid status', async () => {
    const shop = new Shop({ name: 'LNG Amazon US', status: 'DELETED' });

    await expect(shop.validate()).rejects.toThrow('`DELETED` is not a valid enum value');
  });
});
