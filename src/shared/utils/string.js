function normalizeUppercase(value) {
  return String(value).trim().toUpperCase();
}

function normalizeLowercase(value) {
  return String(value).trim().toLowerCase();
}

module.exports = {
  normalizeUppercase,
  normalizeLowercase,
};
