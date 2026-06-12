const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const { scopeRegistryStatuses } = require('../constants/auth.constants');
const ScopeRegistry = require('../models/scopeRegistry.model');

function buildListFilter({ scopeType, scopeId, status, search } = {}) {
  const filter = {};

  if (scopeType) {
    filter.scopeType = scopeType;
  }

  if (scopeId) {
    filter.scopeId = scopeId;
  }

  if (status) {
    filter.status = status;
  }

  if (search) {
    filter.name = { $regex: search, $options: 'i' };
  }

  return filter;
}

async function create(payload, { session } = {}) {
  const scopes = await ScopeRegistry.create([payload], { session });
  return scopes[0].toObject();
}

async function findById(scopeRegistryId) {
  return ScopeRegistry.findById(scopeRegistryId).lean();
}

async function findActiveByScope(scopeType, scopeId) {
  return ScopeRegistry.findOne({
    scopeType,
    scopeId,
    status: scopeRegistryStatuses.ACTIVE,
  }).lean();
}

async function list({ page = 1, limit = 20, ...filters } = {}) {
  const filter = buildListFilter(filters);
  const [items, total] = await Promise.all([
    ScopeRegistry.find(filter)
      .sort({ scopeType: 1, name: 1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    ScopeRegistry.countDocuments(filter),
  ]);

  return toPaginatedResult({
    items,
    total,
    page,
    limit,
  });
}

async function update(scopeRegistryId, payload) {
  return ScopeRegistry.findByIdAndUpdate(
    scopeRegistryId,
    { $set: payload },
    { new: true, runValidators: true },
  ).lean();
}

module.exports = {
  create,
  findById,
  findActiveByScope,
  list,
  update,
};
