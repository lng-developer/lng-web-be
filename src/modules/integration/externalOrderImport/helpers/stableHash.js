const crypto = require('crypto');

function stableStringify(value) {
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    )).join(',')}}`;
  }

  return JSON.stringify(value);
}

function sha256(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

function calculateRecordHash(rawRecord) {
  return sha256(stableStringify(rawRecord));
}

function calculateFileHash(bufferOrString) {
  return sha256(Buffer.isBuffer(bufferOrString) ? bufferOrString : Buffer.from(String(bufferOrString || '')));
}

module.exports = {
  stableStringify,
  calculateRecordHash,
  calculateFileHash,
};
