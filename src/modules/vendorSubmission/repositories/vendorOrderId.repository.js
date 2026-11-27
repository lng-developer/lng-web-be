const VendorSubmission = require('../models/vendorSubmission.model');
const VendorOrderSequence = require('../models/vendorOrderSequence.model');

async function listHistory(orderId, provider, vendorId) {
  return VendorSubmission.find({
    orderId,
    provider,
    $or: [
      { 'payloadSnapshot.vendorProduct.vendor.id': String(vendorId) },
      { 'payloadSnapshot.vendorProduct.vendor._id': String(vendorId) },
    ],
  }).select('status submitAttemptCount submitOperationKey vendorExternalOrderId payloadSnapshot.vendorClientOrderId payloadSnapshot.mangoteeExternalOrderId payloadSnapshot.merchizeExternalOrderId payloadSnapshot.bundledSubmissionIds').lean();
}

async function nextSequence(scope, historicalFloor) {
  const _id = JSON.stringify(scope);
  try {
    await VendorOrderSequence.updateOne({ _id }, { $max: { sequence: historicalFloor } }, { upsert: true });
  } catch (error) {
    if (error.code !== 11000) throw error;
    await VendorOrderSequence.updateOne({ _id }, { $max: { sequence: historicalFloor } });
  }
  const counter = await VendorOrderSequence.findOneAndUpdate(
    { _id }, { $inc: { sequence: 1 } }, { returnDocument: 'after' },
  ).lean();
  return counter.sequence;
}

module.exports = { listHistory, nextSequence };
