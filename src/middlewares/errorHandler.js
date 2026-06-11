function errorHandler(error, req, res, next) {
  if (res.headersSent) {
    return next(error);
  }

  const statusCode = error.statusCode || error.status || 500;
  const isOperational = statusCode < 500;

  return res.status(statusCode).json({
    success: false,
    message: isOperational ? error.message : 'Internal server error',
    ...(process.env.NODE_ENV !== 'production' && { stack: error.stack }),
  });
}

module.exports = errorHandler;
