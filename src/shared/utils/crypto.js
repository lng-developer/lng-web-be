const crypto = require('crypto');
const { promisify } = require('util');

const scryptAsync = promisify(crypto.scrypt);

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

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = await scryptAsync(password, salt, 64);

  return {
    passwordHash: derivedKey.toString('hex'),
    passwordSalt: salt,
  };
}

async function verifyPassword(password, passwordHash, passwordSalt) {
  const derivedKey = await scryptAsync(password, passwordSalt, 64);
  const storedHash = Buffer.from(passwordHash, 'hex');

  if (storedHash.length !== derivedKey.length) {
    return false;
  }

  return crypto.timingSafeEqual(storedHash, derivedKey);
}

module.exports = {
  hashString,
  generateRandomToken,
  hashPassword,
  verifyPassword,
};
