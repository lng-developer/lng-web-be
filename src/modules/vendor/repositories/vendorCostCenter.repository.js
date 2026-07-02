const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const { buildCaseInsensitivePrefixRegex, normalizeSearchTerm } = require('../../../shared/utils/search');
const { recordStatuses } = require('../constants/vendor.constants');
const VendorCostCenter = require('../models/vendorCostCenter.model');

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

async function countByProduct(vendorProductId) {
  return VendorCostCenter.countDocuments({ vendorProductId });
}

async function update(costCenterId, patch) {
  return VendorCostCenter.findByIdAndUpdate(
    costCenterId,
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

module.exports = {
  create,
  findById,
  findByProductAndCode,
  list,
  listActiveByProduct,
  countByProduct,
  update,
  buildFilter,
};
