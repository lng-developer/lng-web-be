const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const { buildCaseInsensitivePrefixRegex, normalizeSearchTerm } = require('../../../shared/utils/search');
const { recordStatuses } = require('../constants/vendor.constants');
const VendorCostCenter = require('../models/vendorCostCenter.model');
const VendorProduct = require('../models/vendorProduct.model');
const Vendor = require('../models/vendor.model');

function buildFilter({
  vendorProductId,
  code,
  sku,
  standardSize,
  standardColor,
  status,
  q,
} = {}) {
  const filter = {};
  if (vendorProductId) filter.vendorProductId = vendorProductId;
  if (status) filter.status = status;

  const codeRegex = buildCaseInsensitivePrefixRegex(normalizeSearchTerm(code));
  if (codeRegex) filter.code = codeRegex;

  const skuRegex = buildCaseInsensitivePrefixRegex(normalizeSearchTerm(sku));
  if (skuRegex) filter.sku = skuRegex;

  const standardSizeRegex = buildCaseInsensitivePrefixRegex(normalizeSearchTerm(standardSize));
  if (standardSizeRegex) filter.standardSize = standardSizeRegex;

  const standardColorRegex = buildCaseInsensitivePrefixRegex(normalizeSearchTerm(standardColor));
  if (standardColorRegex) filter.standardColor = standardColorRegex;

  const qRegex = buildCaseInsensitivePrefixRegex(normalizeSearchTerm(q));
  if (qRegex) {
    filter.$or = [
      { code: qRegex },
      { name: qRegex },
      { sku: qRegex },
      { lngCode: qRegex },
      { standardSize: qRegex },
      { standardColor: qRegex },
      { vendorSize: qRegex },
      { vendorColor: qRegex },
    ];
  }

  return filter;
}

async function create(payload) {
  const costCenter = await VendorCostCenter.create(payload);
  return costCenter.toObject();
}

async function findById(costCenterId) {
  return VendorCostCenter.findById(costCenterId).lean();
}

async function findByProductAndCode({ vendorProductId, code } = {}) {
  return VendorCostCenter.findOne({ vendorProductId, code }).lean();
}

