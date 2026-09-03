const mongoose = require('mongoose');
const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const {
  buildCaseInsensitiveContainsRegex,
  buildCaseInsensitivePrefixRegex,
  normalizeSearchTerm,
} = require('../../../shared/utils/search');
const { recordStatuses } = require('../constants/vendor.constants');
const Vendor = require('../models/vendor.model');
const VendorCostCenter = require('../models/vendorCostCenter.model');
const VendorProduct = require('../models/vendorProduct.model');

function searchTokens(value) {
  return normalizeSearchTerm(value, { maxLength: 160 })
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)
    .slice(0, 5);
}

async function findVendorIdsByToken(token) {
  const regex = buildCaseInsensitiveContainsRegex(token);
  if (!regex) return [];

  const vendors = await Vendor.find({
    $or: [{ code: regex }, { name: regex }],
  }).select('_id').lean();

  return vendors.map((vendor) => vendor._id);
}

function buildFilter({
  vendorId,
  productTypeGroupId,
  code,
  externalProductId,
  status,
} = {}) {
  const filter = {};
  if (vendorId) filter.vendorId = vendorId;
  if (productTypeGroupId) filter.productTypeGroupId = productTypeGroupId;
  if (externalProductId) filter.externalProductId = externalProductId;
  if (status) filter.status = status;

  const codeRegex = buildCaseInsensitivePrefixRegex(normalizeSearchTerm(code));
  if (codeRegex) filter.code = codeRegex;

  return filter;
}

async function buildListFilter(filters = {}) {
  const filter = buildFilter(filters);
  const tokens = searchTokens(filters.q);
  if (!tokens.length) return filter;

  const tokenFilters = await Promise.all(tokens.map(async (token) => {
    const regex = buildCaseInsensitiveContainsRegex(token);
    const vendorIds = await findVendorIdsByToken(token);
    const clauses = [{ code: regex }, { name: regex }, { externalProductId: regex }];

    if (vendorIds.length) clauses.push({ vendorId: { $in: vendorIds } });

    return { $or: clauses };
  }));

  filter.$and = tokenFilters;
  return filter;
}

function withVendor(query) {
  return query.populate({
    path: 'vendorId',
    select: 'code name providerKey status',
  });
}

async function create(payload) {
  const product = await VendorProduct.create(payload);
  return withVendor(VendorProduct.findById(product._id)).lean();
}

async function createMany(payloads = []) {
  if (!payloads.length) return [];
  const products = await VendorProduct.insertMany(payloads, { ordered: true });
  return products.map((product) => product.toObject());
}

async function countAll() {
  return VendorProduct.countDocuments();
}

async function findById(productId) {
  return withVendor(VendorProduct.findById(productId)).lean();
}

async function findByCode({ vendorId, code, includeInactive = false } = {}) {
  const filter = { vendorId, code };
  if (!includeInactive) filter.status = recordStatuses.ACTIVE;
  return withVendor(VendorProduct.findOne(filter)).lean();
}

async function findByLegacyId(legacyId) {
  return withVendor(VendorProduct.findOne({ 'metadata.legacyId': String(legacyId) })).lean();
}

async function assignProductTypeGroupByLegacyIds(legacyProductIds, productTypeGroupId) {
  const result = await VendorProduct.updateMany(
    { 'metadata.legacyId': { $in: legacyProductIds.map(String) } },
    { $set: { productTypeGroupId } },
    { runValidators: true },
  );
  return result.modifiedCount;
}

async function assignProductTypeGroupByIds(productIds, productTypeGroupId) {
  const result = await VendorProduct.updateMany(
    { _id: { $in: productIds } },
    { $set: { productTypeGroupId } },
    { runValidators: true },
  );
  return result.modifiedCount;
}

