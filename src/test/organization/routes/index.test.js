const http = require('http');
const express = require('express');
const organizationRouter = require('../../../modules/organization/routes');
const errorHandler = require('../../../middlewares/errorHandler');
const authManager = require('../../../modules/auth/services/authManager.service');
const organizationService = require('../../../modules/organization/services/organization.service');
const hrPublic = require('../../../modules/hr/public');

jest.mock('../../../modules/auth/services/authManager.service');
jest.mock('../../../modules/organization/services/organization.service');
jest.mock('../../../modules/hr/public', () => ({
  getEmployeeProfileByAccountId: jest.fn(),
}));

function createTestServer() {
  const app = express();
  app.use(express.json());
  app.use(organizationRouter);
  app.use(errorHandler);
  return http.createServer(app);
}

function request(server, { method, path, headers = {}, body }) {
  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const { port } = server.address();
      const req = http.request({ method, port, path, headers }, (res) => {
        let responseBody = '';

        res.on('data', (chunk) => {
          responseBody += chunk;
        });

        res.on('end', () => {
          server.close(() => {
            resolve({
              statusCode: res.statusCode,
              body: responseBody ? JSON.parse(responseBody) : null,
            });
          });
        });
      });

      req.on('error', (error) => {
        server.close(() => reject(error));
      });

      if (body) req.write(JSON.stringify(body));
      req.end();
    });
  });
}

function mockScopedAuth(permission) {
  authManager.verifyAccessToken.mockReturnValue({ sub: 'manager-id', tokenVersion: 0 });
  authManager.getCurrentAccount.mockResolvedValue({
    account: { _id: 'manager-id', email: 'manager@example.com', tokenVersion: 0, status: 'active' },
    roles: [],
    permissions: [],
    scopes: [],
  });
  authManager.buildAuthContext.mockReturnValue({
    accountId: 'manager-id',
    email: 'manager@example.com',
    roles: [],
    permissions: [],
    scopes: [{
      scopeType: 'department',
      scopeId: '660000000000000000000001',
      permissions: [permission],
    }],
  });
}

describe('organization routes authorization', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    hrPublic.getEmployeeProfileByAccountId.mockResolvedValue(null);
  });

  test('GET /departments allows scoped team managers', async () => {
    mockScopedAuth('TEAMS:WRITE');
    organizationService.listDepartments.mockResolvedValue({ items: [], pagination: { total: 0 } });

    const response = await request(createTestServer(), {
      method: 'GET',
      path: '/departments',
      headers: { Authorization: 'Bearer access-token' },
    });

    expect(response.statusCode).toBe(200);
  });

  test('GET /teams allows scoped team readers', async () => {
    mockScopedAuth('TEAMS:READ');
    organizationService.listTeams.mockResolvedValue({ items: [], pagination: { total: 0 } });

    const response = await request(createTestServer(), {
      method: 'GET',
      path: '/teams',
      headers: { Authorization: 'Bearer access-token' },
    });

    expect(response.statusCode).toBe(200);
  });

  test('GET /teams/:teamId/members allows scoped team readers', async () => {
    mockScopedAuth('TEAMS:READ');
    organizationService.listTeamMembers.mockResolvedValue({ leaders: [], members: [] });

    const response = await request(createTestServer(), {
      method: 'GET',
      path: '/teams/660000000000000000000101/members',
      headers: { Authorization: 'Bearer access-token' },
    });

    expect(response.statusCode).toBe(200);
  });

  test('POST /teams/:teamId/members passes bounded HTTP audit context to the membership mutation', async () => {
    mockScopedAuth('TEAMS:WRITE');
    organizationService.addTeamMember.mockResolvedValue({ accountId: '660000000000000000000202' });

    const response = await request(createTestServer(), {
      method: 'POST',
      path: '/teams/660000000000000000000101/members',
      headers: {
        Authorization: 'Bearer access-token',
        'Content-Type': 'application/json',
        'User-Agent': 'organization-route-test',
      },
      body: { accountId: '660000000000000000000202', memberType: 'member' },
    });

    expect(response.statusCode).toBe(201);
    expect(organizationService.addTeamMember).toHaveBeenCalledWith(
      '660000000000000000000101',
      { accountId: '660000000000000000000202', memberType: 'member' },
      expect.objectContaining({
        actorAuth: expect.objectContaining({ accountId: 'manager-id' }),
        httpContext: expect.objectContaining({ userAgent: 'organization-route-test' }),
      }),
    );
  });
});
