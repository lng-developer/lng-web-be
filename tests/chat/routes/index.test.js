const http = require('http');
const express = require('express');
const errorHandler = require('../../../src/middlewares/errorHandler');

jest.mock('../../../src/modules/auth/public', () => ({
  authenticate(req, _res, next) {
    const AppError = require('../../../src/shared/errors/appError');
    const errorCodes = require('../../../src/shared/constants/errorCodes');
    const accountId = req.get('x-account-id');
    if (!accountId) {
      next(new AppError('Authentication required', 401, true, errorCodes.AUTHENTICATION_ERROR));
      return;
    }
    req.auth = { accountId };
    next();
  },
}));

jest.mock('../../../src/modules/chat/services/chat.service', () => ({
  listConversations: jest.fn(async () => ({ items: [], pagination: { page: 1, limit: 20, total: 0 } })),
  createConversation: jest.fn(async () => ({ id: '660000000000000000000001', type: 'DIRECT' })),
  listMessages: jest.fn(async () => ({ items: [], pagination: { page: 1, limit: 20, total: 0 } })),
  sendMessage: jest.fn(async () => ({ id: '660000000000000000000011', body: 'hello' })),
  markRead: jest.fn(async () => ({ conversationId: '660000000000000000000001', accountId: '660000000000000000000002' })),
  listParticipants: jest.fn(async () => ({ items: [{ id: '660000000000000000000002', email: 'a@lng.co' }] })),
}));

const router = require('../../../src/modules/chat/routes');
const service = require('../../../src/modules/chat/services/chat.service');

function createServer() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use(errorHandler);
  return http.createServer(app);
}

function request({ method, path, accountId, body }) {
  const rawBody = body ? JSON.stringify(body) : null;
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const req = http.request({
        method,
        port: server.address().port,
        path,
        headers: {
          ...(accountId ? { 'X-Account-Id': accountId } : {}),
          ...(rawBody ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(rawBody) } : {}),
        },
      }, (res) => {
        let responseBody = '';
        res.on('data', (chunk) => { responseBody += chunk; });
        res.on('end', () => server.close(() => resolve({
          statusCode: res.statusCode,
          body: responseBody ? JSON.parse(responseBody) : null,
          headers: res.headers,
        })));
      });
      req.on('error', (error) => server.close(() => reject(error)));
      if (rawBody) req.write(rawBody);
      req.end();
    });
  });
}

describe('chat routes', () => {
  beforeEach(() => jest.clearAllMocks());

  test('conversation list requires authentication', async () => {
    const response = await request({ method: 'GET', path: '/conversations' });
    expect(response.statusCode).toBe(401);
    expect(service.listConversations).not.toHaveBeenCalled();
  });

  test('lists participants for authenticated chat users', async () => {
    const response = await request({
      method: 'GET',
      path: '/participants?search=a',
      accountId: '660000000000000000000002',
    });

    expect(response.statusCode).toBe(200);
    expect(response.body.data.items[0].email).toBe('a@lng.co');
    expect(service.listParticipants).toHaveBeenCalledWith(
      expect.objectContaining({ search: 'a' }),
      expect.objectContaining({ accountId: '660000000000000000000002' }),
      expect.any(Set),
    );
  });

  test('creates conversation and returns mounted API location', async () => {
    const response = await request({
      method: 'POST',
      path: '/conversations',
      accountId: '660000000000000000000002',
      body: { type: 'DIRECT', participantAccountIds: ['660000000000000000000003'] },
    });

    expect(response.statusCode).toBe(201);
    expect(response.headers.location).toBe('/api/chat/conversations/660000000000000000000001');
    expect(service.createConversation).toHaveBeenCalledWith(expect.objectContaining({ type: 'DIRECT' }), expect.objectContaining({
      accountId: '660000000000000000000002',
    }));
  });

  test('sends message through authenticated route', async () => {
    const response = await request({
      method: 'POST',
      path: '/conversations/660000000000000000000001/messages',
      accountId: '660000000000000000000002',
      body: { body: 'hello' },
    });

    expect(response.statusCode).toBe(201);
    expect(response.body.data).toEqual({ id: '660000000000000000000011', body: 'hello' });
    expect(service.sendMessage).toHaveBeenCalledWith(
      '660000000000000000000001',
      expect.objectContaining({ body: 'hello' }),
      expect.objectContaining({ accountId: '660000000000000000000002' }),
    );
  });
});
