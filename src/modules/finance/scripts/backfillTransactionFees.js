const mongoose = require('mongoose');
const config = require('../../../config');
const { backfillTransactionFees } = require('../services/transactionFeeAllocation.service');

async function main(args = process.argv.slice(2)) {
  const { values } = require('node:util').parseArgs({ args, options: {
    apply: { type: 'boolean', default: false },
    'expect-database': { type: 'string' }, shop: { type: 'string' }, before: { type: 'string' },
  } });
  if (values.apply && !values['expect-database']) throw new Error('--expect-database is required with --apply');
  if (values.shop && !mongoose.isValidObjectId(values.shop)) throw new Error('Invalid shop ID');
  if (values.before && !mongoose.isValidObjectId(values.before)) throw new Error('Invalid cutoff ID');
  await mongoose.connect(config.database.uri, { autoIndex: false, autoCreate: false });
  try {
    const database = mongoose.connection.db.databaseName;
    if (values['expect-database'] && values['expect-database'] !== database) throw new Error('Database target mismatch');
    const beforeId = values.before ? new mongoose.Types.ObjectId(values.before) : new mongoose.Types.ObjectId();
    process.stdout.write(`${JSON.stringify({ database, dryRun: !values.apply, beforeId, shop: values.shop || 'ALL' })}\n`);
    const result = await backfillTransactionFees({ beforeId, shopId: values.shop, dryRun: !values.apply,
      onProgress: async progress => process.stdout.write(`${JSON.stringify(progress)}\n`),
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
    if (result.failed.length) process.exitCode = 1;
  } finally { await mongoose.disconnect(); }
}
if (require.main === module) main().catch(error => { process.stderr.write(`${error.name}: ${error.code || 'BACKFILL_FAILED'}\n`); process.exitCode = 1; });
module.exports = { main };
