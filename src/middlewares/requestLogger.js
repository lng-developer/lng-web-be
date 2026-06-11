const logger = require('../shared/utils/logger');

function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    logger.http(level, {
      rid: req.id,
      m: req.method,
      path: req.originalUrl,
      st: res.statusCode,
      ms: Number(durationMs.toFixed(2)),
    });
  });

  next();
}

module.exports = requestLogger;
