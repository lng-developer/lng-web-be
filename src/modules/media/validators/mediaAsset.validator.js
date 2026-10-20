const Joi = require('joi');

const listSchema = Joi.object({
  q: Joi.string().trim().empty('').max(180),
  mimeGroup: Joi.string().uppercase().valid('IMAGE', 'DOCUMENT', 'ARCHIVE', 'OTHER'),
  provider: Joi.string().trim().lowercase().max(40),
  resourceType: Joi.string().trim().lowercase().max(80),
  ownerType: Joi.string().trim().uppercase().max(80),
  status: Joi.string().uppercase().valid('ACTIVE', 'DISCARDED'),
  dateFrom: Joi.date().iso(),
  dateTo: Joi.date().iso().min(Joi.ref('dateFrom')),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const initiateMultipartSchema = Joi.object({
  filename: Joi.string().trim().max(255).pattern(/\.(psd|zip|rar)$/i).required(),
  mimeType: Joi.string().trim().max(120).default('application/octet-stream'),
  size: Joi.number().integer().min(1).max(2 * 1024 * 1024 * 1024).required(),
  assetPurpose: Joi.string().uppercase().valid('PSD_TEMPLATE', 'DESIGN_PACKAGE', 'PRINT_READY').required(),
});

const presignPartsSchema = Joi.object({
  partNumbers: Joi.array().items(Joi.number().integer().min(1)).min(1).max(20).unique().required(),
});

const completeMultipartSchema = Joi.object({
  parts: Joi.array().items(Joi.object({
    partNumber: Joi.number().integer().min(1).required(),
    etag: Joi.string().trim().min(1).max(255).required(),
  })).min(1).max(10000).unique('partNumber').required(),
});

function validate(schema, payload) {
  const result = schema.validate(payload, { abortEarly: false, convert: true, stripUnknown: true });
  return result.error
    ? { value: result.value, details: result.error.details.map(({ message, path, type }) => ({ message, path, type })) }
    : { value: result.value };
}

module.exports = {
  completeMultipartSchema, initiateMultipartSchema, listSchema, presignPartsSchema, validate,
};
