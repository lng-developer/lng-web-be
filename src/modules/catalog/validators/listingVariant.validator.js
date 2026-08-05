const { Joi, objectId } = require('./validator.helpers');
const { recordStatuses } = require('../constants/catalog.constants');

const fields = {
  productTypeGroupId: objectId.required(),
  internalTemplateId: objectId.allow(null),
  psdTemplateAssetId: objectId.allow(null),
  previewAssetId: objectId.allow(null),
  status: Joi.string().valid(...Object.values(recordStatuses)),
};
const createListingVariantSchema = Joi.object(fields);
const updateListingVariantSchema = Joi.object({ ...fields, productTypeGroupId: objectId }).min(1);

module.exports = { createListingVariantSchema, updateListingVariantSchema };
