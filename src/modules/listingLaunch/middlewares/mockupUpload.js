const multer = require('multer');
const AppError = require('../../../shared/errors/appError');
const { assertUploadAllowed } = require('../services/listingMockup.service');
const { maxBytes } = require('../constants/listingMockup.constants');

function createMockupRateLimit() {
  // ponytail: per-process pilot limit; use Redis counters before multi-instance rollout.
  const windows = new Map();
  return (req, res, next) => {
    const now = Date.now();
    for (const [key, value] of windows) if (value.until <= now) windows.delete(key);
    const key = String(req.auth.accountId);
    const window = windows.get(key) || { until: now + 60000, count: 0 };
    if (window.count >= 10 || (!windows.has(key) && windows.size >= 10000)) {
      return next(new AppError('Too many mockup requests; try again later', 429, true, 'RATE_LIMIT_EXCEEDED'));
    }
    window.count += 1;
    windows.set(key, window);
    return next();
  };
}
const parser = multer({ storage: multer.memoryStorage(), limits: { fileSize: maxBytes, files: 1, fields: 2, parts: 3, fieldSize: 32, fieldNameSize: 64 } }).single('file');
function parseMockup(req, res, next) {
  parser(req, res, (error) => {
    if (error) return next(new AppError('Invalid mockup upload', error.code === 'LIMIT_FILE_SIZE' ? 413 : 400, true,
      error.code === 'LIMIT_FILE_SIZE' ? 'MOCKUP_IMAGE_TOO_LARGE' : 'MOCKUP_IMAGE_INVALID'));
    return next();
  });
}
async function authorizeMockupUpload(req, res, next) { await assertUploadAllowed(req.params.id, req.auth); next(); }
module.exports = { createMockupRateLimit, parseMockup, authorizeMockupUpload };
