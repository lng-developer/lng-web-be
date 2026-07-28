const Joi = require('joi');

const objectId = Joi.string().hex().length(24);

function validate(schema, payload) {
  const result = schema.validate(payload, {
    abortEarly: false,
    convert: true,
    stripUnknown: true,
  });
  return result.error
    ? {
        value: result.value,
        details: result.error.details.map(({ message, path, type }) => ({ message, path, type })),
      }
    : { value: result.value };
}

const listSchema = Joi.object({
  unreadOnly: Joi.boolean().default(false),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});
const idParamsSchema = Joi.object({ id: objectId.required() });

module.exports = {
  idParamsSchema,
  listSchema,
  validate,
};
