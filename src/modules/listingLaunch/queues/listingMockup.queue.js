const { createLaunchQueue } = require('./createLaunchQueue');
const queue = createLaunchQueue('listing-launch-mockup', 'MOCKUP_ANALYSIS_UNAVAILABLE');
module.exports = { queueName: queue.queueName, assertQueueReady: queue.assertQueueReady, enqueueAnalysis: queue.enqueueGeneration, closeQueue: queue.closeQueue };
