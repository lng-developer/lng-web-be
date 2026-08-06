const MediaAsset = require('../models/mediaAsset.model');
const {
  buildCaseInsensitivePrefixRegex,
  normalizeSearchTerm,
} = require('../../../shared/utils/search');
const { normalizePagination, getPaginationOffset } = require('../../../shared/utils/pagination');

async function create(payload) {
  const document = await MediaAsset.create(payload);
  return document.toObject();
}

async function findById(assetId) {
  return MediaAsset.findById(assetId).lean();
}

async function updateById(assetId, patch) {
  return MediaAsset.findByIdAndUpdate(assetId, { $set: patch }, {
    returnDocument: 'after', runValidators: true,
  }).lean();
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

async function list(input = {}) {
  const { page, limit } = normalizePagination(input);
  const query = {};
  const filename = buildCaseInsensitivePrefixRegex(normalizeSearchTerm(input.q));
  if (filename) query.originalFilename = filename;

  const mimeGroups = {
    IMAGE: /^image\//,
    DOCUMENT: /^(application\/(pdf|msword|vnd\.|rtf)|text\/)/,
    ARCHIVE: /^(application\/(zip|x-7z-compressed|x-rar-compressed|gzip))$/,
  };
  if (input.mimeGroup === 'OTHER') {
    query.mimeType = { $not: /^(image\/|text\/|application\/(pdf|msword|vnd\.|rtf|zip|x-7z-compressed|x-rar-compressed|gzip))/ };
  } else if (mimeGroups[input.mimeGroup]) {
    query.mimeType = mimeGroups[input.mimeGroup];
  }
  if (input.provider) query.provider = input.provider;
  if (input.resourceType) query.resourceType = input.resourceType;
  if (input.ownerType) query.ownerType = input.ownerType;
  if (input.status === 'ACTIVE') query.discardedAt = null;
  if (input.status === 'DISCARDED') query.discardedAt = { $ne: null };
  if (input.dateFrom || input.dateTo) {
    query.createdAt = {};
    if (input.dateFrom) query.createdAt.$gte = new Date(input.dateFrom);
    if (input.dateTo) query.createdAt.$lte = new Date(input.dateTo);
  }

  const [items, total] = await Promise.all([
    MediaAsset.find(query).sort({ createdAt: -1 }).skip(getPaginationOffset({ page, limit })).limit(limit).lean(),
    MediaAsset.countDocuments(query),
  ]);
  return { items, pagination: { total, page, limit } };
}

async function markDiscardedIfMetadataMatches(assetId, expectedMetadata, reason) {
  const metadataMatch = Object.fromEntries(
    Object.entries(expectedMetadata || {})
      .filter(([key, value]) => /^[A-Za-z][A-Za-z0-9_]*$/.test(key) && value !== undefined)
      .map(([key, value]) => [`metadata.${key}`, value]),
  );
  if (!Object.keys(metadataMatch).length) return null;

  return MediaAsset.findOneAndUpdate(
    {
      _id: assetId,
      discardedAt: null,
      ...metadataMatch,
    },
    { $set: { discardedAt: new Date(), discardReason: reason } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

module.exports = {
  create,
  findById,
  updateById,
  findByIds,
  findIdsByOriginalFilename,
  list,
  markDiscardedIfMetadataMatches,
};
