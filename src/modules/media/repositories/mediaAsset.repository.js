const MediaAsset = require('../models/mediaAsset.model');
const {
  buildCaseInsensitivePrefixRegex,
  normalizeSearchTerm,
} = require('../../../shared/utils/search');

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

async function findIdsByOriginalFilename(search) {
  const regex = buildCaseInsensitivePrefixRegex(normalizeSearchTerm(search));
  if (!regex) return [];
  const rows = await MediaAsset.find({ originalFilename: regex }).select('_id').limit(5000).lean();
  return rows.map((row) => String(row._id));
}

module.exports = {
  create,
  findById,
  findByIds,
  findIdsByOriginalFilename,
};
