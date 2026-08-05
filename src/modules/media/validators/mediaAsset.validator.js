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

function validate(schema, payload) {
  const result = schema.validate(payload, { abortEarly: false, convert: true, stripUnknown: true });
  return result.error
    ? { value: result.value, details: result.error.details.map(({ message, path, type }) => ({ message, path, type })) }
    : { value: result.value };
}

module.exports = { listSchema, validate };
