jest.mock('../../../../src/config', () => ({
  teams: { enabled: true, clientId: 'client-id', clientSecret: 'secret', tenantId: 'tenant-id', oauthRedirectUri: 'https://dev-api.lngmerch.co/api/integration/teams/oauth/callback' },
}));
jest.mock('../../../../src/modules/integration/teamsChat/repositories/teamsOAuthState.repository', () => ({ create: jest.fn(), consume: jest.fn() }));
jest.mock('../../../../src/modules/integration/teamsChat/repositories/teamsUserMapping.repository', () => ({ findByAccountId: jest.fn(), upsertMapping: jest.fn(), updateRefreshToken: jest.fn() }));
jest.mock('../../../../src/modules/integration/teamsChat/services/crypto.service', () => ({ encrypt: jest.fn((v) => `encrypted:${v}`), decrypt: jest.fn((v) => v.replace('encrypted:', '')) }));
jest.mock('../../../../src/modules/integration/teamsChat/services/microsoftGraphClient', () => ({ exchangeAuthorizationCode: jest.fn(), getMe: jest.fn() }));

const states = require('../../../../src/modules/integration/teamsChat/repositories/teamsOAuthState.repository');
const mappings = require('../../../../src/modules/integration/teamsChat/repositories/teamsUserMapping.repository');
const graph = require('../../../../src/modules/integration/teamsChat/services/microsoftGraphClient');
const service = require('../../../../src/modules/integration/teamsChat/services/teamsOAuth.service');

describe('Teams OAuth service', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates a short-lived server-side state and PKCE authorization URL', async () => {
    const url = await service.startAuthorization({ accountId: '507f1f77bcf86cd799439011' });
    expect(url).toContain('code_challenge_method=S256');
    expect(url).toContain('redirect_uri=https%3A%2F%2Fdev-api.lngmerch.co%2Fapi%2Fintegration%2Fteams%2Foauth%2Fcallback');
    expect(states.create).toHaveBeenCalledWith(expect.objectContaining({ accountId: '507f1f77bcf86cd799439011', stateHash: expect.any(String), encryptedVerifier: expect.stringMatching(/^encrypted:/), expiresAt: expect.any(Date) }));
    expect(url).not.toContain('encrypted:');
  });

  test('consumes state once and stores only encrypted refresh token', async () => {
    states.consume.mockResolvedValue({ accountId: 'account-1', encryptedVerifier: 'encrypted:verifier' });
    mappings.findByAccountId.mockResolvedValue({ entraUserId: 'entra-1' });
    graph.exchangeAuthorizationCode.mockResolvedValue({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 });
    graph.getMe.mockResolvedValue({ id: 'entra-1', mail: 'hieunv@lngwork.co' });
    await expect(service.completeAuthorization({ code: 'code', state: 'state' })).resolves.toEqual({ connected: true, accountId: 'account-1' });
    expect(graph.exchangeAuthorizationCode).toHaveBeenCalledWith(expect.objectContaining({ code: 'code', codeVerifier: 'verifier' }));
    expect(mappings.updateRefreshToken).toHaveBeenCalledWith('entra-1', 'encrypted:refresh', expect.any(Date));
  });

  test('rejects expired or reused OAuth state before exchanging a code', async () => {
    states.consume.mockResolvedValue(null);
    await expect(service.completeAuthorization({ code: 'code', state: 'state' })).rejects.toThrow('state');
    expect(graph.exchangeAuthorizationCode).not.toHaveBeenCalled();
  });
});
