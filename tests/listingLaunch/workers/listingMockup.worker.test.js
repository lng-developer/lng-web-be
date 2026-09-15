jest.mock('../../../src/modules/media/public', () => ({ readAuthenticatedAssetBuffer: jest.fn() }));
jest.mock('../../../src/modules/listingLaunch/adapters/openaiMockup.adapter', () => ({ analyzeMockup: jest.fn() }));
jest.mock('../../../src/modules/listingLaunch/queues/listingMockup.queue', () => ({ assertQueueReady: jest.fn(), enqueueAnalysis: jest.fn() }), { virtual: true });
const mongoose = require('mongoose');
const crypto = require('node:crypto');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Launch = require('../../../src/modules/listingLaunch/models/listingLaunch.model');
const Run = require('../../../src/modules/listingLaunch/models/listingMockupAnalysisRun.model');
const media = require('../../../src/modules/media/public');
const adapter = require('../../../src/modules/listingLaunch/adapters/openaiMockup.adapter');
const { launchPayload } = require('../helpers/contentFixtures');
const result = { detectedText: '', theme: '', designDescription: 'Cat', suggestedKeyword: 'Cat accountant', warnings: [] };
jest.setTimeout(30000);
let mongo;
beforeAll(async () => { mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } }); await mongoose.connect(mongo.getUri()); await Run.init(); }, 60000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); }, 60000);
test('duplicate delivery calls AI once; invalid bytes fail before paid call', async () => {
  const { processAnalysis } = require('../../../src/modules/listingLaunch/services/listingMockupProcessing.service');
  const launch = await Launch.create(launchPayload());
  const buffer = Buffer.from('normalized image');
  const assetId = new mongoose.Types.ObjectId();
  const assetHash = crypto.createHash('sha256').update(buffer).digest('hex');
  const payload = { launchId: launch._id, shopId: launch.shopId, requestedBy: new mongoose.Types.ObjectId(), assetId, assetHash,
    mockupRevision: 1, requestKey: crypto.randomUUID(), requestHash: 'a'.repeat(64), model: 'test', provider: 'OPENAI', promptVersion: 1 };
  const run = await Run.create(payload);
  media.readAuthenticatedAssetBuffer.mockResolvedValue({ buffer, mediaAsset: { _id: assetId, shopId: launch.shopId, ownerId: launch._id, ownerType: 'LISTING_LAUNCH',
    provider: 'cloudinary', deliveryType: 'authenticated', uploadStatus: 'READY', sha256: assetHash, mimeType: 'image/jpeg' } });
  adapter.analyzeMockup.mockResolvedValue({ result });
  await Promise.all([processAnalysis(String(run._id)), processAnalysis(String(run._id))]);
  expect(adapter.analyzeMockup).toHaveBeenCalledTimes(1);
  expect(await Run.findById(run._id).lean()).toMatchObject({ status: 'SUCCEEDED', result });
  const bad = await Run.create({ ...payload, requestKey: crypto.randomUUID(), assetHash: 'c'.repeat(64) });
  await expect(processAnalysis(String(bad._id))).rejects.toMatchObject({ code: 'MOCKUP_ASSET_CHANGED' });
  expect(adapter.analyzeMockup).toHaveBeenCalledTimes(1);
  expect(await Run.findById(bad._id).lean()).toMatchObject({ status: 'FAILED', result: null });
});
