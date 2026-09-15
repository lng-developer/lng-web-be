const mongoose = require('mongoose');
const { toListingLaunchDto } = require('../../../src/modules/listingLaunch/dtos/listingLaunch.dto');

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
