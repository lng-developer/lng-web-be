const Joi = require('joi');

const objectId = Joi.string().hex().length(24);
const safeIdentifier = Joi.string().trim().pattern(/^[A-Za-z][A-Za-z0-9_]*$/);

function validate(schema, payload) {
  const result = schema.validate(payload, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  });

  if (!result.error) return { value: result.value };

  return {
    value: result.value,
    details: result.error.details.map((detail) => ({
      message: detail.message,
      path: detail.path,
      type: detail.type,
    })),
  };
}

module.exports = {
  Joi,
  objectId,
  safeIdentifier,
  validate,
};
