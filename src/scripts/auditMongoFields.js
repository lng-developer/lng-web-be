const { connectDatabase, disconnectDatabase } = require('../config/database');
const { auditMongoFields } = require('./mongoFieldAudit');

const COLLECTIONS = [
  'vendorcostcenters',
  'hrattendancedailies',
  'externalorderrawrecords',
  'productiontasks',
  'vendorsubmissions',
];

async function main({
  connectDatabase: connect = connectDatabase,
  disconnectDatabase: disconnect = disconnectDatabase,
  audit = auditMongoFields,
  output = process.stdout,
} = {}) {
  try {
    const connection = await connect();
    const report = await audit(connection.db || connection, COLLECTIONS);
    output.write(`${JSON.stringify(report, null, 2)}\n`);
    return report;
  } finally {
    await disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { COLLECTIONS, main };
