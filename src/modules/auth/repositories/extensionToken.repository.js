const ExtensionToken = require('../models/extensionToken.model');

function create(input) {
  return ExtensionToken.create(input);
}

function findActiveByHash(tokenHash) {
  return ExtensionToken.findOne({ tokenHash, revokedAt: null }).select('+tokenHash').lean();
}

function markUsed(id) {
  return ExtensionToken.updateOne({ _id: id, revokedAt: null }, { $set: { lastUsedAt: new Date() } });
}

function list({ shopId, environment }) {
  return ExtensionToken.find({ shopId, environment }).sort({ createdAt: -1 }).lean();
}

function findById(id) {
  return ExtensionToken.findById(id).lean();
}

function findByIds(ids) {
  return ExtensionToken.find({ _id: { $in: ids } }).lean();
}

function revoke(id) {
  return ExtensionToken.findOneAndUpdate(
    { _id: id, revokedAt: null },
    { $set: { revokedAt: new Date() } },
    { new: true },
  ).lean();
}

module.exports = { create, findActiveByHash, markUsed, list, findById, findByIds, revoke };
