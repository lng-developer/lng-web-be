const logger = require('../shared/utils/logger');
const config = require('../config');
const httpStatus = require('../shared/constants/httpStatus');
const errorCodes = require('../shared/constants/errorCodes');

const noisyNotFoundPaths = new Set([
  '/',
  '/dispatch.asp',
  '/favicon.ico',
  '/SDK/webLanguage',
  '/.env',
  '/.env.local',
]);

function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const isOversizedUpload = error.code === 'LIMIT_FILE_SIZE';
  const statusCode = isOversizedUpload
    ? 413
    : error.statusCode || error.status || httpStatus.INTERNAL_SERVER;
  const isOperational = error.isOperational === true || statusCode < httpStatus.INTERNAL_SERVER;
  const code = isOversizedUpload
    ? errorCodes.PAYLOAD_TOO_LARGE
    : isOperational ? error.code || errorCodes.APP_ERROR : errorCodes.INTERNAL_SERVER_ERROR;
  const message = isOversizedUpload
    ? 'Uploaded file exceeds the maximum allowed size'
    : isOperational ? error.message : 'Internal server error';
  const isNoisyNotFound = statusCode === httpStatus.NOT_FOUND && noisyNotFoundPaths.has(req.path);
  const logLevel = isNoisyNotFound ? 'debug' : statusCode >= httpStatus.INTERNAL_SERVER ? 'error' : 'warn';

  logger[logLevel]('request_failed', {
    requestId: req.id,
    method: req.method,
    path: req.originalUrl,
    statusCode,
    error,
  });
  res.locals.errorLogged = true;

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
