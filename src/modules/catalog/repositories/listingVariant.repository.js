const ListingVariant = require('../models/listingVariant.model');
const mongoose = require('mongoose');

const populate = (query) => query
  .populate('productTypeGroupId', 'code name printMethod status')
  .populate('internalTemplateId', 'code name status productTypeGroupId');

async function create(payload) {
  const row = await ListingVariant.create(payload);
  return populate(ListingVariant.findById(row._id)).lean();
}
const findById = (id) => populate(ListingVariant.findById(id)).lean();
const findByIds = (ids = []) => populate(ListingVariant.find({ _id: { $in: ids } })).lean();
const listByListing = (listingId) => populate(ListingVariant.find({ listingId }).sort({ createdAt: 1, _id: 1 })).lean();
const listIdsByScaleDifficulty = (level) => ListingVariant.find({ 'scaleDifficulty.level': level }).distinct('_id');
const listScaleDifficultiesByIds = (ids = []) => ListingVariant.find({ _id: { $in: ids } })
  .select('_id scaleDifficulty')
  .lean();
const findByListingAndProductType = (listingId, productTypeGroupId) => populate(ListingVariant.findOne({ listingId, productTypeGroupId, status: 'ACTIVE' })).lean();
const countByListing = (listingId) => ListingVariant.countDocuments({ listingId });
const summarizeByListings = async (listingIds = []) => {
  const ids = listingIds
    .filter((id) => mongoose.Types.ObjectId.isValid(id))
    .map((id) => new mongoose.Types.ObjectId(id));
  if (!ids.length) return new Map();
  const rows = await ListingVariant.aggregate([
    { $match: { listingId: { $in: ids } } },
    {
      $group: {
        _id: '$listingId',
        count: { $sum: 1 },
        ready: { $sum: { $cond: [{ $ifNull: ['$psdTemplateAssetId', false] }, 1, 0] } },
      },
    },
  ]);
  return new Map(rows.map((row) => [String(row._id), { count: row.count, ready: row.ready }]));
};
const update = (id, patch) => populate(ListingVariant.findByIdAndUpdate(id, { $set: patch }, { returnDocument: 'after', runValidators: true })).lean();
const updateManyByIds = (ids = [], patch = {}) => ListingVariant.updateMany({ _id: { $in: ids } }, { $set: patch }, { runValidators: true });

module.exports = {
  findAssetReference: (assetId, listingIds) => ListingVariant.findOne({ listingId: { $in: listingIds },
    $or: [{ psdTemplateAssetId: assetId }, { previewAssetId: assetId }],
  }).select('_id').lean(),
  create,
  findById,
  findByIds,
  listByListing,
  listIdsByScaleDifficulty,
  listScaleDifficultiesByIds,
  findByListingAndProductType,
  countByListing,
  summarizeByListings,
  update,
  updateManyByIds,
};
