const request = require('supertest');
const express = require('express');
jest.mock('../../../src/modules/listingLaunch/services/listingLaunch.service');
jest.mock('../../../src/modules/listingLaunch/services/listingContentInput.service');
jest.mock('../../../src/modules/listingLaunch/services/listingContent.service');
jest.mock('../../../src/modules/listingLaunch/services/listingContentReview.service');
jest.mock('../../../src/modules/auth/public', () => ({
  ...jest.requireActual('../../../src/modules/auth/middlewares/authorization'),
  authenticate(req, res, next) {
    if (!req.headers['x-auth-context']) return res.status(401).json({ success: false });
    req.auth = JSON.parse(req.headers['x-auth-context']);
    return next();
  },
}));
const service = require('../../../src/modules/listingLaunch/services/listingLaunch.service');
const contentInputService = require('../../../src/modules/listingLaunch/services/listingContentInput.service');
const contentService = require('../../../src/modules/listingLaunch/services/listingContent.service');
const reviewService = require('../../../src/modules/listingLaunch/services/listingContentReview.service');
const { content } = require('../helpers/contentFixtures');
const router = require('../../../src/modules/listingLaunch/routes');
const errorHandler = require('../../../src/middlewares/errorHandler');
const app = express();
app.use(express.json());
app.use('/api/listing-launches', router);
app.use(errorHandler);
const id = '660000000000000000000001';
const auth = { accountId: id, scopes: [{ scopeType: 'shop', scopeId: id, permissions: ['CATALOG:WRITE'] }] };
const headers = { 'x-auth-context': JSON.stringify(auth) };
const base = '/api/listing-launches';
const createPayload = { shopId: id, marketplaceCode: 'amazon_us', brief: 'Floral tee' };
const contentInputPayload = {
  expectedInputVersion: 0,
  profileCode: 'AMAZON_US_APPAREL_CONTENT_V1',
  keyword: '  Funny Cat Accountant  ',
  language: 'en-US',
  productFacts: {
    brand: 'LNG Studio',
    productName: 'Accountant Cat Shirt',
    material: '100% cotton',
    features: ['Crew neck'],
  },
  availableColors: [{ code: ' black ', label: ' Black ' }],
  factsConfirmed: true,
};
beforeEach(() => {
  jest.clearAllMocks();
  service.createListingLaunch.mockResolvedValue({ id, state: 'BRIEF', salesChannelCode: 'AMAZON' });
  service.getListingLaunch.mockResolvedValue({ id });
  service.listListingLaunches.mockResolvedValue({ items: [], total: 0, page: 1, limit: 20 });
  service.updateListingLaunch.mockResolvedValue({ id });
  service.selectProduct.mockResolvedValue({ id, state: 'PRODUCT_SELECTED' });
  contentInputService.saveContentInputs.mockResolvedValue({ id, contentInputVersion: 1 });
  contentService.requestGeneration.mockResolvedValue({ run: { id, status: 'QUEUED' }, replayed: false });
  contentService.getGeneration.mockResolvedValue({ id, status: 'QUEUED' });
});

test('review endpoints validate complete content, expected version and pagination, and enforce WRITE', async () => {
  reviewService.createContentRevision.mockResolvedValue({ id, source: 'MANUAL' });
  reviewService.approveContent.mockResolvedValue({ approvedContentUsable: true });
  reviewService.listContentVersions.mockResolvedValue({ items: [], page: 1, limit: 20, total: 0 });
  const revisions = `${base}/${id}/content-versions/${id}/revisions`;
  const approve = `${base}/${id}/content-versions/${id}/approve`;
  const versions = `${base}/${id}/content-versions`;
  await request(app).post(revisions).set(headers).send(content).expect(201);
  expect(reviewService.createContentRevision).toHaveBeenCalledWith(id, id, content, auth);
  const command = { expectedInputVersion: 1, selectedColorCodes: ['BLACK', 'NAVY', 'WHITE', 'RED'] };
  await request(app).post(approve).set(headers).send(command).expect(200);
  expect(reviewService.approveContent).toHaveBeenCalledWith(id, id, command, auth);
  await request(app).get(`${versions}?page=2&limit=100`).set(headers).expect(200);
  expect(reviewService.listContentVersions).toHaveBeenCalledWith(id, { page: 2, limit: 100 }, auth);
  for (const [method, path] of [['get', versions], ['post', revisions], ['post', approve]]) {
    await request(app)[method](path).expect(401);
  }
  const readHeaders = { 'x-auth-context': JSON.stringify({ scopes: [{ scopeType: 'shop', scopeId: id, permissions: ['CATALOG:READ'] }] }) };
  await request(app).get(versions).set(readHeaders).expect(200);
  await request(app).post(revisions).set(readHeaders).send(content).expect(403);
  await request(app).post(approve).set(readHeaders).send(command).expect(403);
});

