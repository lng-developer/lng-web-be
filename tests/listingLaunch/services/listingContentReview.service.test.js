jest.mock('../../../src/modules/catalog/public', () => ({ getProductTypeGroupById: jest.fn(), getInternalTemplateById: jest.fn() }));
jest.mock('../../../src/modules/shop/public', () => ({ assertShopIsActive: jest.fn() }));
jest.mock('../../../src/modules/listingLaunch/repositories/listingContent.repository');
const catalog = require('../../../src/modules/catalog/public');
const shop = require('../../../src/modules/shop/public');
const repository = require('../../../src/modules/listingLaunch/repositories/listingContent.repository');
const review = require('../../../src/modules/listingLaunch/services/listingContentReview.service');
const { hashContentSnapshot } = require('../../../src/modules/listingLaunch/services/listingContentInput.service');
const { ids, launchPayload, snapshot, content } = require('../helpers/contentFixtures');
const AppError = require('../../../src/shared/errors/appError');
const errorCodes = require('../../../src/shared/constants/errorCodes');
const context = {
  productTypeGroup: { ...snapshot.catalog.productTypeGroup, status: 'ACTIVE' },
  internalTemplate: { ...snapshot.catalog.internalTemplate, status: 'ACTIVE', productTypeGroupId: ids.productTypeGroupId },
};
const version = { _id: '660000000000000000000010', launchId: '660000000000000000000011', shopId: ids.shopId,
  inputVersion: 1, inputHash: hashContentSnapshot(snapshot), profileVersion: 1, content };
const launch = { _id: version.launchId, ...launchPayload(), approvedContent: { versionId: version._id, inputVersion: 1,
  inputHash: version.inputHash, selectedColorCodes: ['BLACK'], approvedBy: ids.accountId, approvedAt: new Date() } };
beforeEach(() => {
  jest.resetAllMocks();
  catalog.getProductTypeGroupById.mockResolvedValue(context.productTypeGroup);
  catalog.getInternalTemplateById.mockResolvedValue(context.internalTemplate);
});

test('validity requires matching launch, input version, profile, fingerprint and approval pointer', () => {
  expect(review.getContentValidity(launch, version, context)).toEqual({ isStale: false, approvedContentUsable: true });
  for (const change of [{ inputVersion: 0 }, { inputHash: 'a'.repeat(64) }, { profileVersion: 2 }, { launchId: ids.shopId }, { shopId: ids.accountId }]) {
    expect(review.getContentValidity(launch, { ...version, ...change }, context)).toEqual({ isStale: true, approvedContentUsable: false });
  }
  expect(review.getContentValidity({ ...launch, approvedContent: null }, version, context)).toEqual({ isStale: false, approvedContentUsable: false });
  expect(review.getContentValidity(launch, version, null)).toEqual({ isStale: true, approvedContentUsable: false });
  expect(review.getContentValidity(launch, version, { ...context, productTypeGroup: { ...context.productTypeGroup, status: 'INACTIVE' } }))
    .toEqual({ isStale: true, approvedContentUsable: false });
  expect(review.getContentValidity(launch, version, { ...context, internalTemplate: { ...context.internalTemplate, productTypeGroupId: ids.shopId } }))
    .toEqual({ isStale: true, approvedContentUsable: false });
});

test('legacy detail with no content skips Catalog and content-history queries', async () => {
  expect(await review.getContentReviewSummary({ _id: launch._id })).toEqual({ latestRun: null, isStale: false, approvedContentUsable: false });
  expect(catalog.getProductTypeGroupById).not.toHaveBeenCalled();
  expect(repository.findLatestRun).not.toHaveBeenCalled();
});

test('expected inactive/missing references yield stale history but infrastructure failures propagate', async () => {
  repository.findVersionById.mockResolvedValue(version);
  repository.findLatestRun.mockResolvedValue(null);
  shop.assertShopIsActive.mockRejectedValueOnce(new AppError('Shop not found', 404, true, errorCodes.RESOURCE_NOT_FOUND));
  expect(await review.getContentReviewSummary(launch)).toMatchObject({ isStale: true, approvedContentUsable: false });
  const outage = new Error('Database unavailable');
  catalog.getProductTypeGroupById.mockRejectedValueOnce(outage);
  await expect(review.getContentReviewSummary(launch)).rejects.toBe(outage);
});
