jest.mock('../../../src/config', () => ({ env: 'development' }));
jest.mock('../../../src/modules/auth/repositories/extensionToken.repository');
jest.mock('../../../src/modules/shop/public', () => ({ assertShopIsActive: jest.fn() }));

const repository = require('../../../src/modules/auth/repositories/extensionToken.repository');
const service = require('../../../src/modules/auth/services/extensionToken.service');

describe('extensionToken service', () => {
  const shopId = '507f1f77bcf86cd799439011';

  beforeEach(() => {
    jest.clearAllMocks();
    repository.markUsed.mockResolvedValue({ acknowledged: true });
  });

  test('returns a raw token only at creation while persisting only a hash', async () => {
    repository.create.mockResolvedValue({
      _id: '507f1f77bcf86cd799439012', name: 'Dev PC', shopId, environment: 'development',
      tokenHint: 'abcd', createdAt: new Date('2026-08-11T00:00:00.000Z'),
    });

    const result = await service.create({
      name: 'Dev PC', shopId, environment: 'development', createdByAccountId: '507f1f77bcf86cd799439013',
    });

    expect(result.token).toMatch(/^lng_ext_[a-f0-9]{64}$/);
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({
      tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/), tokenHint: expect.any(String),
    }));
    expect(result.extensionToken).not.toHaveProperty('tokenHash');
  });

  test('returns a single shop-scoped ORDERS:WRITE context only in the matching environment', async () => {
    repository.findActiveByHash.mockResolvedValue({
      _id: '507f1f77bcf86cd799439012', shopId, environment: 'development', expiresAt: null,
    });

    const result = await service.authenticate('lng_ext_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    expect(result).toMatchObject({ tokenType: 'EXTENSION', permissions: [], scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['ORDERS:WRITE'] }] });
  });

  test('rejects expired extension tokens', async () => {
    repository.findActiveByHash.mockResolvedValue({
      _id: '507f1f77bcf86cd799439012',
      shopId,
      environment: 'development',
      expiresAt: new Date('2026-08-10T00:00:00.000Z'),
    });

    const result = await service.authenticate('lng_ext_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    expect(result).toBeNull();
    expect(repository.markUsed).not.toHaveBeenCalled();
  });

  test('rejects tokens from a different runtime environment', async () => {
    repository.findActiveByHash.mockResolvedValue({
      _id: '507f1f77bcf86cd799439012',
      shopId,
      environment: 'production',
      expiresAt: null,
    });

    const result = await service.authenticate('lng_ext_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');

    expect(result).toBeNull();
    expect(repository.markUsed).not.toHaveBeenCalled();
  });
});
