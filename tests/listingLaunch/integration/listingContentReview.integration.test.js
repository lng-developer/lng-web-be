const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const Shop = require('../../../src/modules/shop/models/shop.model');
const Group = require('../../../src/modules/catalog/models/productTypeGroup.model');
const Template = require('../../../src/modules/catalog/models/internalTemplate.model');
const Launch = require('../../../src/modules/listingLaunch/models/listingLaunch.model');
const Run = require('../../../src/modules/listingLaunch/models/listingContentRun.model');
const Version = require('../../../src/modules/listingLaunch/models/listingContentVersion.model');
const review = require('../../../src/modules/listingLaunch/services/listingContentReview.service');
const launchService = require('../../../src/modules/listingLaunch/services/listingLaunch.service');
const inputService = require('../../../src/modules/listingLaunch/services/listingContentInput.service');
const contentRepository = require('../../../src/modules/listingLaunch/repositories/listingContent.repository');
const launchRepository = require('../../../src/modules/listingLaunch/repositories/listingLaunch.repository');
const { inputs, content, runPayload } = require('../helpers/contentFixtures');

jest.setTimeout(30000);
let mongo;
let launch;
let version;
let run;
let group;
let template;
let shop;
let auth;
const approve = (versionId = version.id, expectedInputVersion = 2, selectedColorCodes = ['BLACK']) =>
  review.approveContent(launch.id, versionId, { expectedInputVersion, selectedColorCodes }, auth);

beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongo.getUri(), { dbName: 'listing_content_review_test' });
  await Promise.all([Launch.init(), Run.init(), Version.init()]);
}, 60000);
afterAll(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); }, 60000);
afterEach(() => jest.restoreAllMocks());
beforeEach(async () => {
  await Promise.all([Shop, Group, Template, Launch, Run, Version].map((model) => model.deleteMany({})));
  shop = await Shop.create({ name: 'Review pilot' });
  group = await Group.create({ code: 'REVIEW_TEE', name: 'T-shirt' });
  template = await Template.create({ code: 'REVIEW_FRONT', name: 'Front', productTypeGroupId: group.id });
  auth = { accountId: new mongoose.Types.ObjectId().toString(), scopes: [{ scopeType: 'shop', scopeId: shop.id, permissions: ['CATALOG:WRITE'] }] };
  launch = await launchService.createListingLaunch({ shopId: shop.id, marketplaceCode: 'AMAZON_US', brief: 'Cat shirt' }, auth);
  await launchService.selectProduct(launch.id, { productTypeGroupId: group.id, internalTemplateId: template.id }, auth);
  const { confirmedBy, confirmedAt, ...payload } = inputs;
  launch = await inputService.saveContentInputs(launch.id, { ...payload, expectedInputVersion: 1,
    availableColors: ['BLACK', 'WHITE', 'NAVY', 'RED'].map((code) => ({ code, label: code })) }, auth);
  const snapshot = inputService.buildContentSnapshot(launch, { productTypeGroup: group, internalTemplate: template });
  run = await Run.create(runPayload(launch.id, { shopId: shop.id, requestedBy: auth.accountId,
    inputVersion: 2, inputHash: inputService.hashContentSnapshot(snapshot), inputSnapshot: snapshot }));
  await contentRepository.completeGeneration(await contentRepository.claimGeneration(run.id), { content });
  version = await Version.findById(run.resultVersionId).lean();
  version.id = String(version._id);
});

test('manual edits preserve original output and approval, inherit fingerprint and allocate unique monotonic numbers concurrently', async () => {
  await approve();
  const original = await Version.findById(version.id).lean();
  const revisions = await Promise.all(Array.from({ length: 4 }, (_, i) => review.createContentRevision(
    launch.id, version.id, { ...content, title: `Seller title ${i}` }, auth)));
  expect(revisions.map((item) => item.version).sort()).toEqual([2, 3, 4, 5]);
  expect(new Set(revisions.map((item) => item.id)).size).toBe(4);
  expect(revisions[0]).toMatchObject({ source: 'MANUAL', parentVersionId: version.id, runId: null,
    inputVersion: 2, inputHash: version.inputHash, profileVersion: 1, createdBy: auth.accountId, isStale: false });
  expect(await Version.findById(version.id).lean()).toEqual(original);
  expect((await launchService.getListingLaunch(launch.id, auth)).approvedContent.versionId).toBe(version.id);
  const page = await review.listContentVersions(launch.id, { page: 2, limit: 2 }, auth);
  expect(page).toMatchObject({ total: 5, page: 2, limit: 2 });
  expect(page.items.map((item) => item.version)).toEqual([3, 2]);
  expect(JSON.stringify(page)).not.toContain('inputSnapshot');
  expect((await Launch.findById(launch.id).lean()).contentVersionCounter).toBe(5);
});

