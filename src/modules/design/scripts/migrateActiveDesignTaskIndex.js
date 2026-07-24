const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const DesignTask = require('../models/designTask.model');
const { activeDesignTaskStatuses } = require('../constants/design.constants');

const expectedKey = { listingId: 1, taskType: 1 };
const expectedPartial = { status: { $in: activeDesignTaskStatuses } };

function isTargetIndex(index = {}) {
  return index.unique === true
    && JSON.stringify(index.key) === JSON.stringify(expectedKey);
}

async function main() {
  const apply = process.argv.includes('--apply');
  await connectDatabase();
  try {
    const indexes = await DesignTask.collection.indexes();
    const current = indexes.find(isTargetIndex);
    const matches = current
      && JSON.stringify(current.partialFilterExpression || {}) === JSON.stringify(expectedPartial);

    if (matches) {
      console.log(JSON.stringify({ status: 'UP_TO_DATE', index: current.name }));
      return;
    }

    const action = {
      status: apply ? 'APPLYING' : 'DRY_RUN',
      dropIndex: current?.name || null,
      createIndex: { key: expectedKey, partialFilterExpression: expectedPartial },
    };
    console.log(JSON.stringify(action));
    if (!apply) return;

    if (current?.name) await DesignTask.collection.dropIndex(current.name);
    await DesignTask.collection.createIndex(expectedKey, {
      unique: true,
      partialFilterExpression: expectedPartial,
    });
    console.log(JSON.stringify({ status: 'APPLIED' }));
  } finally {
    await disconnectDatabase();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
