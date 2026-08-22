const extensionCommandTypes = Object.freeze({
  IMPORT_NEW_ORDERS: 'IMPORT_NEW_ORDERS',
});

const extensionCommandStatuses = Object.freeze({
  QUEUED: 'QUEUED',
  CLAIMED: 'CLAIMED',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
});

module.exports = { extensionCommandTypes, extensionCommandStatuses };
