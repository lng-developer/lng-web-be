const https = require('https');

function requestJson(url, { method = 'GET', token, body = null, signal } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'cache-control': 'no-cache',
    };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const request = https.request(url, {
      method,
      headers,
      timeout: 20000,
      ...(signal && { signal }),
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
        if (signal && response.statusCode === 429) {
          const error = new Error('Vendor tracking rate limited');
          error.vendorHttpStatus = 429;
          error.retryAfter = response.headers?.['retry-after'];
          reject(error);
          return;
        }
        resolve({ statusCode: response.statusCode, json, raw });
      });
    });

    request.on('timeout', () => request.destroy(new Error('Vendor tracking request timeout')));
    request.on('error', reject);
    if (payload) request.write(payload);
    request.end();
  });
}

module.exports = requestJson;
