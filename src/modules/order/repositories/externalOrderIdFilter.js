const { escapeRegex } = require('../../../shared/utils/search');

function externalOrderIdFilter(value) {
  const term = String(value).trim();
  if (/^\d{3}-\d{7}-\d{7}$/.test(term)) return term;
  return { $regex: escapeRegex(value), $options: 'i' };
}

module.exports = { externalOrderIdFilter };
