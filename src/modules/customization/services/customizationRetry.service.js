const payloadService = require('./customizationPayload.service');
const parseService = require('./customizationParse.service');

async function retryCustomization(payloadId, authContext) {
  const payload = await payloadService.prepareRetry(payloadId, authContext);
  const updated = await parseService.parseForOrderItem(payload.orderItemId);
  return { action: 'PARSE', payload: updated };
}

module.exports = { retryCustomization };
