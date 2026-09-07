const ProductionTask = require('../src/modules/production/models/productionTask.model');

async function seedProductionQueueFixture({ shopId, databaseName, targetCount = 200 } = {}) {
  if (databaseName !== 'lng_web_be_test') throw new Error('Refusing to seed non-test database');
  const operations = Array.from({ length: targetCount }, (_, index) => {
    const orderItemId = `fixture-production-${String(index + 1).padStart(3, '0')}`;
    return {
      updateOne: {
        filter: { orderItemId },
        update: { $set: { orderItemId, shopId, status: 'NEED_SCALE', blockers: [] } },
        upsert: true,
      },
    };
  });
  const result = await ProductionTask.bulkWrite(operations, { ordered: false });
  const storedCount = await ProductionTask.countDocuments({ shopId });
  return { targetCount, storedCount, upsertedCount: result.upsertedCount || 0 };
}

module.exports = { seedProductionQueueFixture };
