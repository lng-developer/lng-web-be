const mongoose = require('mongoose');
const {
  toListingLaunchDto,
  toListingLaunchListItemDto,
} = require('../../../src/modules/listingLaunch/dtos/listingLaunch.dto');

test('DTO normalizes identifiers and excludes internal persistence fields', () => {
  const id = new mongoose.Types.ObjectId();
  const result = toListingLaunchDto({
    _id: id, shopId: id, productTypeGroupId: id, referenceAssetIds: [id],
    state: 'BRIEF', brief: 'tee', __v: 4, internalOnly: 'hidden',
  });
  expect(result).toMatchObject({ id: String(id), shopId: String(id), productTypeGroupId: String(id), referenceAssetIds: [String(id)], internalTemplateId: null, selectedAt: null });
  expect(result).not.toHaveProperty('_id');
  expect(result).not.toHaveProperty('__v');
  expect(result).not.toHaveProperty('internalOnly');
});

test('list DTO preserves P1 fields and exposes only scalar content status', () => {
  const id = new mongoose.Types.ObjectId();
  const item = toListingLaunchListItemDto({
    _id: id,
    shopId: id,
    salesChannelCode: 'AMAZON',
    marketplaceCode: 'AMAZON_US',
    brief: 'Floral tee',
    workingTitle: 'Pilot',
    productTypeGroupId: id,
    internalTemplateId: id,
    referenceAssetIds: [id],
    state: 'PRODUCT_SELECTED',
    selectedBy: id,
    selectedAt: new Date('2026-09-15T00:00:00Z'),
    createdBy: id,
    createdAt: new Date('2026-09-14T00:00:00Z'),
    updatedAt: new Date('2026-09-15T00:00:00Z'),
    contentInputVersion: 2,
    contentVersionCounter: 3,
    contentInputs: { keyword: 'secret full inputs' },
    approvedContent: { versionId: id, inputHash: 'a'.repeat(64), approvedBy: id },
  });

  expect(item).toMatchObject({
    id: String(id),
    shopId: String(id),
    brief: 'Floral tee',
    workingTitle: 'Pilot',
    productTypeGroupId: String(id),
    internalTemplateId: String(id),
    referenceAssetIds: [String(id)],
    state: 'PRODUCT_SELECTED',
    selectedBy: String(id),
    createdBy: String(id),
    contentInputVersion: 2,
    contentVersionCounter: 3,
    hasContentInputs: true,
    hasApprovedContent: true,
  });
  expect(item).not.toHaveProperty('contentInputs');
  expect(item).not.toHaveProperty('approvedContent');
});
