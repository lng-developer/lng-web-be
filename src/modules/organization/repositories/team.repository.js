const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const { buildPrefixRegex, normalizeSearchTerm } = require('../../../shared/utils/search');
const Team = require('../models/team.model');

function buildFilter({
  ids,
  departmentIds,
  departmentId,
  status,
  search,
} = {}) {
  const filter = {};
  const scopedOr = [];

  if (ids && ids.length > 0) {
    scopedOr.push({ _id: { $in: ids } });
  }

  if (departmentIds && departmentIds.length > 0) {
    scopedOr.push({ departmentId: { $in: departmentIds } });
  }

  if (scopedOr.length > 0) {
    filter.$or = scopedOr;
  }

  if (departmentId) {
    filter.departmentId = departmentId;
  }

  if (status) {
    filter.status = status;
  }

  const normalizedSearch = normalizeSearchTerm(search);
  const codeRegex = buildPrefixRegex(normalizedSearch.toUpperCase());

  if (codeRegex) {
    filter.code = codeRegex;
  }

  return filter;
}

async function create(payload, { session } = {}) {
  const teams = await Team.create([payload], { session });
  return teams[0].toObject();
}

async function findById(teamId) {
  return Team.findById(teamId).lean();
}

async function findByCode(code) {
  return Team.findOne({ code: String(code).toUpperCase() }).lean();
}

async function list({ page = 1, limit = 20, ...filters } = {}) {
  const filter = buildFilter(filters);
  const [items, total] = await Promise.all([
    Team.find(filter)
      .sort({ code: 1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    Team.countDocuments(filter),
  ]);

  return toPaginatedResult({ items, total, page, limit });
}

async function update(teamId, payload) {
  return Team.findByIdAndUpdate(
    teamId,
    { $set: payload },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

module.exports = {
  create,
  findById,
  findByCode,
  list,
  update,
};
