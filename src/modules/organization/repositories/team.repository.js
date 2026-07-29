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

async function update(teamId, payload, { session } = {}) {
  return Team.findByIdAndUpdate(
    teamId,
    { $set: payload },
    { returnDocument: 'after', runValidators: true, session },
  ).lean();
}

async function migrateLegacyTeams(items = [], { apply = false } = {}) {
  if (!apply || !items.length) return { inserted: 0, updated: 0, unchanged: 0, failed: 0 };
  const result = await Team.bulkWrite(items.map((item) => {
    const { _id, ...payload } = item;
    return { updateOne: { filter: { code: item.code }, update: { $set: payload, ...(item._id ? { $setOnInsert: { _id: item._id } } : {}) }, upsert: true } };
  }), { ordered: false });
  const inserted = Number(result.upsertedCount || 0);
  const updated = Number(result.modifiedCount || 0);
  return { inserted, updated, unchanged: Math.max(0, Number(result.matchedCount || 0) - updated), failed: 0 };
}

async function resolveLegacyTeams(items = []) {
  if (!items.length) return { items: [], mappings: [], skippedRows: [] };
  const existing = await Team.find({
    $or: [
      { _id: { $in: items.map((item) => item._id) } },
      { code: { $in: items.map((item) => item.code) } },
    ],
  }).lean();
  const byId = new Map(existing.map((item) => [String(item._id), item]));
  const byCode = new Map(existing.map((item) => [item.code, item]));
  const resolved = [];
  const mappings = [];
  const skippedRows = [];
  for (const item of items) {
    const sourceId = String(item._id);
    const idOwner = byId.get(sourceId);
    const codeOwner = byCode.get(item.code);
    if (idOwner && idOwner.code !== item.code) {
      skippedRows.push({ sourceId, reasonCode: 'TEAM_SOURCE_ID_COLLISION' });
      continue;
    }
    const targetId = codeOwner?._id || idOwner?._id || item._id;
    resolved.push({ ...item, _id: targetId });
    mappings.push({ sourceId, targetId: String(targetId) });
  }
  return { items: resolved, mappings, skippedRows };
}

module.exports = {
  create,
  findById,
  findByCode,
  list,
  update,
  resolveLegacyTeams,
  migrateLegacyTeams,
};
