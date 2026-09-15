const request = require('supertest');
const express = require('express');
jest.mock('../../../src/modules/listingLaunch/services/listingLaunch.service');
jest.mock('../../../src/modules/listingLaunch/services/listingContentInput.service');
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
