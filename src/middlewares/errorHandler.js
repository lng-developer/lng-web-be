const logger = require('../shared/utils/logger');
const config = require('../config');
const httpStatus = require('../shared/constants/httpStatus');
const errorCodes = require('../shared/constants/errorCodes');

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const statusCode = error.statusCode || error.status || httpStatus.INTERNAL_SERVER;
  const isOperational = error.isOperational === true || statusCode < httpStatus.INTERNAL_SERVER;
  const code = isOperational ? error.code || errorCodes.APP_ERROR : errorCodes.INTERNAL_SERVER_ERROR;
  const message = isOperational ? error.message : 'Internal server error';
  const logLevel = statusCode >= httpStatus.INTERNAL_SERVER ? 'error' : 'warn';

  logger[logLevel]('request_failed', {
    requestId: req.id,
    method: req.method,
    path: req.originalUrl,
    statusCode,
    error,
  });

  const payload = {
    success: false,
    error: {
      code,
      message,
      requestId: req.id,
      ...(error.details && { details: error.details }),
      ...(config.env !== 'production' && { stack: error.stack }),
    },
  };

  return res.status(statusCode).json(payload);
}

module.exports = errorHandler;
