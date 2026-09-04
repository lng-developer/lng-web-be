const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const { buildCaseInsensitivePrefixRegex, normalizeSearchTerm } = require('../../../shared/utils/search');
const InternalTemplate = require('../models/internalTemplate.model');
const { recordStatuses } = require('../constants/catalog.constants');

function withProductTypeGroup(query) {
  return query.populate({
    path: 'productTypeGroupId',
    select: 'code name status',
  });
}

function buildFilter({
  code,
  name,
  q,
  productTypeGroupId,
  status,
} = {}) {
  const filter = {};
  if (productTypeGroupId) filter.productTypeGroupId = productTypeGroupId;
  if (status) filter.status = status;

  const codeRegex = buildCaseInsensitivePrefixRegex(normalizeSearchTerm(code));
  if (codeRegex) filter.code = codeRegex;

  const nameRegex = buildCaseInsensitivePrefixRegex(normalizeSearchTerm(name || q));
  if (nameRegex) filter.name = nameRegex;

  return filter;
}

async function create(payload) {
  const template = await InternalTemplate.create(payload);
  return withProductTypeGroup(InternalTemplate.findById(template._id)).lean();
}

async function findById(templateId) {
  return withProductTypeGroup(InternalTemplate.findById(templateId)).lean();
}

async function findByIds(templateIds = []) {
  const ids = [...new Set((templateIds || []).filter(Boolean).map(String))];
  if (!ids.length) return [];
  return withProductTypeGroup(InternalTemplate.find({ _id: { $in: ids } })).lean();
}

async function findByCode(code) {
  return withProductTypeGroup(InternalTemplate.findOne({ code })).lean();
}

async function list({ page = 1, limit = 20, ...filters } = {}) {
  const filter = buildFilter(filters);
  const [items, total] = await Promise.all([
    withProductTypeGroup(InternalTemplate.find(filter))
      .sort({ code: 1, _id: 1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    InternalTemplate.countDocuments(filter),
  ]);

  return toPaginatedResult({ items, total, page, limit });
}

function listActiveForOptions() {
  return InternalTemplate.aggregate([
    { $match: { status: recordStatuses.ACTIVE } },
    { $sort: { code: 1, _id: 1 } },
    { $lookup: {
      from: 'producttypegroups',
      localField: 'productTypeGroupId',
      foreignField: '_id',
      as: 'productTypeGroup',
    } },
    { $unwind: { path: '$productTypeGroup', preserveNullAndEmptyArrays: true } },
    { $project: {
      code: 1,
      name: 1,
      description: 1,
      requiresPsd: 1,
      status: 1,
      productTypeGroupId: {
        _id: '$productTypeGroup._id',
        code: '$productTypeGroup.code',
        name: '$productTypeGroup.name',
        status: '$productTypeGroup.status',
      },
      requiredFieldsCount: { $size: { $ifNull: ['$requiredFields', []] } },
      artworkSlotsCount: { $size: { $ifNull: ['$artworkSlots', []] } },
      designAssetsCount: { $size: { $ifNull: ['$designAssets', []] } },
    } },
  ]);
}

async function update(templateId, patch) {
  return withProductTypeGroup(InternalTemplate.findByIdAndUpdate(
    templateId,
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  )).lean();
}

module.exports = {
  create,
  findById,
  findByIds,
  findByCode,
  list,
  listActiveForOptions,
  update,
  buildFilter,
};
