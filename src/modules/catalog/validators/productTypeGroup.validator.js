const { recordStatuses } = require('../constants/catalog.constants');
const { Joi } = require('./validator.helpers');
const { printMethodValues } = require('../../../shared/constants/printMethods');

const listProductTypeGroupsQuerySchema = Joi.object({
  status: Joi.string().valid(...Object.values(recordStatuses)),
  search: Joi.string().trim().max(120),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const createProductTypeGroupSchema = Joi.object({
  code: Joi.string().trim().uppercase().min(1).max(80).required(),
  name: Joi.string().trim().min(1).max(160).required(),
  sortOrder: Joi.number().integer(),
  printMethod: Joi.string().trim().uppercase().valid(...printMethodValues).allow(null),
  status: Joi.string().valid(...Object.values(recordStatuses)),
});

const updateProductTypeGroupSchema = Joi.object({
  code: Joi.string().trim().uppercase().min(1).max(80),
  name: Joi.string().trim().min(1).max(160),
  sortOrder: Joi.number().integer(),
  printMethod: Joi.string().trim().uppercase().valid(...printMethodValues).allow(null),
  status: Joi.string().valid(...Object.values(recordStatuses)),
}).min(1);

module.exports = {
  listProductTypeGroupsQuerySchema,
  createProductTypeGroupSchema,
  updateProductTypeGroupSchema,
};
