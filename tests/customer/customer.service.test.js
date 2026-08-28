jest.mock('../../src/modules/customer/repositories/customer.repository', () => ({ summarize: jest.fn() }));

const repository = require('../../src/modules/customer/repositories/customer.repository');
const service = require('../../src/modules/customer/services/customer.service');

test('scopes customer summary to authorized shops', async () => {
  repository.summarize.mockResolvedValue({ total: 1 });

  await service.getSummary({}, {
    permissions: [],
    scopes: [{ scopeType: 'shop', scopeId: 'shop-1', permissions: ['CUSTOMERS:READ'] }],
  });

  expect(repository.summarize).toHaveBeenCalledWith({ shopIds: ['shop-1'] });
});
