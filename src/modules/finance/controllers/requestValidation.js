const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { validate } = require('../validators/financeSnapshot.validator');

function assertValid(schema, payload) {
  const result = validate(schema, payload);
  if (!result.details) return result.value;

  throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, result.details);
}

module.exports = {
  assertValid,
};
