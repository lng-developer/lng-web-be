const logger = require('../shared/utils/logger');
const config = require('../config');
const metrics = config.metrics.enabled ? require('../shared/observability/metrics') : null;

function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';

    if (req.method !== 'OPTIONS') {
      logger.http(level, {
        rid: req.id,
        m: req.method,
        path: req.originalUrl,
        st: res.statusCode,
        ms: Number(durationMs.toFixed(2)),
      });
    }

    if (metrics) {
      try {
        const routePath = req.route?.path;
        const routeSegmentCount = typeof routePath === 'string'
          ? routePath.split('/').filter(Boolean).length
          : 0;
        const pathSegments = req.path.split('/').filter(Boolean);
        const mountPath = `/${pathSegments.slice(0, pathSegments.length - routeSegmentCount).join('/')}`;
        const route = routePath ? `${mountPath === '/' ? '' : mountPath}${routePath}` : 'unmatched';
        metrics.recordHttpRequest({
          method: req.method,
          route,
          statusCode: res.statusCode,
          durationSeconds: durationMs / 1000,
        });
      } catch (error) {
        logger.warn('http_metrics_record_failed', { error });
      }
    }
  });

  next();
}

module.exports = requestLogger;
