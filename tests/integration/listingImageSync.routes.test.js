const express = require('express');
const request = require('supertest');
const auth = require('../../src/modules/auth/public');
const service = require('../../src/modules/integration/listingImageSync/public');
const shopId = '507f1f77bcf86cd799439011';
const commandId = '507f1f77bcf86cd799439012';
const itemId = '507f1f77bcf86cd799439013';
let context = {};
jest.spyOn(auth, 'authenticate').mockImplementation((req, res, next) => { req.auth = context; next(); });
const app = express();
app.use(express.json());
app.use('/sync', require('../../src/modules/integration/listingImageSync/routes/listingImageSync.routes'));
app.use((error, req, res, next) => res.status(error.statusCode || 500).json({ message: error.message }));
afterEach(() => { jest.restoreAllMocks(); });

test('management mutations require Catalog permission; legacy extension tokens cannot use management routes', async () => {
  context = { permissions: ['ORDERS:WRITE', 'FINANCE:WRITE'] };
  expect((await request(app).post('/sync/jobs').send({ shopId, agentId: commandId })).status).toBe(403);
  context = { tokenType: 'EXTENSION', scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['ORDERS:WRITE'] }] };
  expect((await request(app).post('/sync/jobs').send({ shopId, agentId: commandId })).status).toBe(403);
});
test('item query takes lease only in POST JSON; malformed IDs and missing credentials fail before service', async () => {
  context = { tokenType: 'EXTENSION' };
  const invoke = jest.spyOn(service, 'getCommandItems').mockResolvedValue({ jobId: shopId, status: 'RUNNING', items: [] });
  expect((await request(app).post(`/sync/agent/commands/${commandId}/items/query`).send({ clientId: 'test', leaseToken: 'a'.repeat(48) })).status).toBe(200);
  expect((await request(app).post(`/sync/agent/commands/${commandId}/items/query`).query({ clientId: 'test', leaseToken: 'a'.repeat(48) }).send({})).status).toBe(400);
  expect((await request(app).post('/sync/agent/commands/bad/items/query').send({ clientId: 'test', leaseToken: 'a'.repeat(48) })).status).toBe(400);
  expect(invoke).toHaveBeenCalledTimes(1);
});
test('multipart accepts only named file, applies 10 MiB cap and preserves lease/body fields', async () => {
  context = { tokenType: 'EXTENSION' };
  const invoke = jest.spyOn(service, 'recordResult').mockResolvedValue({ status: 'SUCCEEDED' });
  const submit = (field, bytes) => request(app).post(`/sync/agent/commands/${commandId}/items/${itemId}/result`)
    .field('clientId', 'test').field('leaseToken', 'a'.repeat(48)).field('asin', 'B000000001').field('sourceUrl', 'https://m.media-amazon.com/images/I/test.png').attach(field, bytes, 'test.png');
  expect((await submit('file', Buffer.from('png'))).status).toBe(200);
  expect(invoke.mock.calls[0][2]).toMatchObject({ clientId: 'test', asin: 'B000000001', leaseToken: 'a'.repeat(48) });
  expect((await submit('image', Buffer.from('png'))).status).toBe(400);
  expect((await submit('file', Buffer.alloc(10 * 1024 * 1024 + 1))).status).toBe(400);
  expect(invoke).toHaveBeenCalledTimes(1);
});
