const TeamsUserMapping = require('../models/teamsUserMapping.model');

async function findByAccountId(accountId) {
  if (!accountId) return null;
  return TeamsUserMapping.findOne({ accountId }).lean();
}

async function findByEntraUserId(entraUserId) {
  if (!entraUserId) return null;
  return TeamsUserMapping.findOne({ entraUserId }).lean();
}

async function findByEmail(email) {
  if (!email) return null;
  return TeamsUserMapping.findOne({ email: email.toLowerCase().trim() }).lean();
}

async function upsertMapping(data) {
  const filter = data.entraUserId ? { entraUserId: data.entraUserId } : { email: data.email.toLowerCase().trim() };
  return TeamsUserMapping.findOneAndUpdate(
    filter,
    { $set: data },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean();
}

async function getWithRefreshToken(entraUserId) {
  if (!entraUserId) return null;
  return TeamsUserMapping.findOne({ entraUserId }).select('+encryptedRefreshToken').lean();
}

async function updateRefreshToken(entraUserId, encryptedRefreshToken, tokenExpiresAt = null) {
  return TeamsUserMapping.findOneAndUpdate(
    { entraUserId },
    { $set: { encryptedRefreshToken, tokenExpiresAt, status: 'ACTIVE' } },
    { returnDocument: 'after' },
  ).lean();
}

async function listMappings(filter = {}, { limit = 50, skip = 0 } = {}) {
  const [items, total] = await Promise.all([
    TeamsUserMapping.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    TeamsUserMapping.countDocuments(filter),
  ]);
  return { items, total };
}

module.exports = {
  findByAccountId,
  findByEntraUserId,
  findByEmail,
  upsertMapping,
  getWithRefreshToken,
  updateRefreshToken,
  listMappings,
};
