jest.mock('../../../src/modules/listingLaunch/repositories/listingLaunch.repository');
jest.mock('../../../src/modules/catalog/public', () => ({ getProductTypeGroupById: jest.fn(), getInternalTemplateById: jest.fn() }));
jest.mock('../../../src/modules/shop/public', () => ({ assertShopIsActive: jest.fn() }));
jest.mock('../../../src/modules/auth/public', () => jest.requireActual('../../../src/modules/auth/middlewares/authorization'));
const repository = require('../../../src/modules/listingLaunch/repositories/listingLaunch.repository');
const catalog = require('../../../src/modules/catalog/public');
const shop = require('../../../src/modules/shop/public');
const service = require('../../../src/modules/listingLaunch/services/listingLaunch.service');
const id = '660000000000000000000001';
const shopId = '660000000000000000000002';
const productTypeGroupId = '660000000000000000000003';
const internalTemplateId = '660000000000000000000004';
const auth = { accountId: id, scopes: [{ scopeType: 'shop', scopeId: shopId, permissions: ['CATALOG:WRITE'] }] };
const draft = { _id: id, shopId, state: 'BRIEF', brief: 'Floral tee', salesChannelCode: 'AMAZON', marketplaceCode: 'AMAZON_US' };
beforeEach(() => {
  jest.resetAllMocks();
  repository.findById.mockResolvedValue(draft);
  repository.create.mockImplementation(async (payload) => ({ _id: id, state: 'BRIEF', ...payload }));
  repository.update.mockImplementation(async (_, patch) => ({ ...draft, ...patch }));
  repository.selectProduct.mockImplementation(async (_, selection) => ({ ...draft, ...selection, state: 'PRODUCT_SELECTED' }));
  catalog.getProductTypeGroupById.mockResolvedValue({ _id: productTypeGroupId, status: 'ACTIVE' });
  catalog.getInternalTemplateById.mockResolvedValue({ _id: internalTemplateId, status: 'ACTIVE', productTypeGroupId });
});

test('create checks active shop and returns allowlisted DTO', async () => {
  const result = await service.createListingLaunch({ shopId, marketplaceCode: 'AMAZON_US', brief: 'Floral tee' }, auth);
  expect(shop.assertShopIsActive).toHaveBeenCalledWith(shopId);
  expect(result).toMatchObject({ id, state: 'BRIEF', createdBy: id, salesChannelCode: 'AMAZON' });
  expect(result).not.toHaveProperty('_id');
  shop.assertShopIsActive.mockRejectedValueOnce({ statusCode: 409 });
  await expect(service.createListingLaunch({ shopId, marketplaceCode: 'AMAZON_US', brief: 'tee' }, auth)).rejects.toMatchObject({ statusCode: 409 });
});

test('every operation denies an inaccessible shop', async () => {
  for (const call of [
    () => service.createListingLaunch({ shopId, marketplaceCode: 'AMAZON_US', brief: 'tee' }, {}),
    () => service.getListingLaunch(id, {}),
    () => service.updateListingLaunch(id, { brief: 'tee' }, {}),
    () => service.selectProduct(id, { productTypeGroupId, internalTemplateId }, {}),
    () => service.listListingLaunches({ shopId }, {}),
  ]) await expect(call()).rejects.toMatchObject({ statusCode: 403 });
  expect(repository.create).not.toHaveBeenCalled();
  expect(repository.update).not.toHaveBeenCalled();
  expect(catalog.getProductTypeGroupById).not.toHaveBeenCalled();
});

test('list constrains scoped users, including zero scopes; global read can list all', async () => {
  repository.list.mockResolvedValue({ items: [draft], total: 1, page: 1, limit: 20 });
  await service.listListingLaunches({}, auth);
  expect(repository.list).toHaveBeenLastCalledWith(expect.objectContaining({ shopIds: [shopId] }));
  await service.listListingLaunches({}, {});
  expect(repository.list).toHaveBeenLastCalledWith(expect.objectContaining({ shopIds: [] }));
  await service.listListingLaunches({}, { permissions: ['CATALOG:READ'] });
  expect(repository.list.mock.lastCall[0].shopIds).toBeUndefined();
  await service.listListingLaunches({}, { roles: ['SUPER_ADMIN'] });
  expect(repository.list.mock.lastCall[0].shopIds).toBeUndefined();
  await service.listListingLaunches({}, { scopes: [
    ...auth.scopes,
    { scopeType: 'shop', scopeId: id, permissions: ['CATALOG:READ'], validUntil: '2020-01-01' },
    { scopeType: 'shop', scopeId: internalTemplateId, permissions: ['CATALOG:READ'], validFrom: '2099-01-01' },
  ] });
  expect(repository.list.mock.lastCall[0].shopIds).toEqual([shopId]);
});

