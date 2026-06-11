const AppError = require('../shared/errors/appError');
const httpStatus = require('../shared/constants/httpStatus');
const errorCodes = require('../shared/constants/errorCodes');

function notFoundHandler(req, res, next) {
  next(new AppError(`Route not found: ${req.method} ${req.originalUrl}`, httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND));
}

module.exports = notFoundHandler;
