const MediaAsset = require('../models/mediaAsset.model');

async function create(payload) {
  const document = await MediaAsset.create(payload);
  return document.toObject();
}

async function findById(assetId) {
  return MediaAsset.findById(assetId).lean();
}

async function findByIds(assetIds = []) {
  if (!assetIds.length) return [];
  return MediaAsset.find({ _id: { $in: assetIds } }).lean();
}

module.exports = {
  create,
  findById,
  findByIds,
};
