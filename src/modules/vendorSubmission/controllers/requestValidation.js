const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { validate } = require('../validators/vendorSubmission.validator');

function assertValid(schema, payload) {
  const { value, details } = validate(schema, payload);
  if (details) {
    throw new AppError('Validation failed', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, details);
  }
  return value;
}

module.exports = {
  assertValid,
};
