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

module.exports = {
  recordStatuses,
  vendorFulfillmentTypes,
  vendorProviderKeys,
};
