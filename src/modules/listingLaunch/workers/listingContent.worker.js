const { createLaunchWorker } = require('./createLaunchWorker');
const { queueName, closeQueue } = require('../queues/listingContent.queue');
const { processGeneration, recoverGenerationRuns } = require('../services/listingContentGeneration.service');
const worker = createLaunchWorker({ queueName, closeQueue, processGeneration, recoverGenerationRuns, concurrency: 2 });
module.exports = { startListingContentWorker: worker.start, stopListingContentWorker: worker.stop };
