// Local, disposable browser fixture. Never mount this file in the application server.
// Uses an ephemeral Mongo replica set and in-memory images; no external AI, Redis or cloud calls.
if (process.env.MOCKUP_PREVIEW_ENABLED !== 'true' || process.env.NODE_ENV === 'production') throw new Error('Set MOCKUP_PREVIEW_ENABLED=true in a local test shell');
const express = require('express');
const mongoose = require('mongoose');
const crypto = require('node:crypto');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const config = require('../../src/config');
const { content } = require('../listingLaunch/helpers/contentFixtures');
const assets = new Map();
const stub = (path, exports) => { require.cache[require.resolve(path)] = { id: require.resolve(path), filename: require.resolve(path), loaded: true, exports }; };
let identity;
stub('../../src/modules/auth/public', { ...require('../../src/modules/auth/middlewares/authorization'), authenticate(req, res, next) { req.auth = identity; next(); } });
stub('../../src/modules/media/public', {
  assertAuthenticatedCloudinaryReady() {},
  async storeAsset(input) {
    const chunks = []; for await (const chunk of input.stream) chunks.push(chunk);
    const buffer = Buffer.concat(chunks), _id = new mongoose.Types.ObjectId();
    const mediaAsset = { _id, provider: 'cloudinary', deliveryType: 'authenticated', uploadStatus: 'READY', mimeType: 'image/jpeg', ownerType: input.ownerType,
      ownerId: input.ownerId, shopId: input.shopId, metadata: input.metadata, size: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex') };
    assets.set(String(_id), { buffer, mediaAsset }); return mediaAsset;
  },
  async getAsset(id) { return assets.get(String(id))?.mediaAsset; },
  async readAuthenticatedAssetBuffer(id) { return assets.get(String(id)); },
  async discardUnattachedAsset(id) { assets.delete(String(id)); },
});
stub('../../src/modules/listingLaunch/adapters/openaiMockup.adapter', { async analyzeMockup() { return { result: { detectedText: 'TEST PREVIEW — seller must edit', theme: 'Cat accounting', designDescription: 'Fixture observation, not actual AI recognition', suggestedKeyword: 'Funny cat accountant', warnings: ['LOW_DETAIL'] } }; } });
stub('../../src/modules/listingLaunch/adapters/openaiContent.adapter', { async generateContent() { return { content }; } });
for (const [name, method, service, process] of [['listingMockup', 'enqueueAnalysis', 'listingMockupProcessing', 'processAnalysis'], ['listingContent', 'enqueueGeneration', 'listingContentGeneration', 'processGeneration']]) {
  stub(`../../src/modules/listingLaunch/queues/${name}.queue`, { async assertQueueReady() {}, async [method](id) {
    setTimeout(() => require(`../../src/modules/listingLaunch/services/${service}.service`)[process](id).catch(error => console.error('Fixture job failed', error.code)), 500);
  } });
}
global.fetch = async () => { throw new Error('External network is disabled in this fixture'); };
async function main() {
  const mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri(), { dbName: 'disposable_mockup_browser_test' });
  config.listingContent = { enabled: true, model: 'fixture', apiKey: 'fixture-not-a-key', timeoutMs: 90000 };
  config.listingMockupAnalysis = { enabled: true, model: 'fixture' };
  const shop = await require('../../src/modules/shop/models/shop.model').create({ name: 'Disposable test shop' });
  const group = await require('../../src/modules/catalog/models/productTypeGroup.model').create({ code: 'PREVIEW_TEE', name: 'Test T-shirt' });
  const template = await require('../../src/modules/catalog/models/internalTemplate.model').create({ code: 'PREVIEW_FRONT', name: 'Test front template', productTypeGroupId: group._id });
  identity = { accountId: new mongoose.Types.ObjectId().toString(), permissions: ['CATALOG:READ', 'CATALOG:WRITE'], roles: [], scopes: [{ scopeType: 'shop', scopeId: shop.id, permissions: ['CATALOG:READ', 'CATALOG:WRITE'], roles: [] }] };
  const session = { accessToken: 'local-fixture-not-a-token', tokenType: 'Bearer', account: { id: identity.accountId, email: 'preview@example.test', mustChangePassword: false }, roles: [], permissions: identity.permissions, scopes: identity.scopes, profileSetupRequired: false };
  const app = express();
  app.use((req, res, next) => { res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1:5280'); res.setHeader('Access-Control-Allow-Credentials', 'true'); res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type'); res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, OPTIONS'); if (req.method === 'OPTIONS') return res.sendStatus(204); next(); });
  app.use(express.json());
  app.post(['/api/auth/login', '/api/auth/refresh'], (req, res) => res.json({ success: true, data: session }));
  app.get('/api/auth/me', (req, res) => res.json({ success: true, data: session }));
  app.get('/api/catalog/listing-options', (req, res) => res.json({ success: true, data: { shops: [{ id: shop.id, name: shop.name, status: 'ACTIVE' }], productTypeGroups: [{ id: group.id, name: group.name, status: 'ACTIVE' }], internalTemplates: [{ id: template.id, name: template.name, status: 'ACTIVE', productTypeGroup: { id: group.id } }], salesChannels: [] } }));
  app.get('/api/media/assets/:id/download', (req, res) => { const asset = assets.get(req.params.id); if (!asset) return res.sendStatus(404); res.setHeader('Cache-Control', 'private, no-store'); res.type('jpeg').send(asset.buffer); });
  app.use('/api/listing-launches', require('../../src/modules/listingLaunch/routes'));
  app.use(require('../../src/middlewares/errorHandler'));
  await Promise.all(mongoose.modelNames().map(name => mongoose.model(name).init()));
  const server = app.listen(5281, '127.0.0.1', () => console.log('Disposable mockup fixture: http://127.0.0.1:5281; DB=disposable_mockup_browser_test; external services mocked'));
  const stop = async () => { server.close(); await mongoose.disconnect(); await mongo.stop(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}
main().catch(error => { console.error(error.name); process.exitCode = 1; });
