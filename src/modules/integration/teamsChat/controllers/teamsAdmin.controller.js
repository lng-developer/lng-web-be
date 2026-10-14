const config = require('../../../../config');
const httpStatus = require('../../../../shared/constants/httpStatus');
const teamsSyncService = require('../services/teamsSync.service');
const teamsUserMappingRepository = require('../repositories/teamsUserMapping.repository');

async function getStatus(req, res) {
  const accountId = req.auth?.accountId || req.authContext?.accountId;
  const userMapping = accountId ? await teamsUserMappingRepository.findByAccountId(accountId) : null;

  return res.status(httpStatus.OK).json({
    success: true,
    data: {
      enabled: config.teams.enabled,
      tenantId: config.teams.tenantId,
      webhookConfigured: Boolean(config.teams.webhookUrl),
      userLinked: Boolean(userMapping?.entraUserId),
      entraUserId: userMapping?.entraUserId || null,
    },
  });
}

async function linkAccount(req, res) {
  const accountId = req.auth?.accountId || req.authContext?.accountId;
  const { entraUserId, email, displayName, refreshToken } = req.body;

  const mapping = await teamsSyncService.linkUserWithEntra({
    accountId,
    entraUserId,
    email: email || req.auth?.email || req.authContext?.email,
    displayName,
    refreshToken,
  });

  return res.status(httpStatus.OK).json({
    success: true,
    data: {
      linked: true,
      entraUserId: mapping.entraUserId,
    },
  });
}

async function ensureSubscription(req, res) {
  const result = await teamsSyncService.ensureWebhookSubscription();
  return res.status(httpStatus.OK).json({
    success: true,
    data: result,
  });
}

async function syncConversation(req, res) {
  const conversationId = req.params.conversationId;
  const result = await teamsSyncService.syncInboundMessagesForConversation({ conversationId });
  return res.status(httpStatus.OK).json({
    success: true,
    data: result,
  });
}

module.exports = {
  getStatus,
  linkAccount,
  ensureSubscription,
  syncConversation,
};
