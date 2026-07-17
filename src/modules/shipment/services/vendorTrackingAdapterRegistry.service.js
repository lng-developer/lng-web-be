const { normalizeProviderKey } = require('./vendorTrackingNormalizer.service');
const genericAdapter = require('./vendorTrackingAdapters/generic.adapter');
const lenfulAdapter = require('./vendorTrackingAdapters/lenful.adapter');
const merchizeAdapter = require('./vendorTrackingAdapters/merchize.adapter');
const printwayAdapter = require('./vendorTrackingAdapters/printway.adapter');

function getTrackingAdapter(provider) {
  const providerKey = normalizeProviderKey(provider);
  if (providerKey === 'LENFUL') return lenfulAdapter;
  if (providerKey === 'MERCHIZE') return merchizeAdapter;
  if (providerKey === 'PRINTWAY') return printwayAdapter;
  return genericAdapter;
}

async function fetchTrackingByExternalOrderId(provider, externalOrderId, options = {}) {
  const adapter = getTrackingAdapter(provider);
  if (!adapter || typeof adapter.fetchTrackingByExternalOrderId !== 'function') {
    const error = new Error('Unsupported vendor tracking provider');
    error.unsupportedProvider = true;
    throw error;
  }
  return adapter.fetchTrackingByExternalOrderId(externalOrderId, options);
}

module.exports = {
  fetchTrackingByExternalOrderId,
  getTrackingAdapter,
  normalizeLenfulTracking: lenfulAdapter.normalizeLenfulTracking,
  normalizePrintwayTracking: printwayAdapter.normalizePrintwayTracking,
};
