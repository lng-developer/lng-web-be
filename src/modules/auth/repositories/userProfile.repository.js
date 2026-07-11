const Account = require('../models/account.model');
const UserProfile = require('../models/userProfile.model');
const { accountStatuses } = require('../constants/auth.constants');
const {
  buildPrefixRegex,
  normalizeSearchTerm,
} = require('../../../shared/utils/search');

async function create(profileData, { session } = {}) {
  const profiles = await UserProfile.create([profileData], { session });
  return profiles[0].toObject();
}

async function findByAccountId(accountId) {
  return UserProfile.findOne({ accountId }).lean();
}

async function findByEmail(email) {
  return UserProfile.findOne({ email: email.toLowerCase() }).lean();
}

async function findByEmployeeCode(employeeCode) {
  return UserProfile.findOne({ employeeCode: String(employeeCode).toUpperCase() }).lean();
}

async function listByEmployeeCodes(employeeCodes = []) {
  const codes = [...new Set(employeeCodes
    .filter(Boolean)
    .map((code) => String(code).trim().toUpperCase())
    .filter(Boolean))];
  if (codes.length === 0) return [];
  return UserProfile.find({ employeeCode: { $in: codes } }).lean();
}

async function listByAccountIds(accountIds = []) {
  const ids = [...new Set(accountIds.filter(Boolean).map(String))];
  if (ids.length === 0) return [];
  return UserProfile.find({ accountId: { $in: ids } }).lean();
}

async function listAssignableProfiles({
  excludedAccountIds = [],
  search,
  limit = 50,
} = {}) {
  const filter = {};
  const normalizedSearch = normalizeSearchTerm(search);

  if (excludedAccountIds.length > 0) {
    filter.accountId = { $nin: excludedAccountIds };
  }

  if (normalizedSearch) {
    const employeeCodeRegex = buildPrefixRegex(normalizedSearch.toUpperCase());
    const emailRegex = buildPrefixRegex(normalizedSearch.toLowerCase());

    filter.$or = [
      { employeeCode: employeeCodeRegex },
      { email: emailRegex },
    ];
  }

  return UserProfile.aggregate([
    { $match: filter },
    {
      $lookup: {
        from: Account.collection.name,
        localField: 'accountId',
        foreignField: '_id',
        as: 'account',
      },
    },
    { $unwind: '$account' },
    { $match: { 'account.status': accountStatuses.ACTIVE } },
    { $sort: { employeeCode: 1, fullName: 1 } },
    { $limit: limit },
    {
      $project: {
        _id: 1,
        accountId: 1,
        email: 1,
        fullName: 1,
        employeeCode: 1,
      },
    },
  ]);
}

async function updateByAccountId(accountId, update, { session } = {}) {
  return UserProfile.findOneAndUpdate(
    { accountId },
    { $set: update },
    { returnDocument: 'after', session },
  ).lean();
}

module.exports = {
  create,
  findByAccountId,
  findByEmail,
  findByEmployeeCode,
  listByAccountIds,
  listByEmployeeCodes,
  listAssignableProfiles,
  updateByAccountId,
};
