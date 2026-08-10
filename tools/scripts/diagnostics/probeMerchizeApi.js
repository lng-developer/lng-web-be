require('dotenv').config();

const https = require('https');

function readArg(name, fallback) {
  const prefix = `--${name}=`;
  const found = process.argv.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function getJson(url, token) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'cache-control': 'no-cache',
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
          json = null;
        }
        resolve({ statusCode: response.statusCode, json, raw });
      });
    });

    request.on('timeout', () => request.destroy(new Error('Merchize request timeout')));
    request.on('error', reject);
    request.end();
  });
}

async function main() {
  const baseUrl = process.env.MERCHIZE_API_BASE_URL;
  const token = process.env.MERCHIZE_ACCESS_TOKEN;
  const externalOrderId = readArg('externalOrderId', '');

  if (!baseUrl) throw new Error('MERCHIZE_API_BASE_URL is required');
  if (!token) throw new Error('MERCHIZE_ACCESS_TOKEN is required');
  if (!externalOrderId) throw new Error('Usage: node tools/scripts/diagnostics/probeMerchizeApi.js --externalOrderId=<externalOrderId>');

  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/order/external/orders/tracking`);
  url.searchParams.set('external_number', externalOrderId);

  const { statusCode, json, raw } = await getJson(url, token);
  const first = Array.isArray(json?.data) ? json.data[0] : json?.data;
  console.log(JSON.stringify({
    provider: 'MERCHIZE',
    path: `${url.pathname}${url.search}`,
    statusCode,
    success: json?.success ?? null,
    message: json?.message || json?.error || null,
    dataLength: Array.isArray(json?.data) ? json.data.length : null,
    tracking: first ? {
      status: first.status || null,
      shipmentStatus: first.shipment_status || null,
      carrier: first.tracking_company || null,
      trackingNumber: first.tracking_number || null,
      trackingUrl: first.tracking_url || null,
    } : null,
    nonJsonPrefix: json ? null : raw.slice(0, 80),
  }, null, 2));

  if (statusCode < 200 || statusCode >= 300 || json?.success === false) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
