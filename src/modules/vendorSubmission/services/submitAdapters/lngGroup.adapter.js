const AppError = require('../../../../shared/errors/appError');
const errorCodes = require('../../../../shared/constants/errorCodes');
const httpStatus = require('../../../../shared/constants/httpStatus');

const PROVIDER = 'LNG_GROUP';

function buildPayload(submission = {}) {
  const order = submission.payloadSnapshot?.fulfillmentOrder;
  if (!order) return { orders: [] };
  return { orders: [order] };
}

function validatePayload(payload = {}) {
  const order = payload.orders?.[0];
  const missing = [
    !order?.externalOrderId && 'orders[0].externalOrderId',
    !order?.items?.length && 'orders[0].items',
  ].filter(Boolean);
  if (missing.length) {
    throw new AppError(`LNG Group payload is missing required fields: ${missing.join(', ')}`,
      httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR, { missing });
  }
}

async function submitPayload(payload, { credential } = {}) {
  validatePayload(payload);
  const baseUrl = String(credential?.baseUrl || '').replace(/\/+$/, '');
  const accessToken = credential?.accessToken;
  if (!baseUrl || !accessToken) {
    throw new AppError('LNG Group credentials are not configured', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  }
  const response = await fetch(`${baseUrl}/api/portal/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await response.json().catch(async () => ({ message: await response.text().catch(() => '') }));
  const acceptance = body?.data?.acceptances?.[0];
  if (!response.ok || !acceptance?.fulfillmentOrderId || !['accepted', 'duplicate'].includes(acceptance.disposition)) {
    throw new AppError('LNG Group rejected order', httpStatus.CONFLICT, true, errorCodes.CONFLICT_ERROR, {
      statusCode: response.status,
      message: body?.error?.message || body?.message || null,
      response: body,
    });
  }
  return { provider: PROVIDER, externalId: acceptance.fulfillmentOrderId, response: body };
}

module.exports = { buildPayload, provider: PROVIDER, submitPayload, validatePayload };