test('list returns compact content status without confirmed inputs or approval evidence', async () => {
  repository.list.mockResolvedValue({
    items: [{
      ...draft,
      contentInputVersion: 2,
      contentVersionCounter: 3,
      contentInputs: {
        profileCode: 'AMAZON_US_APPAREL_CONTENT_V1',
        keyword: 'full input',
        language: 'en-US',
        productFacts: {
          brand: 'LNG', productName: 'Tee', material: 'Cotton', features: ['Crew neck'],
        },
        availableColors: [{ code: 'BLACK', label: 'Black' }],
        factsConfirmed: true,
        confirmedBy: id,
        confirmedAt: new Date(),
      },
      approvedContent: {
        versionId: id,
        inputVersion: 2,
        inputHash: 'a'.repeat(64),
        selectedColorCodes: ['BLACK'],
        approvedBy: id,
        approvedAt: new Date(),
      },
    }],
    total: 1,
    page: 1,
    limit: 20,
  });

  const result = await service.listListingLaunches({}, auth);

  expect(result.items[0]).toMatchObject({
    id,
    brief: 'Floral tee',
    contentInputVersion: 2,
    contentVersionCounter: 3,
    hasContentInputs: true,
    hasApprovedContent: true,
  });
  expect(result.items[0]).not.toHaveProperty('contentInputs');
  expect(result.items[0]).not.toHaveProperty('approvedContent');
});

test('selection uses read-only public ports, sets actor/time and conflicts on repeat or race', async () => {
  catalog.getInternalTemplateById.mockResolvedValueOnce({ status: 'ACTIVE', productTypeGroupId: { _id: productTypeGroupId, code: 'TEE' } });
  const result = await service.selectProduct(id, { productTypeGroupId, internalTemplateId }, auth);
  expect(result).toMatchObject({ state: 'PRODUCT_SELECTED', productTypeGroupId, internalTemplateId, selectedBy: id, selectedAt: expect.any(Date) });
  expect(catalog.getProductTypeGroupById).toHaveBeenCalledWith(productTypeGroupId);
  expect(catalog.getInternalTemplateById).toHaveBeenCalledWith(internalTemplateId);
  repository.selectProduct.mockResolvedValueOnce(null);
  await expect(service.selectProduct(id, { productTypeGroupId, internalTemplateId }, auth)).rejects.toMatchObject({ statusCode: 409 });
  repository.findById.mockResolvedValueOnce({ ...draft, state: 'PRODUCT_SELECTED' });
  await expect(service.selectProduct(id, { productTypeGroupId, internalTemplateId }, auth)).rejects.toMatchObject({ statusCode: 409 });
});

test.each([
  [null, { status: 'ACTIVE', productTypeGroupId }, 404],
  [{ status: 'INACTIVE' }, { status: 'ACTIVE', productTypeGroupId }, 409],
  [{ status: 'ACTIVE' }, null, 404],
  [{ status: 'ACTIVE' }, { status: 'INACTIVE', productTypeGroupId }, 409],
  [{ status: 'ACTIVE' }, { status: 'ACTIVE', productTypeGroupId: id }, 409],
])('invalid selection is rejected before persistence', async (group, template, statusCode) => {
  catalog.getProductTypeGroupById.mockResolvedValue(group);
  catalog.getInternalTemplateById.mockResolvedValue(template);
  await expect(service.selectProduct(id, { productTypeGroupId, internalTemplateId }, auth)).rejects.toMatchObject({ statusCode });
  expect(repository.selectProduct).not.toHaveBeenCalled();
});

test('editing selected launch preserves selection; missing launch returns 404', async () => {
  repository.findById.mockResolvedValueOnce({ ...draft, state: 'PRODUCT_SELECTED' });
  await service.updateListingLaunch(id, { brief: 'New brief', referenceAssetIds: [] }, auth);
  expect(repository.update).toHaveBeenCalledWith(
    id,
    { brief: 'New brief', referenceAssetIds: [] },
    { invalidateContent: true },
  );
  repository.findById.mockResolvedValueOnce(null);
  await expect(service.getListingLaunch(id, auth)).rejects.toMatchObject({ statusCode: 404 });
});
