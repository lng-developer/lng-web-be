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

async function markDiscardedIfMetadataMatches(assetId, expectedMetadata, reason) {
  return MediaAsset.findOneAndUpdate(
    {
      _id: assetId,
      discardedAt: null,
      'metadata.source': expectedMetadata.source,
      'metadata.taskId': expectedMetadata.taskId,
      'metadata.fileCheckId': expectedMetadata.fileCheckId,
      'metadata.uploadedBy': expectedMetadata.uploadedBy,
    },
    { $set: { discardedAt: new Date(), discardReason: reason } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

module.exports = {
  create,
  findById,
  findByIds,
  findIdsByOriginalFilename,
  markDiscardedIfMetadataMatches,
};
