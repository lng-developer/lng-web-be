const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const { buildCaseInsensitivePrefixRegex, normalizeSearchTerm } = require('../../../shared/utils/search');
const { recordStatuses } = require('../constants/vendor.constants');
const VendorProduct = require('../models/vendorProduct.model');

function buildFilter({
  vendorId,
  productTypeGroupId,
  code,
  externalProductId,
  status,
  q,
} = {}) {
  const filter = {};
  if (vendorId) filter.vendorId = vendorId;
  if (productTypeGroupId) filter.productTypeGroupId = productTypeGroupId;
  if (externalProductId) filter.externalProductId = externalProductId;
  if (status) filter.status = status;

  const codeRegex = buildCaseInsensitivePrefixRegex(normalizeSearchTerm(code));
  if (codeRegex) filter.code = codeRegex;

  const qRegex = buildCaseInsensitivePrefixRegex(normalizeSearchTerm(q));
  if (qRegex) filter.$or = [{ code: qRegex }, { name: qRegex }, { externalProductId: qRegex }];

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

async function findById(productId) {
  return withVendor(VendorProduct.findById(productId)).lean();
}

async function findByCode({ vendorId, code, includeInactive = false } = {}) {
  const filter = { vendorId, code };
  if (!includeInactive) filter.status = recordStatuses.ACTIVE;
  return withVendor(VendorProduct.findOne(filter)).lean();
}

async function list({ page = 1, limit = 20, ...filters } = {}) {
  const filter = buildFilter(filters);
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

async function listActiveByProductTypeGroup(productTypeGroupId) {
  return withVendor(VendorProduct.find({
    productTypeGroupId,
    status: recordStatuses.ACTIVE,
  }).sort({ code: 1, _id: 1 })).lean();
}

async function update(productId, patch) {
  return withVendor(VendorProduct.findByIdAndUpdate(
    productId,
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  )).lean();
}

module.exports = {
  create,
  findById,
  findByCode,
  list,
  listActiveByProductTypeGroup,
  update,
  buildFilter,
};
