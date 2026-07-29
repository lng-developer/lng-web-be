const crypto = require('crypto');

function requestContext(req, res, next) {
  const supplied = req.headers['x-request-id'];
  const normalized = typeof supplied === 'string' ? supplied.trim() : '';
  const requestId = normalized && normalized.length <= 200 ? normalized : crypto.randomUUID();

  req.id = requestId;
  res.setHeader('X-Request-Id', requestId);

  next();
}

module.exports = requestContext;
