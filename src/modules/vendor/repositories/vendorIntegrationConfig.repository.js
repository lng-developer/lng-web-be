const VendorIntegrationConfig = require('../models/vendorIntegrationConfig.model');

async function findByVendorId(vendorId) {
  return VendorIntegrationConfig.findOne({ vendorId })
    .sort({ updatedAt: -1, _id: -1 })
    .lean();
}

async function findByProviderKey(providerKey) {
  return VendorIntegrationConfig.findOne({ providerKey })
    .sort({ updatedAt: -1, _id: -1 })
    .lean();
}

async function upsertByVendorAndProvider(payload) {
  return VendorIntegrationConfig.findOneAndUpdate(
    { vendorId: payload.vendorId },
    { $set: payload, $inc: { __v: 1 } },
    {
      new: true,
      runValidators: true,
      setDefaultsOnInsert: true,
      upsert: true,
    },
  ).lean();
}

async function update(configId, patch) {
  return VendorIntegrationConfig.findByIdAndUpdate(
    configId,
    { $set: patch, $inc: { __v: 1 } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function deleteByVendorId(vendorId) {
  return VendorIntegrationConfig.findOneAndDelete({ vendorId }).lean();
}

module.exports = {
  findByProviderKey,
  findByVendorId,
  deleteByVendorId,
  update,
  upsertByVendorAndProvider,
};
