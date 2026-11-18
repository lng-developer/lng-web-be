const crypto = require('crypto');

const MAX_TIMESTAMP_DRIFT_SEC = 300; // 5 minutes

function verifyHmacSignature(req, expectedSecret) {
  const signatureHeader = req.headers?.['x-lng-signature'];
  if (!signatureHeader || !expectedSecret) return false;

  const actualSig = signatureHeader.replace(/^sha256=/i, '').trim();
  const rawBody = req.rawBody ? req.rawBody.toString('utf8') : JSON.stringify(req.body || {});

  const expectedSig = crypto
    .createHmac('sha256', expectedSecret)
    .update(rawBody, 'utf8')
    .digest('hex');

  const left = Buffer.from(actualSig, 'utf8');
  const right = Buffer.from(expectedSig, 'utf8');

  if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
    return false;
  }

  const timestampHeader = req.headers?.['x-lng-event-timestamp'];
  if (timestampHeader) {
    const timestampSec = parseInt(timestampHeader, 10);
    const nowSec = Math.floor(Date.now() / 1000);
    if (!Number.isNaN(timestampSec) && Math.abs(nowSec - timestampSec) > MAX_TIMESTAMP_DRIFT_SEC) {
      return false;
    }
  }

  return true;
}

module.exports = { verifyHmacSignature };
