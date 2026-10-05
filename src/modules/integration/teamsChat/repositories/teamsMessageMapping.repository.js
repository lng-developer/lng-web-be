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
  const mapping = await TeamsMessageMapping.create(data);
  return mapping.toObject();
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
