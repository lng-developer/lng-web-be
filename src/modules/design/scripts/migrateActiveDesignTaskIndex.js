const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const DesignTask = require('../models/designTask.model');
const { activeDesignTaskStatuses } = require('../constants/design.constants');

const legacyKey = { listingId: 1, taskType: 1 };
const expectedKey = { listingId: 1, listingVariantId: 1, taskType: 1 };
const expectedPartial = { status: { $in: activeDesignTaskStatuses } };

const same = (left, right) => JSON.stringify(left || {}) === JSON.stringify(right || {});

function buildMigrationPlan(indexes = []) {
  const legacy = indexes.find((index) => index.unique === true && same(index.key, legacyKey));
  const current = indexes.find((index) => index.unique === true && same(index.key, expectedKey));
  const currentMatches = current && same(current.partialFilterExpression, expectedPartial);
  if (!legacy && currentMatches) return { status: 'UP_TO_DATE', dropIndexes: [] };
  return {
    status: 'NEEDS_MIGRATION',
    dropIndexes: [legacy?.name, currentMatches ? null : current?.name].filter(Boolean),
    createIndex: currentMatches
      ? null
      : { key: expectedKey, partialFilterExpression: expectedPartial },
  };
}

async function main() {
  const apply = process.argv.includes('--apply');
  await connectDatabase();
  try {
    const plan = buildMigrationPlan(await DesignTask.collection.indexes());
    console.log(JSON.stringify({ ...plan, mode: apply ? 'APPLY' : 'DRY_RUN' }));
    if (!apply || plan.status === 'UP_TO_DATE') return;
    for (const indexName of plan.dropIndexes) await DesignTask.collection.dropIndex(indexName);
    if (plan.createIndex) {
      await DesignTask.collection.createIndex(expectedKey, {
        unique: true,
        partialFilterExpression: expectedPartial,
      });
    }
    console.log(JSON.stringify({ status: 'APPLIED' }));
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { buildMigrationPlan };
