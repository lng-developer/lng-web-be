const baseUrl = (__ENV.K6_BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const hostMatch = baseUrl.match(/^https?:\/\/(\[[^\]]+\]|[^/:]+)(?::\d+)?(?:\/|$)/i);
const loopbackHosts = ['localhost', '127.0.0.1', '::1'];

if (!hostMatch) {
  throw new Error('K6_BASE_URL must be an HTTP(S) URL');
}

const hostname = hostMatch[1].replace(/^\[|\]$/g, '').toLowerCase();
if (!loopbackHosts.includes(hostname) && __ENV.K6_ALLOW_REMOTE !== 'true') {
  throw new Error('Remote load tests require K6_ALLOW_REMOTE=true');
}

export const url = `${baseUrl}${__ENV.K6_PATH || '/health'}`;
export const requestParams = __ENV.K6_ACCESS_TOKEN
  ? { headers: { Authorization: `Bearer ${__ENV.K6_ACCESS_TOKEN}` } }
  : {};

export const thresholds = {
  http_req_failed: ['rate<0.01'],
  http_req_duration: ['p(95)<1000'],
  checks: ['rate>0.99'],
};
