const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const Team = require('../models/team.model');

function buildFilter({
  departmentId,
  status,
  search,
} = {}) {
  const filter = {};

  if (departmentId) {
    filter.departmentId = departmentId;
  }

  if (status) {
    filter.status = status;
  }

  if (search) {
    filter.$or = [
      { code: { $regex: search, $options: 'i' } },
      { name: { $regex: search, $options: 'i' } },
    ];
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
