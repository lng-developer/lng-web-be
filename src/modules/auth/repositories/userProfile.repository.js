const UserProfile = require('../models/userProfile.model');

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
  updateByAccountId,
};
