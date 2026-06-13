const Account = require('../models/account.model');
const UserProfile = require('../models/userProfile.model');
const { accountStatuses } = require('../constants/auth.constants');

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

async function listAssignableProfiles({
  excludedAccountIds = [],
  search,
  limit = 50,
} = {}) {
  const filter = {};
  const normalizedSearch = search ? String(search).trim() : '';

  if (excludedAccountIds.length > 0) {
    filter.accountId = { $nin: excludedAccountIds };
  }

  if (normalizedSearch) {
    filter.$or = [
      { employeeCode: new RegExp(normalizedSearch, 'i') },
      { fullName: new RegExp(normalizedSearch, 'i') },
      { email: new RegExp(normalizedSearch, 'i') },
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
    { new: true, session },
  ).lean();
}

module.exports = {
  create,
  findByAccountId,
  findByEmail,
  findByEmployeeCode,
  listAssignableProfiles,
  updateByAccountId,
};
