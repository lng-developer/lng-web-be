const runStatuses = Object.freeze({ QUEUED: 'QUEUED', RUNNING: 'RUNNING', SUCCEEDED: 'SUCCEEDED', FAILED: 'FAILED' });
const activeRunStatuses = Object.freeze([runStatuses.QUEUED, runStatuses.RUNNING]);
const promptVersion = 2;

module.exports = { runStatuses, activeRunStatuses, promptVersion };
