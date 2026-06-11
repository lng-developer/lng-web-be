const crypto = require('crypto');

function hashString(value) {
  return crypto
    .createHash('sha256')
    .update(String(value))
    .digest('hex');
}

function generateRandomToken(byteLength = 32) {
  if (!Number.isInteger(byteLength) || byteLength <= 0) {
    throw new RangeError('byteLength must be a positive integer');
  }

  return crypto.randomBytes(byteLength).toString('hex');
}

module.exports = {
  hashString,
  generateRandomToken,
};
