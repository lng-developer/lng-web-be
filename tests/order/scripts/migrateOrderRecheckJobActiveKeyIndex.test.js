jest.mock('../../../src/config/database', () => ({}));
jest.mock('../../../src/modules/order/models/orderRecheckJob.model', () => ({}));

const { buildMigrationPlan } = require('../../../src/modules/order/scripts/migrateOrderRecheckJobActiveKeyIndex');

test('replaces the legacy active key index with a partial unique index', () => {
  expect(buildMigrationPlan([{ name: 'activeKey_1', key: { activeKey: 1 }, unique: true }])).toEqual({
    status: 'NEEDS_MIGRATION', dropIndexes: ['activeKey_1'], createIndex: true,
  });
  expect(buildMigrationPlan([{
    name: 'activeKey_1', key: { activeKey: 1 }, unique: true,
    partialFilterExpression: { activeKey: { $type: 'string' } },
  }])).toEqual({ status: 'UP_TO_DATE', dropIndexes: [] });
});
