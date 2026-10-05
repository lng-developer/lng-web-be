const TeamsChatMapping = require('../models/teamsChatMapping.model');

async function findByConversationId(conversationId) {
  if (!conversationId) return null;
  return TeamsChatMapping.findOne({ conversationId }).lean();
}

async function findByTeamsChatId(teamsChatId) {
  if (!teamsChatId) return null;
  return TeamsChatMapping.findOne({ teamsChatId }).lean();
}

async function findByParticipantEntraUserIds(userId1, userId2) {
  if (!userId1 || !userId2) return null;
  return TeamsChatMapping.findOne({
    participantEntraUserIds: { $all: [userId1, userId2] },
  }).lean();
}

async function createOrUpdateMapping(data) {
  return TeamsChatMapping.findOneAndUpdate(
    { conversationId: data.conversationId },
    { $set: data },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean();
}

async function updateLastSync(teamsChatId) {
  return TeamsChatMapping.findOneAndUpdate(
    { teamsChatId },
    { $set: { lastSyncAt: new Date() } },
    { returnDocument: 'after' },
  ).lean();
}

module.exports = {
  findByConversationId,
  findByTeamsChatId,
  findByParticipantEntraUserIds,
  createOrUpdateMapping,
  updateLastSync,
};
