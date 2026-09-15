const { connectDatabase, disconnectDatabase } = require('../../../config/database');
const { startListingContentWorker, stopListingContentWorker } = require('./listingContent.worker');
const logger = require('../../../shared/utils/logger');

let stopping;
function shutdown() {
  if (!stopping) stopping = (async () => {
    try { await stopListingContentWorker(); }
    finally { await disconnectDatabase(); }
  })();
  return stopping;
}

async function start() {
  await connectDatabase();
  if (stopping) return disconnectDatabase();
  startListingContentWorker();
}

if (require.main === module) {
  const stop = () => shutdown().catch(() => { logger.error('listing_content_shutdown_failed'); process.exitCode = 1; });
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  start().catch(async () => {
    logger.error('listing_content_start_failed');
    process.exitCode = 1;
    await stop();
  });
}

module.exports = { start, shutdown };