async function listUnassignedForMigration({ page = 1, limit = 100, q, vendorId } = {}) {
  // Aggregate pipelines do not apply Mongoose schema casting. Convert the query-string
  // vendorId before matching it against the ObjectId persisted on VendorProduct.
  const match = {
    productTypeGroupId: null,
    ...(vendorId ? { vendorId: new mongoose.Types.ObjectId(vendorId) } : {}),
  };
  const text = normalizeSearchTerm(q);
  const regex = buildCaseInsensitiveContainsRegex(text);
  const afterVendorLookup = regex ? {
    $or: [
      { code: regex },
      { name: regex },
      { externalProductId: regex },
      { 'vendor.code': regex },
      { 'vendor.name': regex },
    ],
  } : {};
  const [result = {}] = await VendorProduct.aggregate([
    { $match: match },
    {
      $lookup: {
        from: Vendor.collection.name,
        localField: 'vendorId',
        foreignField: '_id',
        as: 'vendor',
      },
    },
    { $unwind: '$vendor' },
    ...(Object.keys(afterVendorLookup).length ? [{ $match: afterVendorLookup }] : []),
    {
      $lookup: {
        from: VendorCostCenter.collection.name,
        let: { productId: '$_id' },
        pipeline: [{ $match: { $expr: { $eq: ['$vendorProductId', '$$productId'] } } }, { $count: 'count' }],
        as: 'variants',
      },
    },
    { $set: { variantCount: { $ifNull: [{ $first: '$variants.count' }, 0] } } },
    {
      $facet: {
        items: [
          { $sort: { 'vendor.code': 1, code: 1, _id: 1 } },
          { $skip: getPaginationOffset({ page, limit }) },
          { $limit: limit },
          {
            $project: {
              _id: 1,
              vendorCode: '$vendor.code',
              vendorName: '$vendor.name',
              code: 1,
              name: 1,
              externalProductId: 1,
              imageUrl: 1,
              variantCount: 1,
            },
          },
        ],
        total: [{ $count: 'count' }],
      },
    },
  ]);
  return toPaginatedResult({
    items: result.items || [],
    total: result.total?.[0]?.count || 0,
    page,
    limit,
  });
}

async function list({ page = 1, limit = 20, ...filters } = {}) {
  const filter = await buildListFilter(filters);
  const [items, total] = await Promise.all([
    withVendor(VendorProduct.find(filter))
      .sort({ code: 1, _id: 1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    VendorProduct.countDocuments(filter),
  ]);

  return toPaginatedResult({ items, total, page, limit });
}

function cursorAllForExport() {
  return withVendor(VendorProduct.find({}).sort({ _id: 1 })).lean().cursor();
}

async function listActiveByProductTypeGroup(productTypeGroupId) {
  return withVendor(VendorProduct.find({
    productTypeGroupId,
    status: recordStatuses.ACTIVE,
  }).sort({ code: 1, _id: 1 })).lean();
}

async function listActiveByVendor(vendorId, { productTypeGroupId } = {}) {
  return VendorProduct.find({
    vendorId,
    status: recordStatuses.ACTIVE,
    ...(productTypeGroupId ? { productTypeGroupId } : {}),
  })
    .select('code name productTypeGroupId')
    .sort({ code: 1, _id: 1 })
    .lean();
}

async function listActiveByIds(productIds = []) {
  if (!productIds.length) return [];
  return withVendor(VendorProduct.find({
    _id: { $in: productIds },
    status: recordStatuses.ACTIVE,
  })).lean();
}

async function update(productId, patch) {
  return withVendor(VendorProduct.findByIdAndUpdate(
    productId,
    { $set: patch, $inc: { __v: 1 } },
    { returnDocument: 'after', runValidators: true },
  )).lean();
}

module.exports = {
  create,
  createMany,
  countAll,
  findById,
  findByCode,
  findByLegacyId,
  assignProductTypeGroupByLegacyIds,
  assignProductTypeGroupByIds,
  listUnassignedForMigration,
  list,
  cursorAllForExport,
  listActiveByProductTypeGroup,
  listActiveByVendor,
  listActiveByIds,
  update,
  buildFilter,
  buildListFilter,
};
