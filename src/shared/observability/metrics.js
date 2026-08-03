const client = require('prom-client');

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: 'lng_' });

const labelNames = ['method', 'route', 'status_code'];
const requests = new client.Counter({
  name: 'lng_http_requests_total',
  help: 'Completed HTTP requests',
  labelNames,
  registers: [registry],
});
const duration = new client.Histogram({
  name: 'lng_http_request_duration_seconds',
  help: 'HTTP request duration in seconds',
  labelNames,
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

function recordHttpRequest({ method, route, statusCode, durationSeconds }) {
  const labels = { method, route, status_code: String(statusCode) };
  requests.inc(labels);
  duration.observe(labels, durationSeconds);
}

module.exports = {
  recordHttpRequest,
  metricsContentType: registry.contentType,
  getMetrics: () => registry.metrics(),
};
