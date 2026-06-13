const mongoose = require('mongoose');
const AppError = require('../errors/appError');
const httpStatus = require('../constants/httpStatus');
const errorCodes = require('../constants/errorCodes');

function isValidObjectId(value) {
  return mongoose.Types.ObjectId.isValid(value);
}

function assertValidObjectId(value, label = 'id') {
  if (!isValidObjectId(value)) {
    throw new AppError(`${label} is invalid`, httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }
}

module.exports = {
  isValidObjectId,
  assertValidObjectId,
};
