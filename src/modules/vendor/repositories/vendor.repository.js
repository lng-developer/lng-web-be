const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const { buildCaseInsensitivePrefixRegex, normalizeSearchTerm } = require('../../../shared/utils/search');
const Vendor = require('../models/vendor.model');

function buildFilter({
  id,
  code,
  fulfillmentType,
  providerKey,
  status,
  q,
} = {}) {
  const filter = {};
  if (id) filter._id = id;
  if (providerKey) filter.providerKey = providerKey;
  if (fulfillmentType) filter.fulfillmentType = fulfillmentType;
  if (status) filter.status = status;

  const codeRegex = buildCaseInsensitivePrefixRegex(normalizeSearchTerm(code));
  if (codeRegex) filter.code = codeRegex;

  const qRegex = buildCaseInsensitivePrefixRegex(normalizeSearchTerm(q));
  if (qRegex) filter.$or = [{ code: qRegex }, { name: qRegex }];

  return filter;
}

async function create(payload) {
  const vendor = await Vendor.create(payload);
  return vendor.toObject();
}

async function findById(vendorId) {
  return Vendor.findById(vendorId).lean();
}

async function findByCode(code) {
  return Vendor.findOne({ code }).lean();
}

async function findByLegacyId(legacyId) {
  return Vendor.findOne({ 'metadata.legacyId': String(legacyId) }).lean();
}

async function list({ page = 1, limit = 20, ...filters } = {}) {
  const filter = buildFilter(filters);
  const [items, total] = await Promise.all([
    Vendor.find(filter)
      .sort({ code: 1, _id: 1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    Vendor.countDocuments(filter),
  ]);

  return toPaginatedResult({ items, total, page, limit });
}

async function listActive({ q, limit = 20 } = {}) {
  return Vendor.find(buildFilter({ q, status: 'ACTIVE' }))
    .select('code name')
    .sort({ code: 1, _id: 1 })
    .limit(limit)
    .lean();
}

async function update(vendorId, patch) {
  return Vendor.findByIdAndUpdate(
    vendorId,
    { $set: patch, $inc: { __v: 1 } },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

module.exports = {
  create,
  findById,
  findByCode,
  findByLegacyId,
  list,
  listActive,
  update,
  buildFilter,
};
