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

async function createMany(payloads = []) {
  if (!payloads.length) return [];
  const costCenters = await VendorCostCenter.insertMany(payloads, { ordered: true });
  return costCenters.map((costCenter) => costCenter.toObject());
}

async function countAll() {
  return VendorCostCenter.countDocuments();
}

async function findById(costCenterId) {
  return VendorCostCenter.findById(costCenterId).lean();
}

async function findByProductAndCode({ vendorProductId, code } = {}) {
  return VendorCostCenter.findOne({ vendorProductId, code }).lean();
}

async function findByLegacyId(legacyId) {
  return VendorCostCenter.findOne({ 'metadata.legacyId': String(legacyId) }).lean();
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

function cursorAllForExport() {
  return VendorCostCenter.find({}).sort({ vendorProductId: 1, _id: 1 }).lean().cursor();
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

async function listActiveMatchProbesByProducts(vendorProductIds = []) {
  if (!vendorProductIds.length) return [];
  return VendorCostCenter.find({
    vendorProductId: { $in: vendorProductIds },
    status: recordStatuses.ACTIVE,
  })
    .select('_id vendorProductId vendorId sku lngCode vendorSize vendorColor standardSize standardColor printMethod attributes')
    .lean();
}

async function listActiveByIds(costCenterIds = []) {
  if (!costCenterIds.length) return [];
  return VendorCostCenter.find({
    _id: { $in: costCenterIds },
    status: recordStatuses.ACTIVE,
  }).lean();
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

function buildSearchMatch({
  vendorProductId,
  sku,
  lngCode,
  size,
  color,
  status,
} = {}) {
  const match = {};
  if (status) match.status = status;
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
  return match;
}

async function searchScopedProducts({ vendorId, vendorProductId, productTypeGroupId, includeDifferentProductType, ...query }) {
  const productFilter = { status: recordStatuses.ACTIVE };
  if (vendorId) productFilter.vendorId = maybeObjectId(vendorId);
  if (vendorProductId) productFilter._id = maybeObjectId(vendorProductId);
  if (productTypeGroupId && !includeDifferentProductType) productFilter.productTypeGroupId = maybeObjectId(productTypeGroupId);

  const products = await VendorProduct.find(productFilter)
    .select('_id vendorId productTypeGroupId code name externalProductId imageUrl baseCostAmount currency status')
    .lean();
  const vendorIds = [...new Set(products.map((product) => String(product.vendorId)))];
  if (!vendorIds.length) return toPaginatedResult({ items: [], total: 0, page: query.page, limit: query.limit });

  const vendors = await Vendor.find({ _id: { $in: vendorIds }, status: recordStatuses.ACTIVE }).lean();
  const vendorById = new Map(vendors.map((vendor) => [String(vendor._id), vendor]));
  const activeProducts = products.filter((product) => vendorById.has(String(product.vendorId)));
  if (!activeProducts.length) return toPaginatedResult({ items: [], total: 0, page: query.page, limit: query.limit });

  const match = buildSearchMatch({ ...query, status: recordStatuses.ACTIVE });
  match.vendorProductId = { $in: activeProducts.map((product) => product._id) };
  const [costCenters, total] = await Promise.all([
    VendorCostCenter.find(match)
      .sort({ code: 1, _id: 1 })
      .skip(getPaginationOffset(query))
      .limit(query.limit)
      .lean(),
    VendorCostCenter.countDocuments(match),
  ]);
  const productById = new Map(activeProducts.map((product) => [String(product._id), product]));
  return toPaginatedResult({
    items: costCenters.map((vendorCostCenter) => {
      const vendorProduct = productById.get(String(vendorCostCenter.vendorProductId));
      return {
        vendor: vendorById.get(String(vendorProduct.vendorId)),
        vendorProduct,
        vendorCostCenter,
      };
    }),
    total,
    page: query.page,
    limit: query.limit,
  });
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
  includeTotal = true,
} = {}) {
  const scopedProductSearch = !q && (vendorId || vendorProductId || (productTypeGroupId && !includeDifferentProductType));
  if (scopedProductSearch) {
    return searchScopedProducts({
      page,
      limit,
      vendorId,
      vendorProductId,
      productTypeGroupId,
      sku,
      lngCode,
      size,
      color,
      status,
      includeDifferentProductType,
    });
  }

  const match = buildSearchMatch({ vendorProductId, sku, lngCode, size, color, status });

  const qOr = [];
  ['code', 'name', 'sku', 'lngCode', 'standardSize', 'standardColor', 'vendorSize', 'vendorColor'].forEach((path) => {
    pushRegex(qOr, path, q);
  });

  const afterLookupMatch = {
    'vendorProduct.status': recordStatuses.ACTIVE,
    'vendor.status': recordStatuses.ACTIVE,
  };
  if (vendorId) afterLookupMatch['vendorProduct.vendorId'] = maybeObjectId(vendorId);
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

  const itemStages = [
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
  ];
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
        localField: 'vendorProduct.vendorId',
        foreignField: '_id',
        as: 'vendor',
      },
    },
    { $unwind: '$vendor' },
    { $match: afterLookupMatch },
    ...(includeTotal ? [{ $facet: { items: itemStages, total: [{ $count: 'count' }] } }] : itemStages),
  ];

  const result = await VendorCostCenter.aggregate(pipeline);
  const [{ items = [], total = [] } = {}] = result;
  return toPaginatedResult({
    items: includeTotal ? items : result,
    total: includeTotal ? total[0]?.count || 0 : null,
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

async function updateIfVersion(costCenterId, version, patch) {
  return VendorCostCenter.findOneAndUpdate(
    { _id: costCenterId, __v: version },
    { $set: patch, $inc: { __v: 1 } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

module.exports = {
  create,
  createMany,
  countAll,
  findById,
  findByProductAndCode,
  findByLegacyId,
  list,
  cursorAllForExport,
  listActiveByProduct,
  listActiveByProducts,
  listActiveMatchProbesByProducts,
  listActiveByIds,
  listOptionsByProduct,
  search,
  countByProduct,
  update,
  updateIfVersion,
  buildFilter,
};
