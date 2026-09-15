const Joi = require('joi');
const { states, salesChannelCode } = require('../constants/listingLaunch.constants');

const objectId = Joi.string().pattern(/^[a-f\d]{24}$/i).lowercase();
const editableFields = {
  brief: Joi.string().trim().min(1).max(5000),
  workingTitle: Joi.string().trim().max(500).allow('', null),
  // P1 stores reference IDs only; asset existence, ownership and readiness are checked when consumed.
  referenceAssetIds: Joi.array().items(objectId).unique().max(50),
};

const createSchema = Joi.object({
  ...editableFields,
  shopId: objectId.required(),
  salesChannelCode: Joi.string().valid(salesChannelCode).default(salesChannelCode),
  marketplaceCode: Joi.string().trim().uppercase().min(1).max(80).required(),
  brief: editableFields.brief.required(),
}).unknown(false).required();
const updateSchema = Joi.object(editableFields).min(1).unknown(false).required();
const selectProductSchema = Joi.object({
  productTypeGroupId: objectId.required(),
  internalTemplateId: objectId.required(),
}).unknown(false).required();
const listQuerySchema = Joi.object({
  shopId: objectId,
  state: Joi.string().valid(...Object.values(states)),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
}).unknown(false);
const idParamsSchema = Joi.object({ id: objectId.required() }).unknown(false);

module.exports = { createSchema, updateSchema, selectProductSchema, listQuerySchema, idParamsSchema };
