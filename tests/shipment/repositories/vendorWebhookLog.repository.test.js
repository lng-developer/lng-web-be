const repository = require('../../../src/modules/shipment/repositories/vendorWebhookLog.repository');

describe('vendorWebhookLog.repository', () => {
  test('buildFilter includes the full dateTo day', () => {
    expect(repository.buildFilter({ dateTo: '2026-08-01' })).toMatchObject({
      createdAt: { $lte: new Date('2026-08-01T23:59:59.999Z') },
    });
  });
});
