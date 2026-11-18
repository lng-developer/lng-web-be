const { normalizeProviderKey } = require('./vendorTrackingNormalizer.service');
const { verifySharedSecret } = require('./vendorWebhookVerifiers/sharedSecret.verifier');
const { verifyHmacSignature } = require('./vendorWebhookVerifiers/hmacSignature.verifier');

function verifyVendorWebhook(provider, req) {
  const normalizedProvider = normalizeProviderKey(provider);
  const secret = process.env[`VENDOR_WEBHOOK_SECRET_${normalizedProvider}`]
    || (normalizedProvider === 'LNG_GROUP' ? process.env.FULFILLMENT_LIFECYCLE_WEBHOOK_SECRET : null)
    || process.env.VENDOR_WEBHOOK_SECRET;

  if (!secret) return false;
  if (req.headers?.['x-lng-signature']) {
    return verifyHmacSignature(req, secret);
  }
  return verifySharedSecret(req, secret);
}

module.exports = { verifyVendorWebhook };
