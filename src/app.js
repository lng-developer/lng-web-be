const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config');
const { createCorsOrigin } = require('./config/corsOrigin');
const modules = require('./modules');
const requestContext = require('./middlewares/requestContext');
const requestLogger = require('./middlewares/requestLogger');
const notFoundHandler = require('./middlewares/notFoundHandler');
const errorHandler = require('./middlewares/errorHandler');

function createApp() {
  const app = express();

  app.use(requestContext);
  app.use(requestLogger);
  app.use(helmet());
  app.use(cors({
    origin: createCorsOrigin({ env: config.env, allowedOrigins: config.http.corsOrigins }),
    credentials: true,
  }));
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.get('/health', (req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  if (config.metrics.enabled) {
    const metrics = require('./shared/observability/metrics');
    app.get('/internal/metrics', async (req, res) => {
      res.set('Content-Type', metrics.metricsContentType).end(await metrics.getMetrics());
    });
  }

  app.use('/api', modules.router);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = createApp;
