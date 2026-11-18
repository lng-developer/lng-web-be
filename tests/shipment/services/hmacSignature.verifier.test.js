const crypto = require('crypto');
const { verifyHmacSignature } = require('../../../src/modules/shipment/services/vendorWebhookVerifiers/hmacSignature.verifier');

const secret = 'test-webhook-secret';
const rawBody = '{"eventType":"carrier_handoff_confirmed"}';

function sign(value) {
  return crypto.createHmac('sha256', secret).update(value, 'utf8').digest('hex');
}

describe('hmacSignature.verifier', () => {
  it('accepts a valid signature calculated from the unparsed request body', () => {
    expect(verifyHmacSignature({
      rawBody: Buffer.from(rawBody),
      body: { eventType: 'carrier_handoff_confirmed' },
      headers: { 'x-lng-signature': `sha256=${sign(rawBody)}` },
    }, secret)).toBe(true);
  });

  it('rejects a signature when the raw payload was changed', () => {
    expect(verifyHmacSignature({
      rawBody: Buffer.from('{"eventType":"changed"}'),
      headers: { 'x-lng-signature': sign(rawBody) },
    }, secret)).toBe(false);
  });

  it('rejects stale signed events', () => {
    expect(verifyHmacSignature({
      rawBody: Buffer.from(rawBody),
      headers: {
        'x-lng-signature': sign(rawBody),
        'x-lng-event-timestamp': String(Math.floor(Date.now() / 1000) - 301),
      },
    }, secret)).toBe(false);
  });
});
