const config = require('../../../../config');
const httpStatus = require('../../../../shared/constants/httpStatus');
const teamsSyncService = require('../services/teamsSync.service');
const teamsUserMappingRepository = require('../repositories/teamsUserMapping.repository');
const teamsOAuthService = require('../services/teamsOAuth.service');
const authPublic = require('../../../auth/public');

async function getStatus(req, res) {
  const accountId = req.auth?.accountId || req.authContext?.accountId;
  const userMapping = accountId ? await teamsUserMappingRepository.findByAccountId(accountId) : null;
  const grantRecord = userMapping?.entraUserId
    ? await teamsUserMappingRepository.getWithRefreshToken(userMapping.entraUserId)
    : null;

  return res.status(httpStatus.OK).json({
    success: true,
    data: {
      enabled: config.teams.enabled,
      tenantId: config.teams.tenantId,
      webhookConfigured: Boolean(config.teams.webhookUrl),
      userLinked: Boolean(userMapping?.entraUserId),
      entraUserId: userMapping?.entraUserId || null,
      grantStatus: grantRecord?.encryptedRefreshToken ? 'CONNECTED' : (userMapping?.entraUserId ? 'REAUTH_REQUIRED' : 'NOT_CONNECTED'),
    },
  });
}

async function getOAuthStatus(req, res) {
  const accountId = req.auth?.accountId || req.authContext?.accountId;
  const userMapping = accountId ? await teamsUserMappingRepository.findByAccountId(accountId) : null;
  const authModel = accountId ? await authPublic.getCurrentAccount(accountId) : null;
  const hasMicrosoftIdentity = Boolean(authModel?.account?.microsoftId);
  const grantRecord = userMapping?.entraUserId
    ? await teamsUserMappingRepository.getWithRefreshToken(userMapping.entraUserId)
    : null;

  return res.status(httpStatus.OK).json({
    success: true,
    data: {
      enabled: config.teams.enabled,
      userLinked: Boolean(userMapping?.entraUserId || hasMicrosoftIdentity),
      grantStatus: grantRecord?.encryptedRefreshToken ? 'CONNECTED' : (userMapping?.entraUserId ? 'REAUTH_REQUIRED' : 'NOT_CONNECTED'),
    },
  });
}

async function startOAuth(req, res) {
  const authorizationUrl = await teamsOAuthService.startAuthorization(req.auth || req.authContext);
  return res.status(httpStatus.OK).json({ success: true, data: { authorizationUrl } });
}

async function completeOAuth(req, res) {
  await teamsOAuthService.completeAuthorization(req.query || {});
  return res.status(httpStatus.OK).type('html').send('<!doctype html><title>Teams connected</title><script>window.close()</script><p>Teams connected. You can close this window.</p>');
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
  getOAuthStatus,
  linkAccount,
  ensureSubscription,
  syncConversation,
  startOAuth,
  completeOAuth,
};
