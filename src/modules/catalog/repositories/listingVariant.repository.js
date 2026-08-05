const ListingVariant = require('../models/listingVariant.model');

const populate = (query) => query
  .populate('productTypeGroupId', 'code name status')
  .populate('internalTemplateId', 'code name status productTypeGroupId');

async function create(payload) {
  const row = await ListingVariant.create(payload);
  return populate(ListingVariant.findById(row._id)).lean();
}
const findById = (id) => populate(ListingVariant.findById(id)).lean();
const listByListing = (listingId) => populate(ListingVariant.find({ listingId }).sort({ createdAt: 1, _id: 1 })).lean();
const findByListingAndProductType = (listingId, productTypeGroupId) => populate(ListingVariant.findOne({ listingId, productTypeGroupId, status: 'ACTIVE' })).lean();
const countByListing = (listingId) => ListingVariant.countDocuments({ listingId });
const update = (id, patch) => populate(ListingVariant.findByIdAndUpdate(id, { $set: patch }, { returnDocument: 'after', runValidators: true })).lean();

module.exports = { create, findById, listByListing, findByListingAndProductType, countByListing, update };
