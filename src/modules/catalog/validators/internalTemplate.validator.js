const {
  artworkOutputRoles,
  artworkSlotTypes,
  designAssetTypes,
  internalTemplateFieldSources,
  internalTemplateFieldTypes,
  recordStatuses,
} = require('../constants/catalog.constants');
const { Joi, objectId, safeIdentifier } = require('./validator.helpers');

const fieldValidationSchema = Joi.object({
  minLength: Joi.number().integer().min(0),
  maxLength: Joi.number().integer().min(0),
  acceptedMimeTypes: Joi.array().items(Joi.string().trim().min(1).max(120)),
  maxSizeBytes: Joi.number().integer().min(1),
  minWidth: Joi.number().integer().min(1),
  minHeight: Joi.number().integer().min(1),
  pattern: Joi.string().trim().max(500),
}).unknown(false);

const requiredFieldSchema = Joi.object({
  key: safeIdentifier.required(),
  label: Joi.string().trim().max(160).allow(null, ''),
  type: Joi.string().valid(...Object.values(internalTemplateFieldTypes)),
  required: Joi.boolean(),
  source: Joi.string().valid(...Object.values(internalTemplateFieldSources)).allow(null),
  validation: fieldValidationSchema,
  sortOrder: Joi.number().integer(),
});

const artworkSlotSchema = Joi.object({
  key: safeIdentifier.required(),
  label: Joi.string().trim().max(160).allow(null, ''),
  type: Joi.string().valid(...Object.values(artworkSlotTypes)),
  required: Joi.boolean(),
  acceptedFieldKeys: Joi.array().items(safeIdentifier),
  outputRole: Joi.string().valid(...Object.values(artworkOutputRoles)).allow(null),
  sortOrder: Joi.number().integer(),
});

const designAssetSchema = Joi.object({
  type: Joi.string().valid(...Object.values(designAssetTypes)).required(),
  mediaAssetId: objectId.required(),
  version: Joi.string().trim().max(40),
  label: Joi.string().trim().max(160).allow(null, ''),
  status: Joi.string().valid(...Object.values(recordStatuses)),
  metadata: Joi.object().unknown(true),
});

const listInternalTemplatesQuerySchema = Joi.object({
  code: Joi.string().trim().uppercase().max(80),
  name: Joi.string().trim().max(160),
  q: Joi.string().trim().max(160),
  productTypeGroupId: objectId,
  status: Joi.string().valid(...Object.values(recordStatuses)),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const createInternalTemplateSchema = Joi.object({
  code: Joi.string().trim().uppercase().min(1).max(80).required(),
  name: Joi.string().trim().min(1).max(160).required(),
  description: Joi.string().trim().max(1000).allow(null, ''),
  productTypeGroupId: objectId.required(),
  requiredFields: Joi.array().items(requiredFieldSchema),
  artworkSlots: Joi.array().items(artworkSlotSchema),
  designAssets: Joi.array().items(designAssetSchema),
  requiresPsd: Joi.boolean(),
  status: Joi.string().valid(...Object.values(recordStatuses)),
});

const updateInternalTemplateSchema = Joi.object({
  name: Joi.string().trim().min(1).max(160),
  description: Joi.string().trim().max(1000).allow(null, ''),
  productTypeGroupId: objectId,
  requiredFields: Joi.array().items(requiredFieldSchema),
  artworkSlots: Joi.array().items(artworkSlotSchema),
  designAssets: Joi.array().items(designAssetSchema),
  requiresPsd: Joi.boolean(),
  status: Joi.string().valid(...Object.values(recordStatuses)),
}).min(1);

module.exports = {
  listInternalTemplatesQuerySchema,
  createInternalTemplateSchema,
  updateInternalTemplateSchema,
};
