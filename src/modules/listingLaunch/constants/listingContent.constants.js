const runStatuses = Object.freeze({ QUEUED: 'QUEUED', RUNNING: 'RUNNING', SUCCEEDED: 'SUCCEEDED', FAILED: 'FAILED' });
const activeRunStatuses = Object.freeze([runStatuses.QUEUED, runStatuses.RUNNING]);
const promptVersion = 1;

module.exports = { runStatuses, activeRunStatuses, promptVersion };
