const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Launch = require('../../../src/modules/listingLaunch/models/listingLaunch.model');
const Run = require('../../../src/modules/listingLaunch/models/listingContentRun.model');
const Version = require('../../../src/modules/listingLaunch/models/listingContentVersion.model');
const repository = require('../../../src/modules/listingLaunch/repositories/listingContent.repository');
const launchRepository = require('../../../src/modules/listingLaunch/repositories/listingLaunch.repository');
const { launchPayload, runPayload, content, ids } = require('../helpers/contentFixtures');
jest.setTimeout(30000);
let mongo;
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri(), { dbName: 'listing_content_repository_test' });
  await Promise.all([Launch.init(), Run.init(), Version.init()]);
}, 60000);
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); }, 60000);
beforeEach(async () => { await Promise.all([Launch.deleteMany({}), Run.deleteMany({}), Version.deleteMany({})]); });

test('different request keys racing on one launch reserve one active run', async () => {
  const launch = await Launch.create(launchPayload());
  const result = await Promise.allSettled([
    repository.reserveGeneration(runPayload(launch._id)),
    repository.reserveGeneration(runPayload(launch._id, { requestKey: '22222222-2222-4222-8222-222222222222' })),
  ]);
  expect(result.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
  expect(result.find(({ status }) => status === 'rejected').reason.statusCode).toBe(409);
  expect(await Run.countDocuments({})).toBe(1);
});

test('reservation initializes legacy counters without allocating a completed version', async () => {
  const launch = await Launch.create(launchPayload());
  await Launch.collection.updateOne({ _id: launch._id }, { $unset: { contentInputVersion: '', contentVersionCounter: '' } });
  const { run } = await repository.reserveGeneration(runPayload(launch._id, { inputVersion: 0 }));
  const stored = await Launch.findById(launch._id).lean();
  expect(stored.contentInputVersion).toBe(0);
  expect(stored.contentVersionCounter).toBe(0);
  expect(run.resultVersionId).toBeTruthy();
  expect(await Version.countDocuments({})).toBe(0);
});

test('reservation rechecks freshness inside the transaction and rolls back failed inserts', async () => {
  const launch = await Launch.create(launchPayload());
  await launchRepository.update(launch._id, { brief: 'New brief' }, { invalidateContent: true });
  await expect(repository.reserveGeneration(runPayload(launch._id))).rejects.toMatchObject({ statusCode: 409 });
  expect(await Run.countDocuments({})).toBe(0);
  await Launch.collection.updateOne({ _id: launch._id }, { $unset: { contentVersionCounter: '' } });
  await expect(repository.reserveGeneration(runPayload(launch._id, { inputVersion: 2, model: '' }))).rejects.toThrow();
  expect((await Launch.findById(launch._id).lean()).contentVersionCounter).toBeUndefined();
  expect(await Run.countDocuments({})).toBe(0);
});

test('an input edit racing reservation either wins first or leaves an explicitly historical snapshot', async () => {
  const launch = await Launch.create(launchPayload());
  const [reserved, edited] = await Promise.allSettled([
    repository.reserveGeneration(runPayload(launch._id)),
    launchRepository.update(launch._id, { brief: 'New brief' }, { invalidateContent: true }),
  ]);
  expect(edited.status).toBe('fulfilled');
  expect((await Launch.findById(launch._id).lean()).contentInputVersion).toBe(2);
  if (reserved.status === 'fulfilled') {
    expect(reserved.value.run.inputVersion).toBe(1);
    expect(reserved.value.run.inputSnapshot.brief).toBe('Cat shirt');
  } else {
    expect(reserved.reason.statusCode).toBe(409);
    expect(await Run.countDocuments({})).toBe(0);
  }
});

test('run and result uniqueness indexes prevent duplicate requests and AI versions', async () => {
  const launch = await Launch.create(launchPayload());
  const { run } = await repository.reserveGeneration(runPayload(launch._id));
  await expect(Run.create(runPayload(launch._id))).rejects.toMatchObject({ code: 11000 });
  const payload = { launchId: launch._id, shopId: ids.shopId, version: 1, source: 'AI', runId: run._id,
    inputVersion: 1, inputHash: 'b'.repeat(64), profileVersion: 1, content, createdBy: ids.accountId };
  await Version.create(payload);
  await expect(Version.create({ ...payload, version: 2 })).rejects.toMatchObject({ code: 11000 });
  await expect(Version.create({ ...payload, runId: new mongoose.Types.ObjectId() })).rejects.toMatchObject({ code: 11000 });
  expect(await Version.countDocuments({})).toBe(1);
});

test('persisted snapshots and result content cannot be changed through document or query writes', async () => {
  const launch = await Launch.create(launchPayload());
  const { run } = await repository.reserveGeneration(runPayload(launch._id));
  const version = await Version.create({ launchId: launch._id, shopId: ids.shopId, version: 1, source: 'AI',
    runId: run._id, inputVersion: 1, inputHash: 'b'.repeat(64), profileVersion: 1, content, createdBy: ids.accountId });
  await Run.updateOne({ _id: run._id }, { $set: { 'inputSnapshot.keyword': 'Changed', 'inputSnapshot.availableColors.0.code': 'NAVY' } });
  expect((await Run.findById(run._id).lean()).inputSnapshot).toMatchObject({ keyword: 'Cat accountant', availableColors: [{ code: 'BLACK' }] });
  await Version.updateOne({ _id: version._id }, { $set: { 'content.title': 'Changed' } });
  await Version.updateOne({ _id: version._id }, { $push: { 'content.bullets': 'Extra' } });
  expect((await Version.findById(version._id).lean()).content.bullets).toHaveLength(5);
  version.content.title = 'Changed';
  await expect(version.save()).rejects.toThrow('immutable');
  expect((await Version.findById(version._id).lean()).content.title).toBe('Cat accountant cotton shirt');
});
