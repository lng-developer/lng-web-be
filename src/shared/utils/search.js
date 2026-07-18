function normalizeSearchTerm(value, { maxLength = 80 } = {}) {
  if (value === undefined || value === null) {
    return '';
  }

  return String(value).trim().slice(0, maxLength);
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildPrefixRegex(value) {
  const normalizedValue = normalizeSearchTerm(value);

  if (!normalizedValue) {
    return null;
  }

  return new RegExp(`^${escapeRegex(normalizedValue)}`);
}

function buildCaseInsensitivePrefixRegex(value) {
  const normalizedValue = normalizeSearchTerm(value);

  if (!normalizedValue) {
    return null;
  }

  return new RegExp(`^${escapeRegex(normalizedValue)}`, 'i');
}

function buildCaseInsensitiveContainsRegex(value) {
  const normalizedValue = normalizeSearchTerm(value);

  if (!normalizedValue) {
    return null;
  }

  return new RegExp(escapeRegex(normalizedValue), 'i');
}

module.exports = {
  normalizeSearchTerm,
  escapeRegex,
  buildPrefixRegex,
  buildCaseInsensitivePrefixRegex,
  buildCaseInsensitiveContainsRegex,
};