async function list({ page = 1, limit = 20, ...filters } = {}) {
  const filter = buildFilter(filters);
  const [items, total] = await Promise.all([
    VendorCostCenter.find(filter)
      .sort({ code: 1, _id: 1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    VendorCostCenter.countDocuments(filter),
  ]);

  return toPaginatedResult({ items, total, page, limit });
}

async function listActiveByProduct(vendorProductId) {
  return VendorCostCenter.find({
    vendorProductId,
    status: recordStatuses.ACTIVE,
  }).sort({ code: 1, _id: 1 }).lean();
}

async function listActiveByProducts(vendorProductIds = []) {
  if (!vendorProductIds.length) return [];
  return VendorCostCenter.find({
    vendorProductId: { $in: vendorProductIds },
    status: recordStatuses.ACTIVE,
  }).sort({ vendorProductId: 1, code: 1, _id: 1 }).lean();
}

async function listOptionsByProduct(vendorProductId) {
  return VendorCostCenter.find({
    vendorProductId,
    status: recordStatuses.ACTIVE,
  })
    .select('code sku standardSize standardColor baseCostAmount currency')
    .sort({ code: 1, _id: 1 })
    .lean();
}

function maybeObjectId(value) {
  if (!value) return null;
  return VendorCostCenter.db.base.Types.ObjectId.createFromHexString(String(value));
}

function pushRegex(orFilters, path, value) {
  const regex = buildCaseInsensitivePrefixRegex(normalizeSearchTerm(value));
  if (regex) orFilters.push({ [path]: regex });
}

function setRegex(filter, path, value) {
  const regex = buildCaseInsensitivePrefixRegex(normalizeSearchTerm(value));
  if (regex) filter[path] = regex;
}

async function search({
  page = 1,
  limit = 20,
  q,
  vendorId,
  vendorProductId,
  productTypeGroupId,
  sku,
  lngCode,
  size,
  color,
  status = recordStatuses.ACTIVE,
  includeDifferentProductType = false,
} = {}) {
  const match = {};
  if (status) match.status = status;
  if (vendorId) match.vendorId = maybeObjectId(vendorId);
  if (vendorProductId) match.vendorProductId = maybeObjectId(vendorProductId);
  setRegex(match, 'sku', sku);
  setRegex(match, 'lngCode', lngCode);

  const sizeOr = [];
  pushRegex(sizeOr, 'standardSize', size);
  pushRegex(sizeOr, 'vendorSize', size);
  if (sizeOr.length) match.$and = [...(match.$and || []), { $or: sizeOr }];

  const colorOr = [];
  pushRegex(colorOr, 'standardColor', color);
  pushRegex(colorOr, 'vendorColor', color);
  if (colorOr.length) match.$and = [...(match.$and || []), { $or: colorOr }];

  const qOr = [];
  ['code', 'name', 'sku', 'lngCode', 'standardSize', 'standardColor', 'vendorSize', 'vendorColor'].forEach((path) => {
    pushRegex(qOr, path, q);
  });

  const afterLookupMatch = {
    'vendorProduct.status': recordStatuses.ACTIVE,
    'vendor.status': recordStatuses.ACTIVE,
  };
  if (productTypeGroupId && !includeDifferentProductType) {
    afterLookupMatch['vendorProduct.productTypeGroupId'] = maybeObjectId(productTypeGroupId);
  }

  const qRegex = buildCaseInsensitivePrefixRegex(normalizeSearchTerm(q));
  if (qRegex) {
    afterLookupMatch.$or = [
      ...(qOr.length ? qOr : []),
      { 'vendorProduct.code': qRegex },
      { 'vendorProduct.name': qRegex },
      { 'vendorProduct.externalProductId': qRegex },
      { 'vendor.code': qRegex },
      { 'vendor.name': qRegex },
    ];
  }

  const pipeline = [
    { $match: match },
    {
      $lookup: {
        from: VendorProduct.collection.name,
        localField: 'vendorProductId',
        foreignField: '_id',
        as: 'vendorProduct',
      },
    },
    { $unwind: '$vendorProduct' },
    {
      $lookup: {
        from: Vendor.collection.name,
        localField: 'vendorId',
        foreignField: '_id',
        as: 'vendor',
      },
    },
    { $unwind: '$vendor' },
    { $match: afterLookupMatch },
    {
      $facet: {
        items: [
          { $sort: { code: 1, _id: 1 } },
          { $skip: getPaginationOffset({ page, limit }) },
          { $limit: limit },
          {
            $project: {
              vendor: {
                _id: '$vendor._id',
                code: '$vendor.code',
                name: '$vendor.name',
                providerKey: '$vendor.providerKey',
                fulfillmentType: '$vendor.fulfillmentType',
                status: '$vendor.status',
              },
              vendorProduct: {
                _id: '$vendorProduct._id',
                vendorId: '$vendorProduct.vendorId',
                productTypeGroupId: '$vendorProduct.productTypeGroupId',
                code: '$vendorProduct.code',
                name: '$vendorProduct.name',
                externalProductId: '$vendorProduct.externalProductId',
                imageUrl: '$vendorProduct.imageUrl',
                baseCostAmount: '$vendorProduct.baseCostAmount',
                currency: '$vendorProduct.currency',
                status: '$vendorProduct.status',
              },
              vendorCostCenter: '$$ROOT',
            },
          },
        ],
        total: [{ $count: 'count' }],
      },
    },
  ];

  const [result = {}] = await VendorCostCenter.aggregate(pipeline);
  return toPaginatedResult({
    items: result.items || [],
    total: result.total?.[0]?.count || 0,
    page,
    limit,
  });
}

async function countByProduct(vendorProductId) {
  return VendorCostCenter.countDocuments({ vendorProductId });
}

async function update(costCenterId, patch) {
  return VendorCostCenter.findByIdAndUpdate(
    costCenterId,
    { $set: patch, $inc: { __v: 1 } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

module.exports = {
  create,
  findById,
  findByProductAndCode,
  list,
  listActiveByProduct,
  listActiveByProducts,
  listOptionsByProduct,
  search,
  countByProduct,
  update,
  buildFilter,
};
