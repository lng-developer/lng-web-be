const crypto = require('crypto');
const config = require('../../../../config');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function getSecretKey() {
  const secret = config.teams.encryptionKey || config.auth.jwtAccessSecret || 'default-teams-secret-key-32b!';
  return crypto.createHash('sha256').update(String(secret)).digest();
}

function encrypt(plainText) {
  if (!plainText) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, getSecretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decrypt(cipherText) {
  if (!cipherText) return null;
  try {
    const buffer = Buffer.from(cipherText, 'base64');
    if (buffer.length < IV_LENGTH + TAG_LENGTH) return null;
    const iv = buffer.subarray(0, IV_LENGTH);
    const tag = buffer.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
    const encrypted = buffer.subarray(IV_LENGTH + TAG_LENGTH);
    const decipher = crypto.createDecipheriv(ALGORITHM, getSecretKey(), iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8');
  } catch (_err) {
    return null;
  }
}

module.exports = {
  encrypt,
  decrypt,
};
