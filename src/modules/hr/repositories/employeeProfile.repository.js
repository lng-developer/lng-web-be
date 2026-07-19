const { getPaginationOffset, normalizePagination } = require('../../../shared/utils/pagination');
const { buildCaseInsensitivePrefixRegex, normalizeSearchTerm } = require('../../../shared/utils/search');
const EmployeeProfile = require('../models/employeeProfile.model');

const PUBLIC_PROFILE_PROJECTION = '_id accountId employeeCode fullName departmentId teamId status';

function includeSensitive(query) {
  return query.select('+identityCard +taxIdentification +socialInsuranceNumber +bankAccount +baseCurrency +baseSalary +allowances +responsibilityAllowance');
}

function buildFilter({ departmentId, includeDeleted, q, scopeFilters, status, teamId } = {}) {
  const filter = includeDeleted ? {} : { isDeleted: false };
  if (departmentId) filter.departmentId = departmentId;
  if (teamId) filter.teamId = teamId;
  if (status) filter.status = status;

  const search = normalizeSearchTerm(q);
  if (search) {
    const employeeCode = buildCaseInsensitivePrefixRegex(search);
    filter.$or = [
      { employeeCode },
      { fullName: buildCaseInsensitivePrefixRegex(search) },
    ];
  }
  if (scopeFilters?.length) {
    filter.$and = [
      ...(filter.$or ? [{ $or: filter.$or }] : []),
      { $or: scopeFilters },
    ];
    delete filter.$or;
  }
  return filter;
}

async function create(payload, { session } = {}) {
  const [profile] = await EmployeeProfile.create([payload], { session });
  return profile.toObject();
}

async function findById(profileId, { includeSensitive: shouldIncludeSensitive = false } = {}) {
  const query = EmployeeProfile.findById(profileId);
  return (shouldIncludeSensitive ? includeSensitive(query) : query).lean();
}

async function findByAccountId(accountId, { includeDeleted = false, includeSensitive: shouldIncludeSensitive = false } = {}) {
  const query = EmployeeProfile.findOne({ accountId, ...(includeDeleted ? {} : { isDeleted: false }) });
  return (shouldIncludeSensitive ? includeSensitive(query) : query).lean();
}

async function findByEmployeeCode(employeeCode, { includeDeleted = false } = {}) {
  return EmployeeProfile.findOne({
    employeeCode: String(employeeCode).trim().toUpperCase(),
    ...(includeDeleted ? {} : { isDeleted: false }),
  }).lean();
}

async function findPublicByAccountId(accountId, { includeDeleted = false } = {}) {
  return EmployeeProfile.findOne({ accountId, ...(includeDeleted ? {} : { isDeleted: false }) })
    .select(PUBLIC_PROFILE_PROJECTION)
    .lean();
}

async function findPublicByEmployeeCode(employeeCode, { includeDeleted = false } = {}) {
  return EmployeeProfile.findOne({
    employeeCode: String(employeeCode).trim().toUpperCase(),
    ...(includeDeleted ? {} : { isDeleted: false }),
  })
    .select(PUBLIC_PROFILE_PROJECTION)
    .lean();
}

async function listPublicByAccountIds(accountIds, { includeDeleted = false } = {}) {
  return EmployeeProfile.find({
    accountId: { $in: accountIds },
    ...(includeDeleted ? {} : { isDeleted: false }),
  })
    .select(PUBLIC_PROFILE_PROJECTION)
    .lean();
}

async function list(query = {}) {
  const { page, limit } = normalizePagination(query);
  const filter = buildFilter(query);
  const [items, total] = await Promise.all([
    EmployeeProfile.find(filter)
      .sort({ employeeCode: 1, _id: 1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    EmployeeProfile.countDocuments(filter),
  ]);
  return { items, pagination: { page, limit, total } };
}

async function listIds(query = {}) {
  return EmployeeProfile.find(buildFilter(query)).select('_id').lean();
}

async function updateById(profileId, patch) {
  return EmployeeProfile.findByIdAndUpdate(
    profileId,
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function softDelete(profileId) {
  return updateById(profileId, { isDeleted: true, deletedAt: new Date() });
}

async function restore(profileId) {
  return updateById(profileId, { isDeleted: false, deletedAt: null });
}

async function listByAccountIds(accountIds, { includeDeleted = false, includeSensitive: shouldIncludeSensitive = false } = {}) {
  const query = EmployeeProfile.find({
    accountId: { $in: accountIds },
    ...(includeDeleted ? {} : { isDeleted: false }),
  });
  return (shouldIncludeSensitive ? includeSensitive(query) : query).lean();
}

module.exports = {
  create,
  findByAccountId,
  findByEmployeeCode,
  findById,
  findPublicByAccountId,
  findPublicByEmployeeCode,
  list,
  listIds,
  listByAccountIds,
  listPublicByAccountIds,
  restore,
  softDelete,
  updateById,
};
