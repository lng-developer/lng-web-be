function isDuplicateKeyError(error) {
  return Boolean(error && error.code === 11000);
}

module.exports = {
  isDuplicateKeyError,
};