test.each([
  { ...content, bullets: ['Only one'] },
  { ...content, title: 'x'.repeat(201) },
  { ...content, searchTerms: ['é'.repeat(125)] },
  { ...content, recommendedColors: [{ code: 'black', reason: 'Unnormalized' }] },
  { ...content, recommendedColors: [{ code: 'PURPLE', reason: 'Unavailable' }] },
])('invalid manual content fails without creating a version or consuming a number', async (invalid) => {
  await expect(review.createContentRevision(launch.id, version.id, invalid, auth)).rejects.toMatchObject({
    statusCode: 400, code: 'CONTENT_VALIDATION_FAILED', details: { fieldErrors: expect.any(Array) },
  });
  expect(await Version.countDocuments()).toBe(1);
  expect((await Launch.findById(launch.id).lean()).contentVersionCounter).toBe(1);
});

test('approval allows four available colors, switches explicitly, and generation leaves its pointer unchanged', async () => {
  const approved = await approve(version.id, 2, ['BLACK', 'WHITE', 'NAVY', 'RED']);
  expect(approved).toMatchObject({ approvedContentUsable: true, approvedContent: {
    versionId: version.id, approvedBy: auth.accountId, selectedColorCodes: ['BLACK', 'WHITE', 'NAVY', 'RED'],
  } });
  const revision = await review.createContentRevision(launch.id, version.id, { ...content, title: 'Revised' }, auth);
  await approve(revision.id);
  const next = await Run.create(runPayload(launch.id, { ...run.toObject(), _id: new mongoose.Types.ObjectId(),
    requestKey: '22222222-2222-4222-8222-222222222222', resultVersionId: new mongoose.Types.ObjectId(), status: 'QUEUED' }));
  await contentRepository.completeGeneration(await contentRepository.claimGeneration(next.id), { content });
  const detail = await launchService.getListingLaunch(launch.id, auth);
  expect(detail).toMatchObject({ approvedContentUsable: true, approvedContent: { versionId: revision.id }, latestRun: { id: next.id, status: 'SUCCEEDED' } });
  expect(detail.latestRun).not.toHaveProperty('inputSnapshot');
  expect((await Version.findById(version.id).lean()).content.title).toBe('Cat accountant cotton shirt');
});

test.each([[], ['BLACK', 'BLACK'], ['PURPLE'], ['black'], Array(31).fill('BLACK')].map((colors) => [colors]))('approval rejects invalid color selection', async (colors) => {
  await expect(approve(version.id, 2, colors)).rejects.toMatchObject({ statusCode: 400 });
  expect((await Launch.findById(launch.id).lean()).approvedContent).toBeNull();
});

test('input edits clear approval and stale revisions retain historical colors even after descendant edits', async () => {
  await approve();
  const { confirmedBy, confirmedAt, ...payload } = inputs;
  await inputService.saveContentInputs(launch.id, { ...payload, expectedInputVersion: 2,
    availableColors: [{ code: 'GREEN', label: 'Green' }] }, auth);
  expect((await launchService.getListingLaunch(launch.id, auth)).approvedContent).toBeNull();
  const revised = await review.createContentRevision(launch.id, version.id, content, auth);
  const descendant = await review.createContentRevision(launch.id, revised.id, content, auth);
  expect(descendant).toMatchObject({ inputVersion: 2, inputHash: version.inputHash, isStale: true });
  await expect(approve(descendant.id, 3, ['GREEN'])).rejects.toMatchObject({ statusCode: 409 });
  const history = await review.listContentVersions(launch.id, {}, auth);
  expect(history.items.every((item) => item.isStale)).toBe(true);
  expect(history.items.find((item) => item.id === version.id).content).toEqual(content);
});

