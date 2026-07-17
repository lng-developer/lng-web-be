const recordStatuses = Object.freeze({
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
});

const vendorProviderKeys = Object.freeze({
  BEEFUL: 'BEEFUL',
  GRABINK: 'GRABINK',
  MERCHIZE: 'MERCHIZE',
  PRINTWAY: 'PRINTWAY',
  MANGOTEE: 'MANGOTEE',
  MERCHFOX: 'MERCHFOX',
  LENFUL: 'LENFUL',
  SS88: 'SS88',
  LUXURY_PRO: 'LUXURY_PRO',
  MANGO_P76: 'MANGO_P76',
  ZTB: 'ZTB',
  PGPRINT: 'PGPRINT',
  ONOSPOD: 'ONOSPOD',
  LNG_GROUP: 'LNG_GROUP',
  CUSTOM: 'CUSTOM',
});

const vendorFulfillmentTypes = Object.freeze({
  FBM: 'FBM',
  FBA: 'FBA',
  POD: 'POD',
  DROPSHIP: 'DROPSHIP',
  CUSTOM: 'CUSTOM',
});

const vendorIntegrationAuthTypes = Object.freeze({
  API_KEY: 'API_KEY',
  ACCESS_REFRESH: 'ACCESS_REFRESH',
  LOGIN_PASSWORD: 'LOGIN_PASSWORD',
});

const vendorIntegrationStatuses = Object.freeze({
  CONNECTED: 'CONNECTED',
  DISCONNECTED: 'DISCONNECTED',
});

module.exports = {
  recordStatuses,
  vendorFulfillmentTypes,
  vendorIntegrationAuthTypes,
  vendorIntegrationStatuses,
  vendorProviderKeys,
};
