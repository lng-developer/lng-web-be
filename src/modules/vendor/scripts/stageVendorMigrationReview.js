const path = require('path');
const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const vendorService = require('../services/vendor.service');
const { buildVendorMigrationReviewRows, parseArgs, readTemplateDir } = require('./importVendorTemplate');

async function stageVendorMigrationReviewDir({ dir } = {}) {
  const rows = buildVendorMigrationReviewRows(readTemplateDir(dir));
  await vendorService.stageVendorMigrationReviews(rows);
  return { staged: rows.length };
}

async function main() {
  const args = parseArgs();
  await connectDatabase();
  try {
    process.stdout.write(`${JSON.stringify(await stageVendorMigrationReviewDir({ dir: path.resolve(args.dir) }))}\n`);
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});

module.exports = { stageVendorMigrationReviewDir };
