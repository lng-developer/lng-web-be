const TeamsMessageMapping = require('../models/teamsMessageMapping.model');

async function findByLngMessageId(lngMessageId) {
  if (!lngMessageId) return null;
  return TeamsMessageMapping.findOne({ lngMessageId }).lean();
}

async function findByTeamsMessageId(teamsMessageId) {
  if (!teamsMessageId) return null;
  return TeamsMessageMapping.findOne({ teamsMessageId }).lean();
}

async function findByTeamsChatAndMessageId(teamsChatId, teamsMessageId) {
  if (!teamsChatId || !teamsMessageId) return null;
  return TeamsMessageMapping.findOne({ teamsChatId, teamsMessageId }).lean();
}

async function createMapping(data) {
  try {
    const mapping = await TeamsMessageMapping.create(data);
    return mapping.toObject();
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const mapping = await TeamsMessageMapping.findOne({
      $or: [{ lngMessageId: data.lngMessageId }, { teamsMessageId: data.teamsMessageId }],
    }).lean();
    if (!mapping) throw error;
    return mapping;
  }
}

async function updateStatus(teamsMessageId, status, errorDetails = null) {
  return TeamsMessageMapping.findOneAndUpdate(
    { teamsMessageId },
    { $set: { status, ...(errorDetails ? { errorDetails } : {}) } },
    { returnDocument: 'after' },
  ).lean();
}

module.exports = {
  findByLngMessageId,
  findByTeamsMessageId,
  findByTeamsChatAndMessageId,
  createMapping,
  updateStatus,
};
