const { getPaginationOffset, normalizePagination } = require('../../../shared/utils/pagination');
const { buildCaseInsensitivePrefixRegex, normalizeSearchTerm } = require('../../../shared/utils/search');
const EmployeeProfile = require('../models/employeeProfile.model');

const PUBLIC_PROFILE_PROJECTION = '_id accountId employeeCode fullName departmentId teamId status isProfileUpdated avatarAssetId avatarUrl';

function includeSensitive(query) {
  return query.select('+identityCard +taxIdentification +socialInsuranceNumber +bankAccount +baseCurrency +baseSalary +allowances +responsibilityAllowance');
}

function buildFilter({ departmentId, includeDeleted, profileIds, q, scopeFilters, status, teamId } = {}) {
  const filter = includeDeleted ? {} : { isDeleted: false };
  if (profileIds) filter._id = { $in: profileIds };
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

async function findByAccountId(accountId, { includeDeleted = false, includeSensitive: shouldIncludeSensitive = false, session } = {}) {
  const query = EmployeeProfile.findOne({ accountId, ...(includeDeleted ? {} : { isDeleted: false }) }).session(session || null);
  return (shouldIncludeSensitive ? includeSensitive(query) : query).lean();
}

async function findByEmployeeCode(employeeCode, { includeDeleted = false, session } = {}) {
  return EmployeeProfile.findOne({
    employeeCode: String(employeeCode).trim().toUpperCase(),
    ...(includeDeleted ? {} : { isDeleted: false }),
  }).session(session || null).lean();
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

async function listByIds(profileIds = []) {
  const ids = [...new Set(profileIds.filter(Boolean).map(String))];
  if (!ids.length) return [];
  return EmployeeProfile.find({ _id: { $in: ids }, isDeleted: false }).lean();
}

async function updateById(profileId, patch, { session } = {}) {
  return EmployeeProfile.findByIdAndUpdate(
    profileId,
    { $set: patch },
    { returnDocument: 'after', runValidators: true, ...(session ? { session } : {}) },
  ).lean();
}

async function touchScheduleMutation(profileId, { session } = {}) {
  return EmployeeProfile.findByIdAndUpdate(
    profileId,
    { $inc: { scheduleMutationVersion: 1 } },
    { returnDocument: 'after', session },
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

async function listPublicByEmployeeCodes(employeeCodes, { includeDeleted = false } = {}) {
  const codes = [...new Set(employeeCodes.filter(Boolean).map((code) => String(code).trim().toUpperCase()))];
  if (!codes.length) return [];
  return EmployeeProfile.find({
    employeeCode: { $in: codes },
    ...(includeDeleted ? {} : { isDeleted: false }),
  }).select(PUBLIC_PROFILE_PROJECTION).lean();
}

async function listPublicProfiles({
  accountIds = [],
  excludedAccountIds = [],
  search,
  teamIds = [],
  limit = 100,
} = {}) {
  const filter = {
    isDeleted: false,
    status: { $in: ['ACTIVE', 'PROBATION'] },
  };
  if (accountIds.length) filter.accountId = { $in: accountIds };
  if (teamIds.length) filter.teamId = { $in: teamIds };
  if (excludedAccountIds.length) {
    filter.accountId = { ...(filter.accountId || {}), $nin: excludedAccountIds };
  }
  if (normalizeSearchTerm(search)) {
    const regex = buildCaseInsensitivePrefixRegex(search);
    filter.$or = [{ employeeCode: regex }, { fullName: regex }];
  }
  return EmployeeProfile.find(filter)
    .select(PUBLIC_PROFILE_PROJECTION)
    .sort({ employeeCode: 1, _id: 1 })
    .limit(limit)
    .lean();
}

async function aggregateDashboardStatuses(dateKey) {
  const monthStart = dateKey ? new Date(`${dateKey.slice(0, 7)}-01T00:00:00.000Z`) : null;
  const monthEnd = monthStart
    ? new Date(Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1))
    : null;
  const endingSoonStart = dateKey ? new Date(`${dateKey}T00:00:00.000Z`) : null;
  const endingSoonEnd = endingSoonStart ? new Date(endingSoonStart) : null;
  if (endingSoonEnd) endingSoonEnd.setUTCDate(endingSoonEnd.getUTCDate() + 30);
  const [row = {}] = await EmployeeProfile.aggregate([
    { $match: { isDeleted: false } },
    {
      $group: {
        _id: null,
        total: { $sum: 1 },
        active: { $sum: { $cond: [{ $eq: ['$status', 'ACTIVE'] }, 1, 0] } },
        probation: { $sum: { $cond: [{ $eq: ['$status', 'PROBATION'] }, 1, 0] } },
        onLeave: { $sum: { $cond: [{ $eq: ['$status', 'ON_LEAVE'] }, 1, 0] } },
        fullTime: { $sum: { $cond: [{ $eq: ['$employmentType', 'FULL_TIME'] }, 1, 0] } },
        partTime: { $sum: { $cond: [{ $eq: ['$employmentType', 'PART_TIME'] }, 1, 0] } },
        contractor: { $sum: { $cond: [{ $in: ['$employmentType', ['CONTRACT', 'INTERNSHIP']] }, 1, 0] } },
        newThisMonth: {
          $sum: {
            $cond: [
              monthStart ? { $and: [{ $gte: ['$startDate', monthStart] }, { $lt: ['$startDate', monthEnd] }] } : false,
              1,
              0,
            ],
          },
        },
        endingSoon: {
          $sum: {
            $cond: [
              endingSoonStart ? { $and: [{ $gte: ['$endDate', endingSoonStart] }, { $lte: ['$endDate', endingSoonEnd] }] } : false,
              1,
              0,
            ],
          },
        },
      },
    },
  ]);
  return row;
}

module.exports = {
  aggregateDashboardStatuses,
  create,
  findByAccountId,
  findByEmployeeCode,
  findById,
  findPublicByAccountId,
  findPublicByEmployeeCode,
  list,
  listByIds,
  listIds,
  listByAccountIds,
  listPublicByAccountIds,
  listPublicByEmployeeCodes,
  listPublicProfiles,
  restore,
  softDelete,
  updateById,
  touchScheduleMutation,
};
