const config = require('../../../src/config');
const { connectDatabase, disconnectDatabase } = require('../../../src/config/database');
const logger = require('../../../src/shared/utils/logger');

const DEMO_DATABASE_NAME = 'lng_web_be_demo';
const DEMO_SOURCE_REF = 'demo-finance-report-seed';

function databaseNameFromUri(uri) {
  try {
    const pathname = new URL(String(uri || '')).pathname;
    const name = decodeURIComponent(pathname || '').replace(/^\/+|\/+$/g, '');
    return name || null;
  } catch (_error) {
    return null;
  }
}

function assertDemoSeedAllowed(env = process.env, uri = config.database.uri) {
  if (env.NODE_ENV === 'production') {
    throw new Error('Demo finance report seed is disabled in production');
  }
  if (env.ALLOW_ANALYTICS_DEMO_SEED !== 'true') {
    throw new Error('Set ALLOW_ANALYTICS_DEMO_SEED=true to run the demo finance report seed');
  }
  if (databaseNameFromUri(uri) !== DEMO_DATABASE_NAME) {
    throw new Error(`Demo finance report seed requires database ${DEMO_DATABASE_NAME}`);
  }
}

function parseCliArguments(argv = []) {
  const flags = new Set(argv);
  const unsupported = [...flags].filter((flag) => !['--apply', '--reset'].includes(flag));
  if (unsupported.length) throw new Error(`Unsupported argument: ${unsupported[0]}`);
  return {
    apply: flags.has('--apply'),
    reset: flags.has('--reset'),
  };
}

async function seedDemoFinanceReportData({
  apply = false,
  reset = false,
  env = process.env,
  dependencies = {},
} = {}) {
  const databaseUri = dependencies.databaseUri || config.database.uri;
  const connect = dependencies.connectDatabase || connectDatabase;
  const disconnect = dependencies.disconnectDatabase || disconnectDatabase;
  assertDemoSeedAllowed(env, databaseUri);

  if (!apply) {
    return {
      apply: false,
      databaseName: databaseNameFromUri(databaseUri),
      reset,
      sourceRef: DEMO_SOURCE_REF,
    };
  }

  await connect();
  try {
    throw new Error('Demo finance report persistence is not implemented yet');
  } finally {
    await disconnect();
  }
}

if (require.main === module) {
  const options = parseCliArguments(process.argv.slice(2));
  seedDemoFinanceReportData(options)
    .then((result) => logger.info('demo_finance_report_seed_completed', result))
    .catch((error) => {
      logger.error('demo_finance_report_seed_failed', { error });
      process.exitCode = 1;
    });
}

module.exports = {
  DEMO_DATABASE_NAME,
  DEMO_SOURCE_REF,
  assertDemoSeedAllowed,
  databaseNameFromUri,
  parseCliArguments,
  seedDemoFinanceReportData,
};
