function clientError(message, code) {
  return Object.assign(new Error(message), { code });
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw clientError(`${name} is required`, 'SMARTY_CONFIG_MISSING');
  }
  return value;
}

function buildStreetAddressUrl(address = {}) {
  const url = new URL('https://us-street.api.smarty.com/street-address');
  url.searchParams.set('auth-id', requireEnv('SMARTY_AUTH_ID'));
  url.searchParams.set('auth-token', requireEnv('SMARTY_AUTH_TOKEN'));
  if (process.env.SMARTY_LICENSE) {
    url.searchParams.set('license', process.env.SMARTY_LICENSE);
  }
  url.searchParams.set('street', [
    address.addressLine1,
    address.addressLine2,
    address.addressLine3,
  ].filter(Boolean).join(' '));
  url.searchParams.set('city', address.city || '');
  url.searchParams.set('state', address.stateOrProvinceCode || address.stateOrProvince || '');
  url.searchParams.set('zipcode', address.postalCode || '');
  url.searchParams.set('candidates', '3');
  url.searchParams.set('match', 'enhanced');
  return url;
}

async function validateUsStreetAddress(address) {
  const response = await fetch(buildStreetAddressUrl(address));
  const body = await response.text();

  if (!response.ok) {
    throw clientError(`Smarty returned HTTP ${response.status}`, 'SMARTY_REQUEST_FAILED');
  }

  try {
    return JSON.parse(body);
  } catch (error) {
    throw clientError('Smarty returned invalid JSON', 'SMARTY_INVALID_RESPONSE');
  }
}

module.exports = {
  validateUsStreetAddress,
  buildStreetAddressUrl,
};
