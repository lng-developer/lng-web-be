require('dotenv').config();

const https = require('https');

const baseUrl = process.env.PRINTWAY_API_BASE_URL;
const accessToken = process.env.PRINTWAY_ACCESS_TOKEN;

function formatPrintwayDate(date) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
  ].join('-') + ` ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function requestJson(path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = https.request(new URL(path, baseUrl), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
      timeout: 20000,
    }, (response) => {
      let raw = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { raw += chunk; });
      response.on('end', () => {
        let json = null;
        try {
          json = raw ? JSON.parse(raw) : null;
        } catch (error) {
          reject(new Error(`Printway returned non-JSON response: ${raw.slice(0, 200)}`));
          return;
        }
        resolve({ statusCode: response.statusCode, json });
      });
    });

    request.on('timeout', () => request.destroy(new Error('Printway request timeout')));
    request.on('error', reject);
    request.write(payload);
    request.end();
  });
}

async function main() {
  if (!accessToken) {
    throw new Error('PRINTWAY_ACCESS_TOKEN is required');
  }
  if (!baseUrl) {
    throw new Error('PRINTWAY_API_BASE_URL is required');
  }

  const now = new Date();
  const defaultMin = new Date(now);
  defaultMin.setUTCFullYear(defaultMin.getUTCFullYear() - 2);
  const body = {
    created_at_min: readArg('created_at_min', process.env.PRINTWAY_TRACKING_CREATED_AT_MIN || formatPrintwayDate(defaultMin)),
    created_at_max: readArg('created_at_max', process.env.PRINTWAY_TRACKING_CREATED_AT_MAX || formatPrintwayDate(now)),
    limit: Number(readArg('limit', '10')),
    page: Number(readArg('page', '1')),
    search: readArg('externalOrderId', readArg('search', '')),
  };

  const { statusCode, json } = await requestJson('/v3/order/list', body);
  const first = Array.isArray(json?.data) ? json.data[0] : null;
  const tracking = Array.isArray(first?.trackings) ? first.trackings[0] : first?.trackings;
  console.log(JSON.stringify({
    provider: 'PRINTWAY',
    statusCode,
    success: Boolean(json?.success),
    message: json?.message || null,
    page: json?.page ?? null,
    limit: json?.limit ?? null,
    length: json?.length ?? null,
    totalPage: json?.totalPage ?? null,
    firstOrderKeys: Array.isArray(json?.data) && json.data[0] ? Object.keys(json.data[0]).slice(0, 30) : [],
    firstTracking: tracking ? {
      orderName: first.order_name || null,
      carrier: tracking.carrierName || tracking.carrierCode || null,
      trackingNumber: tracking.trackingNumber || null,
      trackingUrl: tracking.trackingUrl || null,
    } : null,
  }, null, 2));

  if (statusCode < 200 || statusCode >= 300 || json?.success === false) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
