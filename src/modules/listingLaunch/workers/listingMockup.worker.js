const { createLaunchWorker } = require('./createLaunchWorker');
const { queueName, closeQueue } = require('../queues/listingMockup.queue');
const { processAnalysis, recoverAnalyses } = require('../services/listingMockupProcessing.service');
const worker = createLaunchWorker({ queueName, closeQueue, processGeneration: processAnalysis, recoverGenerationRuns: recoverAnalyses, concurrency: 1 });
module.exports = { startMockupWorker: worker.start, stopMockupWorker: worker.stop };
