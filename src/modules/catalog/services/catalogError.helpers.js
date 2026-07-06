const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { isDuplicateKeyError } = require('../../../shared/utils/mongo');

function appError(message, statusCode, code, details) {
  return new AppError(message, statusCode, true, code, details);
}

function notFound(message) {
  return appError(message, httpStatus.NOT_FOUND, errorCodes.RESOURCE_NOT_FOUND);
}

function conflict(message) {
  return appError(message, httpStatus.CONFLICT, errorCodes.CONFLICT_ERROR);
}

function forbidden() {
  return appError('Forbidden', httpStatus.FORBIDDEN, errorCodes.AUTHORIZATION_ERROR);
}

function validationError(message, details = []) {
  return appError(message, httpStatus.BAD_REQUEST, errorCodes.VALIDATION_ERROR, details);
}

async function mapDuplicate(error, message) {
  if (isDuplicateKeyError(error)) throw conflict(message);
  throw error;
}

module.exports = {
  notFound,
  conflict,
  forbidden,
  validationError,
  mapDuplicate,
};
