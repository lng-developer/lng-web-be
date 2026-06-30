const MediaAsset = require('../models/mediaAsset.model');

async function create(payload) {
  const document = await MediaAsset.create(payload);
  return document.toObject();
}

async function findById(assetId) {
  return MediaAsset.findById(assetId).lean();
}

module.exports = {
  create,
  findById,
};
