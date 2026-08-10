const http = require('http');
const express = require('express');
const errorHandler = require('../../../src/middlewares/errorHandler');

const mockItems = [
  { id: '507f1f77bcf86cd799439011', recipientAccountId: 'a1', title: 'Private', readAt: null },
  { id: '507f1f77bcf86cd799439012', recipientAccountId: 'a2', title: 'Other', readAt: null },
];

jest.mock('../../../src/modules/auth/public', () => ({
  authenticate(req, _res, next) {
    const AuthError = require('../../../src/shared/errors/appError');
    const codes = require('../../../src/shared/constants/errorCodes');
    const accountId = req.get('x-account-id');
    if (!accountId) {
      next(new AuthError('Authentication required', 401, true, codes.AUTHENTICATION_ERROR));
      return;
    }
    req.auth = { accountId };
    next();
  },
}));

jest.mock('../../../src/modules/notification/services/notification.service', () => ({
  async listInbox(accountId) {
    return {
      items: mockItems.filter((item) => item.recipientAccountId === accountId),
      pagination: { page: 1, limit: 20, total: 1 },
    };
  },
  async getUnreadCount(accountId) {
    return { unreadCount: mockItems.filter((item) => item.recipientAccountId === accountId && item.readAt === null).length };
  },
  async markRead(id, accountId) {
    const NotFoundError = require('../../../src/shared/errors/appError');
    const codes = require('../../../src/shared/constants/errorCodes');
    const item = mockItems.find((candidate) => candidate.id === id && candidate.recipientAccountId === accountId);
    if (!item) throw new NotFoundError('Notification not found', 404, true, codes.RESOURCE_NOT_FOUND);
    item.readAt = new Date('2026-07-27T10:00:00.000Z');
    return item;
  },
  async markAllRead(accountId) {
    let updatedCount = 0;
    mockItems.forEach((item) => {
      if (item.recipientAccountId === accountId && item.readAt === null) {
        item.readAt = new Date('2026-07-27T10:00:00.000Z');
        updatedCount += 1;
      }
    });
    return { updatedCount };
  },
}));

const router = require('../../../src/modules/notification/routes');

function createServer() {
  const app = express();
  app.use(express.json());
  app.use(router);
  app.use(errorHandler);
  return http.createServer(app);
}

function request({ method, path, accountId }) {
  const server = createServer();
  return new Promise((resolve, reject) => {
    server.listen(0, () => {
      const req = http.request({
        method,
        port: server.address().port,
        path,
        headers: accountId ? { 'X-Account-Id': accountId } : {},
      }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => server.close(() => resolve({
          statusCode: res.statusCode,
          body: body ? JSON.parse(body) : null,
        })));
      });
      req.on('error', (error) => server.close(() => reject(error)));
      req.end();
    });
  });
}

describe('notification routes', () => {
  beforeEach(() => {
    mockItems.forEach((item) => { item.readAt = null; });
  });

  test('inbox list requires authentication', async () => {
    const response = await request({ method: 'GET', path: '/' });
    expect(response.statusCode).toBe(401);
  });

  test('cross-account mark-read is denied without changing the owner inbox', async () => {
    const denied = await request({
      method: 'PATCH',
      path: '/507f1f77bcf86cd799439011/read',
      accountId: 'a2',
    });
    const ownerInbox = await request({ method: 'GET', path: '/', accountId: 'a1' });

    expect(denied.statusCode).toBe(404);
    expect(ownerInbox.body.data.items).toEqual([
      expect.objectContaining({ id: '507f1f77bcf86cd799439011', readAt: null }),
    ]);
  });

  test('owner can read one item and then mark the remaining inbox read', async () => {
    const marked = await request({
      method: 'PATCH',
      path: '/507f1f77bcf86cd799439011/read',
      accountId: 'a1',
    });
    const allRead = await request({ method: 'PATCH', path: '/read-all', accountId: 'a2' });
    const unread = await request({ method: 'GET', path: '/unread-count', accountId: 'a2' });

    expect(marked.statusCode).toBe(200);
    expect(marked.body.data.readAt).toBe('2026-07-27T10:00:00.000Z');
    expect(allRead.body.data).toEqual({ updatedCount: 1 });
    expect(unread.body.data).toEqual({ unreadCount: 0 });
  });

  test('malformed notification ids are rejected before the service', async () => {
    const response = await request({ method: 'PATCH', path: '/not-an-id/read', accountId: 'a1' });
    expect(response.statusCode).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
});
