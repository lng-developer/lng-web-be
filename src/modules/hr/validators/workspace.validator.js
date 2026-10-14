const Joi = require('joi');

const dateKeyPattern = /^\d{4}-\d{2}-\d{2}$/;

function validate(schema, payload) {
  const result = schema.validate(payload, { abortEarly: false, stripUnknown: true, convert: true });
  return result.error
    ? { value: result.value, details: result.error.details.map(({ message, path, type }) => ({ message, path, type })) }
    : { value: result.value };
}

const workspaceQuerySchema = Joi.object({
  announcementId: Joi.string().hex().length(24),
  dateKey: Joi.string().pattern(dateKeyPattern).required(),
  year: Joi.number().integer().min(2000).max(2100).required(),
  month: Joi.number().integer().min(1).max(12).required(),
  days: Joi.number().integer().valid(1, 7, 30),
  teamId: Joi.string().hex().length(24),
}).unknown(false);

module.exports = { validate, workspaceQuerySchema };
