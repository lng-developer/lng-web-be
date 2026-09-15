const mongoose = require('mongoose');
const Run = require('../../../src/modules/listingLaunch/models/listingContentRun.model');
const Version = require('../../../src/modules/listingLaunch/models/listingContentVersion.model');
const { runPayload, content, ids } = require('../helpers/contentFixtures');

test('strict run snapshot rejects extra fields, invalid status and oversized validation errors', async () => {
  const payload = runPayload(new mongoose.Types.ObjectId());
  await expect(new Run(payload).validate()).resolves.toBeUndefined();
  expect(() => new Run({ ...payload, secret: 'not allowed' })).toThrow();
  await expect(new Run({ ...payload, inputSnapshot: { ...payload.inputSnapshot, secret: 'not allowed' } }).validate()).rejects.toThrow();
  await expect(new Run({ ...payload, status: 'COMPLETED' }).validate()).rejects.toThrow();
  await expect(new Run({ ...payload, validationErrors: Array(21).fill({ field: 'title', code: 'LONG', message: 'Too long' }) }).validate()).rejects.toThrow();
});

test('versions validate source lineage and strict bounded content', async () => {
  const payload = { launchId: new mongoose.Types.ObjectId(), shopId: ids.shopId, version: 1, source: 'AI',
    runId: new mongoose.Types.ObjectId(), inputVersion: 1, inputHash: 'b'.repeat(64), profileVersion: 1,
    content, createdBy: ids.accountId };
  await expect(new Version(payload).validate()).resolves.toBeUndefined();
  await expect(new Version({ ...payload, runId: null }).validate()).rejects.toThrow();
  await expect(new Version({ ...payload, source: 'MANUAL', parentVersionId: new mongoose.Types.ObjectId() }).validate()).rejects.toThrow();
  await expect(new Version({ ...payload, content: { ...content, bullets: ['One'] } }).validate()).rejects.toThrow();
  await expect(new Version({ ...payload, content: { ...content, searchTerms: ['é'.repeat(125)] } }).validate()).rejects.toThrow();
  await expect(new Version({ ...payload, content: { ...content, description: 'not requested' } }).validate()).rejects.toThrow();
});