test('Catalog metadata changes preserve historical pointer but make approval unusable and revisions stale', async () => {
  await approve();
  await Group.updateOne({ _id: group.id }, { $set: { name: 'Changed metadata' } });
  const detail = await launchService.getListingLaunch(launch.id, auth);
  expect(detail).toMatchObject({ isStale: true, approvedContentUsable: false, approvedContent: { versionId: version.id } });
  await expect(approve()).rejects.toMatchObject({ statusCode: 409 });
  expect((await review.createContentRevision(launch.id, version.id, content, auth)).isStale).toBe(true);
});

test.each(['shop', 'group', 'template'])('inactive %s keeps historical detail readable but rejects approval', async (target) => {
  await approve();
  const model = { shop: Shop, group: Group, template: Template }[target];
  const record = { shop, group, template }[target];
  await model.updateOne({ _id: record.id }, { $set: { status: 'INACTIVE' } });
  expect(await launchService.getListingLaunch(launch.id, auth)).toMatchObject({ approvedContentUsable: false, isStale: true });
  expect((await review.listContentVersions(launch.id, {}, auth)).items[0]).toMatchObject({ id: version.id, isStale: true });
  await expect(approve()).rejects.toMatchObject({ statusCode: 409 });
});

test('approve racing input save cannot leave an old approved pointer after save succeeds', async () => {
  const { confirmedBy, confirmedAt, ...payload } = inputs;
  const results = await Promise.allSettled([
    approve(), inputService.saveContentInputs(launch.id, { ...payload, keyword: 'Changed', expectedInputVersion: 2 }, auth),
  ]);
  expect(results[1].status).toBe('fulfilled');
  if (results[0].status === 'rejected') expect(results[0].reason.statusCode).toBe(409);
  const stored = await Launch.findById(launch.id).lean();
  expect(stored).toMatchObject({ contentInputVersion: 3, approvedContent: null });
  await expect(approve(version.id, 3)).rejects.toMatchObject({ statusCode: 409 });
});

test('input save committed between approval read and write causes transaction retry and stale rejection', async () => {
  let reachedWrite;
  let release;
  const waiting = new Promise((resolve) => { reachedWrite = resolve; });
  const resume = new Promise((resolve) => { release = resolve; });
  const original = launchRepository.approveContent;
  jest.spyOn(launchRepository, 'approveContent').mockImplementationOnce(async (...args) => {
    reachedWrite();
    await resume;
    return original(...args);
  });
  const outcome = approve().then((value) => ({ value }), (error) => ({ error }));
  await waiting;
  try {
    const { confirmedBy, confirmedAt, ...payload } = inputs;
    await inputService.saveContentInputs(launch.id, { ...payload, keyword: 'Changed mid-approval', expectedInputVersion: 2 }, auth);
  } finally { release(); }
  expect((await outcome).error).toMatchObject({ statusCode: 409 });
  expect(await Launch.findById(launch.id).lean()).toMatchObject({ contentInputVersion: 3, approvedContent: null });
});

test('version child belongs to exact launch and revisions/approvals require current exact-shop WRITE', async () => {
  const other = await launchService.createListingLaunch({ shopId: shop.id, marketplaceCode: 'AMAZON_US', brief: 'Other' }, auth);
  for (const call of [
    () => review.createContentRevision(other.id, version.id, content, auth),
    () => review.approveContent(other.id, version.id, { expectedInputVersion: 0, selectedColorCodes: ['BLACK'] }, auth),
  ]) await expect(call()).rejects.toMatchObject({ statusCode: 404 });
  for (const scope of [
    { scopeId: shop.id, permissions: ['CATALOG:READ'] },
    { scopeId: new mongoose.Types.ObjectId().toString(), permissions: ['CATALOG:WRITE'] },
    { scopeId: shop.id, permissions: ['CATALOG:WRITE'], validUntil: '2020-01-01' },
  ]) {
    const denied = { accountId: auth.accountId, scopes: [{ scopeType: 'shop', ...scope }] };
    await expect(review.createContentRevision(launch.id, version.id, content, denied)).rejects.toMatchObject({ statusCode: 403 });
    await expect(review.approveContent(launch.id, version.id, { expectedInputVersion: 2, selectedColorCodes: ['BLACK'] }, denied)).rejects.toMatchObject({ statusCode: 403 });
  }
  const reader = { scopes: [{ scopeType: 'shop', scopeId: shop.id, permissions: ['CATALOG:READ'] }] };
  expect((await review.listContentVersions(launch.id, {}, reader)).total).toBe(1);
});
