const { normalizeProviderKey } = require('./vendorTrackingNormalizer.service');
const { verifySharedSecret } = require('./vendorWebhookVerifiers/sharedSecret.verifier');

function verifyVendorWebhook(provider, req) {
  const normalizedProvider = normalizeProviderKey(provider);
  const secret = process.env[`VENDOR_WEBHOOK_SECRET_${normalizedProvider}`];
  return Boolean(secret) && verifySharedSecret(req, secret);
}

module.exports = { verifyVendorWebhook };
