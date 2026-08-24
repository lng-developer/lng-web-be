jest.mock('../../shop/public', () => ({ assertShopIsActive: jest.fn() }));
jest.mock('../repositories/extensionToken.repository', () => ({ create: jest.fn() }));
jest.mock('../../../shared/utils/crypto', () => ({ generateRandomToken: jest.fn(() => 'random'), hashString: jest.fn(() => 'hash') }));

const shopPort = require('../../shop/public');
const repository = require('../repositories/extensionToken.repository');
const service = require('../services/extensionToken.service');

test('creates extension tokens that expire in 30 days by default', async () => {
  repository.create.mockResolvedValue({ _id: 'token-1', name: 'RDC 01', shopId: 'shop-1', environment: 'production', tokenHint: 'abcd', createdAt: new Date() });

  await service.create({ name: 'RDC 01', shopId: 'shop-1', environment: 'production', createdByAccountId: 'account-1' });

  expect(shopPort.assertShopIsActive).toHaveBeenCalledWith('shop-1');
  expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ expiresAt: expect.any(Date) }));
  const { expiresAt } = repository.create.mock.calls[0][0];
  expect(expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
  expect(expiresAt.getTime()).toBeLessThan(Date.now() + 31 * 24 * 60 * 60 * 1000);
});