test('review rejects missing bodies, unknown overrides, malformed child ids, and invalid nested content', async () => {
  const revisions = `${base}/${id}/content-versions/${id}/revisions`;
  const approve = `${base}/${id}/content-versions/${id}/approve`;
  for (const payload of [undefined, {}, { ...content, createdBy: id }, { ...content, inputHash: 'x' },
    { ...content, bullets: [null, ...content.bullets.slice(1)] }, { ...content, title: ' ' },
    { ...content, recommendedColors: [null] }, { ...content, recommendedColors: [{ code: 'BLACK', reason: 'ok', actor: id }] }]) {
    await request(app).post(revisions).set(headers).send(payload).expect(400);
  }
  for (const payload of [undefined, {}, { selectedColorCodes: ['BLACK'] },
    { expectedInputVersion: 1, selectedColorCodes: ['BLACK'], approvedBy: id },
    { expectedInputVersion: 1, selectedColorCodes: [] }, { expectedInputVersion: 1, selectedColorCodes: ['BLACK', 'BLACK'] },
    { expectedInputVersion: 1, selectedColorCodes: [null] }, { expectedInputVersion: 1, selectedColorCodes: ['black'] },
    { expectedInputVersion: 1, selectedColorCodes: Array.from({ length: 31 }, (_, i) => `C${i}`) }]) {
    await request(app).post(approve).set(headers).send(payload).expect(400);
  }
  await request(app).post(`${base}/${id}/content-versions/bad/revisions`).set(headers).send(content).expect(400);
  await request(app).get(`${base}/${id}/content-versions?limit=101`).set(headers).expect(400);
  await request(app).get(`${base}/${id}/content-versions?shopId=${id}`).set(headers).expect(400);
  expect(reviewService.createContentRevision).not.toHaveBeenCalled();
  expect(reviewService.approveContent).not.toHaveBeenCalled();
});

