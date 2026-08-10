const { connectDatabase, disconnectDatabase } = require('../../../src/config/database');
const { collectMongoIndexAudit } = require('./mongoIndexAudit');

async function main({
  connectDatabase: connect = connectDatabase,
  disconnectDatabase: disconnect = disconnectDatabase,
  collectAudit = collectMongoIndexAudit,
  output = process.stdout,
} = {}) {
  try {
    const connection = await connect();
    const report = await collectAudit(
      connection.db || connection,
      ['orders', 'orderitems', 'financesnapshots'],
    );
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

module.exports = { main };
