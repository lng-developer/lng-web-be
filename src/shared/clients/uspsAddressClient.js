function clientError(message, code) {
  return Object.assign(new Error(message), { code });
}

function requireEnv(name) {
  if (!process.env[name]) throw clientError(`${name} is required`, 'USPS_CONFIG_MISSING');
  return process.env[name];
}

async function getAccessToken() {
  const baseUrl = process.env.USPS_API_BASE_URL || 'https://apis.usps.com';
  const response = await fetch(`${baseUrl}/oauth2/v3/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credentials',
      client_id: requireEnv('USPS_CLIENT_ID'),
      client_secret: requireEnv('USPS_CLIENT_SECRET'),
    }),
  });
  if (!response.ok) throw clientError(`USPS token request failed with HTTP ${response.status}`, 'USPS_REQUEST_FAILED');
  const body = await response.json();
  if (!body.access_token) throw clientError('USPS token response is missing access_token', 'USPS_INVALID_RESPONSE');
  return body.access_token;
}

async function validateUsAddress(address = {}) {
  const baseUrl = process.env.USPS_API_BASE_URL || 'https://apis.usps.com';
  const token = await getAccessToken();
  const url = new URL(`${baseUrl}/addresses/v3/address`);
  url.searchParams.set('streetAddress', [address.addressLine1, address.addressLine2].filter(Boolean).join(' '));
  url.searchParams.set('city', address.city || '');
  url.searchParams.set('state', address.stateOrProvinceCode || address.stateOrProvince || '');
  url.searchParams.set('ZIPCode', address.postalCode || '');

  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw clientError(`USPS address request failed with HTTP ${response.status}`, 'USPS_REQUEST_FAILED');
  return response.json();
}

module.exports = { validateUsAddress };
