const extensionCommandTypes = Object.freeze({
  IMPORT_NEW_ORDERS: 'IMPORT_NEW_ORDERS',
  IMPORT_ADS_SPEND: 'IMPORT_ADS_SPEND',
  IMPORT_TRANSACTIONS: 'IMPORT_TRANSACTIONS',
  IMPORT_SETTLEMENTS: 'IMPORT_SETTLEMENTS',
  TEST_CONNECTION: 'TEST_CONNECTION',
});

const financeScheduleSources = Object.freeze({
  TRANSACTIONS: 'TRANSACTIONS',
  SETTLEMENTS: 'SETTLEMENTS',
});

const extensionCommandStatuses = Object.freeze({
  QUEUED: 'QUEUED',
  CLAIMED: 'CLAIMED',
  RUNNING: 'RUNNING',
  SUCCEEDED: 'SUCCEEDED',
  FAILED: 'FAILED',
});

module.exports = { extensionCommandTypes, extensionCommandStatuses, financeScheduleSources };
