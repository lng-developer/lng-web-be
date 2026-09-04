jest.mock('../../../src/modules/production/models/productionTask.model', () => ({
  bulkWrite: jest.fn(),
  countDocuments: jest.fn(),
}));

const ProductionTask = require('../../../src/modules/production/models/productionTask.model');
const { seedProductionQueueFixture } = require('../../../scripts/seedProductionQueueFixture');

describe('seedProductionQueueFixture', () => {
  test('refuses every database except the dedicated test database', async () => {
    await expect(seedProductionQueueFixture({
      shopId: '6881aba9c1bbdfc541b5cd4d',
      databaseName: 'lng_web_be',
    })).rejects.toThrow('Refusing to seed non-test database');
  });

  test('upserts a deterministic snapshot-complete queue fixture', async () => {
    ProductionTask.bulkWrite.mockResolvedValue({ upsertedCount: 200, modifiedCount: 0 });
    ProductionTask.countDocuments.mockResolvedValue(200);

    const result = await seedProductionQueueFixture({
      shopId: '6881aba9c1bbdfc541b5cd4d',
      databaseName: 'lng_web_be_test',
    });

    expect(ProductionTask.bulkWrite).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({
        updateOne: expect.objectContaining({
          filter: expect.objectContaining({ orderItemId: expect.any(String) }),
          upsert: true,
        }),
      }),
    ]), { ordered: false });
    expect(ProductionTask.bulkWrite.mock.calls[0][0]).toHaveLength(200);
    expect(result).toEqual(expect.objectContaining({
      targetCount: 200,
      storedCount: 200,
      upsertedCount: 200,
    }));
  });
});
