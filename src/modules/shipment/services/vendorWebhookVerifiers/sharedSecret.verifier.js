const crypto = require('crypto');

function equalSecret(actual, expected) {
  const left = Buffer.from(String(actual || ''));
  const right = Buffer.from(String(expected || ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function verifySharedSecret(req, expected) {
  return equalSecret(req.headers?.['x-vendor-webhook-secret'], expected);
}

module.exports = { equalSecret, verifySharedSecret };
