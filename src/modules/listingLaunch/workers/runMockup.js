const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const { startMockupWorker, stopMockupWorker } = require('./listingMockup.worker');
const logger = require('../../../shared/utils/logger');

let stopping;
function shutdown() {
  if (!stopping) stopping = (async () => {
    try { await stopMockupWorker(); }
    finally { await disconnectDatabase(); }
  })();
  return stopping;
}

async function start() {
  await connectDatabase();
  if (stopping) return disconnectDatabase();
  startMockupWorker();
}

if (require.main === module) {
  const stop = () => shutdown().catch(() => { logger.error('listing_mockup_shutdown_failed'); process.exitCode = 1; });
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  start().catch(async () => {
    logger.error('listing_mockup_start_failed');
    process.exitCode = 1;
    await stop();
  });
}

module.exports = { start, shutdown };
