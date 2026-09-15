const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');

function assertValid(schema, payload) {
  const { error, value } = schema.validate(payload, { abortEarly: false, allowUnknown: false });
  if (error) {
    const details = error.details.map((detail) => ({ field: detail.path.join('.'), message: detail.message }));
    throw new AppError('Validation failed', 400, true, errorCodes.VALIDATION_ERROR, details);
  }
  return value;
}

module.exports = { assertValid };