test('generation accepts a validated command, polls, and returns 200 only for terminal replays', async () => {
  const command = { requestKey: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA', expectedInputVersion: 1 };
  const response = await request(app).post(`${base}/${id}/content-generations`).set(headers).send(command).expect(202);
  expect(response.body.data).toEqual({ id, status: 'QUEUED' });
  expect(contentService.requestGeneration).toHaveBeenCalledWith(id, { ...command, requestKey: command.requestKey.toLowerCase() }, auth);
  await request(app).get(`${base}/${id}/content-generations/${id}`).set(headers).expect(200);
  expect(contentService.getGeneration).toHaveBeenCalledWith(id, id, auth);
  contentService.requestGeneration.mockResolvedValueOnce({ run: { id, status: 'RUNNING' }, replayed: true });
  await request(app).post(`${base}/${id}/content-generations`).set(headers).send(command).expect(202);
  for (const status of ['SUCCEEDED', 'FAILED']) {
    contentService.requestGeneration.mockResolvedValueOnce({ run: { id, status }, replayed: true });
    await request(app).post(`${base}/${id}/content-generations`).set(headers).send(command).expect(200);
  }
});

test('generation response exposes durable dispatch warning', async () => {
  contentService.requestGeneration.mockResolvedValueOnce({ run: { id, status: 'QUEUED' }, replayed: false,
    dispatchWarning: 'Content generation is queued; dispatch will be retried' });
  const response = await request(app).post(`${base}/${id}/content-generations`).set(headers)
    .send({ requestKey: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', expectedInputVersion: 1 }).expect(202);
  expect(response.body.dispatchWarning).toBe('Content generation is queued; dispatch will be retried');
});

test('generation rejects missing commands, malformed ids, invalid versions, and client overrides', async () => {
  const command = { requestKey: '11111111-1111-4111-8111-111111111111', expectedInputVersion: 1 };
  await request(app).post(`${base}/${id}/content-generations`).set(headers).expect(400);
  for (const payload of [{}, { ...command, requestKey: 'bad' }, { ...command, expectedInputVersion: -1 },
    { ...command, requestKey: '11111111111141118111111111111111' },
    { ...command, requestKey: '{11111111-1111-4111-8111-111111111111}' },
    { ...command, requestKey: '11111111:1111:4111:8111:111111111111' },
    { ...command, expectedInputVersion: 1.5 }, { ...command, model: 'custom-model' }, { ...command, shopId: id },
    { ...command, requestedBy: id }, { ...command, inputSnapshot: {} }]) {
    await request(app).post(`${base}/${id}/content-generations`).set(headers).send(payload).expect(400);
  }
  await request(app).get(`${base}/${id}/content-generations/bad`).set(headers).expect(400);
  expect(contentService.requestGeneration).not.toHaveBeenCalled();
  expect(contentService.getGeneration).not.toHaveBeenCalled();
});

test('generation routes require authentication and write permission to request', async () => {
  await request(app).post(`${base}/${id}/content-generations`).expect(401);
  await request(app).get(`${base}/${id}/content-generations/${id}`).expect(401);
  const readHeaders = { 'x-auth-context': JSON.stringify({ permissions: ['CATALOG:READ'] }) };
  await request(app).post(`${base}/${id}/content-generations`).set(readHeaders).send({}).expect(403);
  await request(app).get(`${base}/${id}/content-generations/${id}`).set(readHeaders).expect(200);
});

test('content input route validates, normalizes and passes confirmed facts with auth', async () => {
  const response = await request(app).put(`${base}/${id}/content-inputs`).set(headers).send(contentInputPayload).expect(200);
  expect(response.body.data).toEqual({ id, contentInputVersion: 1 });
  expect(contentInputService.saveContentInputs).toHaveBeenCalledWith(id, {
    ...contentInputPayload,
    keyword: 'Funny Cat Accountant',
    productFacts: { ...contentInputPayload.productFacts },
    availableColors: [{ code: 'BLACK', label: 'Black' }],
  }, auth);
});

test.each([
  (({ expectedInputVersion, ...payload }) => payload)(contentInputPayload),
  { ...contentInputPayload, expectedInputVersion: -1 },
  { ...contentInputPayload, profileCode: 'OTHER_PROFILE' },
  { ...contentInputPayload, language: 'en-GB' },
  (({ factsConfirmed, ...payload }) => payload)(contentInputPayload),
  { ...contentInputPayload, factsConfirmed: false },
  { ...contentInputPayload, productFacts: { ...contentInputPayload.productFacts, material: '  ' } },
  { ...contentInputPayload, productFacts: { ...contentInputPayload.productFacts, features: [] } },
  { ...contentInputPayload, productFacts: { ...contentInputPayload.productFacts, features: Array(11).fill('Feature') } },
  { ...contentInputPayload, productFacts: { ...contentInputPayload.productFacts, unknown: 'no' } },
  { ...contentInputPayload, availableColors: [] },
  { ...contentInputPayload, availableColors: Array.from({ length: 31 }, (_, index) => ({ code: `C${index}`, label: `Color ${index}` })) },
  { ...contentInputPayload, availableColors: [{ code: 'black', label: 'Black' }, { code: ' BLACK ', label: 'Dark black' }] },
  { ...contentInputPayload, availableColors: [{ code: 'not allowed', label: 'Black' }] },
  { ...contentInputPayload, availableColors: [null] },
  { ...contentInputPayload, unknown: 'no' },
])('content input route rejects incomplete, unbounded, duplicate or unknown input', async (payload) => {
  await request(app).put(`${base}/${id}/content-inputs`).set(headers).send(payload).expect(400);
  expect(contentInputService.saveContentInputs).not.toHaveBeenCalled();
});

test('create normalizes marketplace and defaults Amazon channel', async () => {
  const response = await request(app).post(base).set(headers).send(createPayload).expect(201);
  expect(response.body.data).toMatchObject({ state: 'BRIEF', salesChannelCode: 'AMAZON' });
  expect(service.createListingLaunch).toHaveBeenCalledWith({ ...createPayload, marketplaceCode: 'AMAZON_US', salesChannelCode: 'AMAZON' }, auth);
});

test('read, edit and select route contracts pass validated input and auth', async () => {
  await request(app).get(`${base}?shopId=${id}&page=2&limit=10`).set(headers).expect(200);
  expect(service.listListingLaunches).toHaveBeenCalledWith({ shopId: id, page: 2, limit: 10 }, auth);
  await request(app).get(`${base}/${id}`).set(headers).expect(200);
  expect(service.getListingLaunch).toHaveBeenCalledWith(id, auth);
  await request(app).patch(`${base}/${id}`).set(headers).send({ workingTitle: null }).expect(200);
  expect(service.updateListingLaunch).toHaveBeenCalledWith(id, { workingTitle: null }, auth);
  await request(app).patch(`${base}/${id}`).set(headers).send({ referenceAssetIds: [] }).expect(200);
  expect(service.updateListingLaunch).toHaveBeenCalledWith(id, { referenceAssetIds: [] }, auth);
  await request(app).post(base).set(headers).send({ ...createPayload, referenceAssetIds: [] }).expect(201);
  const selection = { productTypeGroupId: id, internalTemplateId: id };
  await request(app).post(`${base}/${id}/select-product`).set(headers).send(selection).expect(200);
  expect(service.selectProduct).toHaveBeenCalledWith(id, selection, auth);
});

test.each([
  { ...createPayload, salesChannelCode: 'ETSY' },
  { shopId: id, marketplaceCode: 'AMAZON_US' },
  { ...createPayload, brief: '  ' },
  { ...createPayload, brief: 'x'.repeat(5001) },
  { ...createPayload, workingTitle: 'x'.repeat(501) },
  { ...createPayload, shopId: 'bad' },
  { ...createPayload, state: 'PRODUCT_SELECTED' },
  { ...createPayload, referenceAssetIds: ['bad'] },
  { ...createPayload, referenceAssetIds: [null] },
  { ...createPayload, referenceAssetIds: [id, id] },
  { ...createPayload, referenceAssetIds: Array.from({ length: 51 }, (_, i) => i.toString(16).padStart(24, '0')) },
])('rejects invalid or unknown creation fields', async (payload) => {
  await request(app).post(base).set(headers).send(payload).expect(400);
  expect(service.createListingLaunch).not.toHaveBeenCalled();
});

test.each([{ shopId: id }, { marketplaceCode: 'AMAZON_CA' }, { state: 'BRIEF' }, { productTypeGroupId: id }, { selectedBy: id }, {}])('rejects immutable or empty patches', async (payload) => {
  await request(app).patch(`${base}/${id}`).set(headers).send(payload).expect(400);
  expect(service.updateListingLaunch).not.toHaveBeenCalled();
});

test('rejects malformed ids, unknown queries and incomplete/extended selection', async () => {
  await request(app).post(base).set(headers).expect(400);
  await request(app).patch(`${base}/${id}`).set(headers).expect(400);
  await request(app).post(`${base}/${id}/select-product`).set(headers).expect(400);
  await request(app).get(`${base}/bad`).set(headers).expect(400);
  await request(app).get(`${base}?shopIds=${id}`).set(headers).expect(400);
  await request(app).get(`${base}?limit=101`).set(headers).expect(400);
  for (const payload of [{}, { productTypeGroupId: id }, { productTypeGroupId: id, internalTemplateId: 'bad' }, { productTypeGroupId: id, internalTemplateId: id, state: 'BRIEF' }]) {
    await request(app).post(`${base}/${id}/select-product`).set(headers).send(payload).expect(400);
  }
  expect(service.selectProduct).not.toHaveBeenCalled();
});

test('ObjectIds normalize before access checks and asset duplicate validation', async () => {
  const uppercase = 'ABCDEF000000000000000001';
  await request(app).post(base).set(headers).send({ ...createPayload, shopId: uppercase, referenceAssetIds: [uppercase] }).expect(201);
  expect(service.createListingLaunch.mock.lastCall[0]).toMatchObject({ shopId: uppercase.toLowerCase(), referenceAssetIds: [uppercase.toLowerCase()] });
  await request(app).post(base).set(headers).send({ ...createPayload, referenceAssetIds: [uppercase, uppercase.toLowerCase()] }).expect(400);
  await request(app).get(`${base}/${uppercase}`).set(headers).expect(200);
  expect(service.getListingLaunch).toHaveBeenLastCalledWith(uppercase.toLowerCase(), auth);
});

test('all routes require authentication; read-only role cannot write', async () => {
  for (const [method, path] of [['get', base], ['post', base], ['get', `${base}/${id}`], ['patch', `${base}/${id}`], ['post', `${base}/${id}/select-product`], ['put', `${base}/${id}/content-inputs`]]) {
    await request(app)[method](path).expect(401);
  }
  await request(app).get(base).set('x-auth-context', JSON.stringify({})).expect(403);
  const readHeaders = { 'x-auth-context': JSON.stringify({ scopes: [{ scopeType: 'shop', scopeId: id, permissions: ['CATALOG:READ'] }] }) };
  await request(app).get(base).set(readHeaders).expect(200);
  await request(app).post(base).set(readHeaders).send(createPayload).expect(403);
  await request(app).patch(`${base}/${id}`).set(readHeaders).send({ brief: 'tee' }).expect(403);
  await request(app).post(`${base}/${id}/select-product`).set(readHeaders).send({ productTypeGroupId: id, internalTemplateId: id }).expect(403);
  await request(app).put(`${base}/${id}/content-inputs`).set(readHeaders).send(contentInputPayload).expect(403);
});
