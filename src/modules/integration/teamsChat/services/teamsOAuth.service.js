const crypto = require('crypto');
const config = require('../../../../config');
const AppError = require('../../../../shared/errors/appError');
const httpStatus = require('../../../../shared/constants/httpStatus');
const errorCodes = require('../../../../shared/constants/errorCodes');
const cryptoService = require('./crypto.service');
const graphClient = require('./microsoftGraphClient');
const stateRepository = require('../repositories/teamsOAuthState.repository');
const mappingRepository = require('../repositories/teamsUserMapping.repository');
const authPublic = require('../../../auth/public');

const scope = 'openid profile offline_access User.Read Chat.ReadWrite ChatMessage.Send';
const hash = (value) => crypto.createHash('sha256').update(value).digest('base64url');
const invalid = (message) => new AppError(message, httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
const normalizeEmail = (email) => String(email || '').trim().toLowerCase();
function requiredConfig() {
  if (!config.teams.enabled || !config.teams.clientId || !config.teams.clientSecret || !config.teams.oauthRedirectUri) throw invalid('Teams OAuth is not configured');
}
function verifier() { return crypto.randomBytes(64).toString('base64url'); }

async function startAuthorization(authContext = {}) {
  requiredConfig();
  if (!authContext.accountId) throw invalid('Authentication required');
  const state = crypto.randomBytes(32).toString('base64url');
  const codeVerifier = verifier();
  await stateRepository.create({ stateHash: hash(state), accountId: authContext.accountId, encryptedVerifier: cryptoService.encrypt(codeVerifier), expiresAt: new Date(Date.now() + 10 * 60 * 1000) });
  const url = new URL(`https://login.microsoftonline.com/${config.teams.tenantId || 'common'}/oauth2/v2.0/authorize`);
  url.search = new URLSearchParams({ client_id: config.teams.clientId, response_type: 'code', redirect_uri: config.teams.oauthRedirectUri, response_mode: 'query', scope, state, code_challenge: hash(codeVerifier), code_challenge_method: 'S256', prompt: 'select_account' }).toString();
  return url.toString();
}

async function completeAuthorization({ code, state }) {
  requiredConfig();
  if (!code || !state) throw invalid('Invalid Teams OAuth callback');
  const pending = await stateRepository.consume(hash(state));
  if (!pending?.encryptedVerifier) throw invalid('Teams OAuth state is invalid or expired');
  const codeVerifier = cryptoService.decrypt(pending.encryptedVerifier);
  if (!codeVerifier) throw invalid('Teams OAuth state is invalid or expired');
  const tokens = await graphClient.exchangeAuthorizationCode({ code, codeVerifier, redirectUri: config.teams.oauthRedirectUri });
  if (!tokens.refresh_token || !tokens.access_token) throw invalid('Microsoft did not issue a refresh token');
  const profile = await graphClient.getMe({ token: tokens.access_token });
  const authModel = await authPublic.getCurrentAccount(pending.accountId);
  const account = authModel?.account;
  const mapping = await mappingRepository.findByAccountId(pending.accountId);
  const email = normalizeEmail(profile.mail || profile.userPrincipalName);
  const portalEmail = normalizeEmail(account?.email);
  if (!profile.id || !email || !portalEmail || email !== portalEmail
    || (account?.microsoftId && account.microsoftId !== profile.id)
    || (mapping?.entraUserId && mapping.entraUserId !== profile.id)) {
    throw invalid('Microsoft account does not match this Portal account');
  }
  if (!mapping) await mappingRepository.upsertMapping({ accountId: pending.accountId, entraUserId: profile.id, email, displayName: profile.displayName || null });
  await mappingRepository.updateRefreshToken(profile.id, cryptoService.encrypt(tokens.refresh_token), tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000) : null);
  return { connected: true, accountId: String(pending.accountId) };
}

module.exports = { startAuthorization, completeAuthorization };
