jest.mock('../../src/shared/observability/mongoIndexUsage', () => ({
  collectMongoIndexAudit: jest.fn(),
}));

jest.mock('../../src/modules/audit/repositories/mongoIndexUsageSnapshot.repository', () => ({
  upsertDaily: jest.fn(),
}));

const { collectMongoIndexAudit } = require('../../src/shared/observability/mongoIndexUsage');
const repository = require('../../src/modules/audit/repositories/mongoIndexUsageSnapshot.repository');
const service = require('../../src/modules/audit/services/mongoIndexUsageSnapshot.service');

describe('mongoIndexUsageSnapshot.service', () => {
  test('stores a daily snapshot without scanning its own collection', async () => {
    const db = {
      listCollections: () => ({ toArray: async () => [
        { name: 'orders' },
        { name: 'mongoIndexUsageSnapshots' },
      ] }),
    };
    collectMongoIndexAudit.mockResolvedValue({
      database: 'lng_web_be', totals: {}, collections: [{ name: 'orders' }],
    });
    repository.upsertDaily.mockImplementation(async (snapshot) => snapshot);

    const result = await service.collectAndStore({ db });

    expect(collectMongoIndexAudit).toHaveBeenCalledWith(db, ['orders']);
    expect(repository.upsertDaily).toHaveBeenCalledWith(expect.objectContaining({
      database: 'lng_web_be',
      capturedOn: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      capturedAt: expect.any(Date),
    }));
    expect(result).toEqual(expect.objectContaining({ collections: 1 }));
  });
});
