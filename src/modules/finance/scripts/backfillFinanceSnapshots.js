const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const { reconcileSnapshots } = require('../services/financeSnapshotReconciliation.service');

async function main() {
  await connectDatabase();
  try {
    const result = await reconcileSnapshots({ limit: 1000, dryRun: !process.argv.includes('--apply') });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } finally { await disconnectDatabase(); }
}

if (require.main === module) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });

module.exports = { main };
