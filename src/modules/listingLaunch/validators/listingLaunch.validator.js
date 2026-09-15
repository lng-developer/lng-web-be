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
const productFactsSchema = Joi.object({
  brand: Joi.string().trim().min(1).max(120).required(),
  productName: Joi.string().trim().min(1).max(200).required(),
  material: Joi.string().trim().min(1).max(500).required(),
  features: Joi.array().items(Joi.string().trim().min(1).max(300).required()).min(1).max(10).required(),
  personalization: Joi.string().trim().min(1).max(1000),
  careInstructions: Joi.string().trim().min(1).max(1000),
}).unknown(false).required();
const availableColorSchema = Joi.object({
  code: Joi.string().trim().uppercase().min(1).max(60).pattern(/^[A-Z0-9_-]+$/).required(),
  label: Joi.string().trim().min(1).max(100).required(),
}).unknown(false).required();
const contentInputsSchema = Joi.object({
  expectedInputVersion: Joi.number().integer().min(0).required(),
  profileCode: Joi.string().valid('AMAZON_US_APPAREL_CONTENT_V1').required(),
  keyword: Joi.string().trim().min(1).max(200).required(),
  language: Joi.string().valid('en-US').required(),
  productFacts: productFactsSchema,
  availableColors: Joi.array().items(availableColorSchema).min(1).max(30).unique('code').required(),
  factsConfirmed: Joi.boolean().valid(true).required(),
}).unknown(false).required();
const listQuerySchema = Joi.object({
  shopId: objectId,
  state: Joi.string().valid(...Object.values(states)),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
}).unknown(false);
const idParamsSchema = Joi.object({ id: objectId.required() }).unknown(false);
const generationSchema = Joi.object({
  requestKey: Joi.string().guid().pattern(/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i).lowercase().required(),
  expectedInputVersion: Joi.number().integer().min(0).required(),
}).unknown(false).required();
const generationParamsSchema = Joi.object({ id: objectId.required(), runId: objectId.required() }).unknown(false).required();

module.exports = {
  createSchema,
  updateSchema,
  selectProductSchema,
  contentInputsSchema,
  listQuerySchema,
  idParamsSchema,
  generationSchema,
  generationParamsSchema,
};
