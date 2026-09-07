const ProductionTask = require('../../../src/modules/production/models/productionTask.model');

describe('ProductionTask indexes', () => {
  test('supports global status and QC queues sorted by newest update', () => {
    expect(ProductionTask.schema.indexes()).toEqual(expect.arrayContaining([
      [{ status: 1, updatedAt: -1 }, {}],
      [{ qcStatus: 1, updatedAt: -1 }, {}],
    ]));
  });
});
