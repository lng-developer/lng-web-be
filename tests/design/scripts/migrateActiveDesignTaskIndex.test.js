const { buildMigrationPlan } = require('../../../src/modules/design/scripts/migrateActiveDesignTaskIndex');

test('replaces the legacy listing-scoped active task index with the variant-aware index', () => {
  expect(buildMigrationPlan([{
    name: 'listingId_1_taskType_1',
    key: { listingId: 1, taskType: 1 },
    unique: true,
    partialFilterExpression: { status: { $in: ['REQUESTED'] } },
  }])).toMatchObject({
    status: 'NEEDS_MIGRATION',
    dropIndexes: ['listingId_1_taskType_1'],
    createIndex: {
      key: { listingId: 1, listingVariantId: 1, taskType: 1 },
    },
  });
});

test('only drops the legacy index when the variant-aware index already exists', () => {
  const partial = { status: { $in: ['REQUESTED', 'OPEN', 'ASSIGNED', 'IN_PROGRESS', 'SUBMITTED', 'REJECTED'] } };
  expect(buildMigrationPlan([{
    name: 'listingId_1_taskType_1',
    key: { listingId: 1, taskType: 1 },
    unique: true,
  }, {
    name: 'listingId_1_listingVariantId_1_taskType_1',
    key: { listingId: 1, listingVariantId: 1, taskType: 1 },
    unique: true,
    partialFilterExpression: partial,
  }])).toMatchObject({
    status: 'NEEDS_MIGRATION',
    dropIndexes: ['listingId_1_taskType_1'],
    createIndex: null,
  });
});
