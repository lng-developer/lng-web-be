const config = require('../../../config');
const AppError = require('../../../shared/errors/appError');
const { maxBytes } = require('../constants/listingMockup.constants');
const { buildRequest } = require('../prompts/mockupAnalysis.v1');
const { validateMockupAnalysis } = require('../services/listingMockupValidation');
const { requestStructuredResponse } = require('./openaiResponses.transport');
async function analyzeMockup({ buffer, model = config.listingMockupAnalysis?.model, signal }) {
  if (!config.listingMockupAnalysis?.enabled || !model || !config.listingContent.apiKey) throw new AppError('Mockup analysis is not configured', 503, true, 'MOCKUP_ANALYSIS_UNAVAILABLE');
  if (!Buffer.isBuffer(buffer) || !buffer.length || buffer.length > maxBytes) throw new AppError('Invalid mockup bytes', 400, true, 'MOCKUP_IMAGE_INVALID');
  let response;
  try {
    response = await requestStructuredResponse({ body: buildRequest(buffer, model), apiKey: config.listingContent.apiKey, timeoutMs: 90000, signal });
    return { result: validateMockupAnalysis(response.parsed), usage: response.usage, providerRequestId: response.providerRequestId };
  } catch (error) {
    const safe = error.code === 'MOCKUP_VALIDATION_FAILED' ? error : new AppError('Mockup provider request failed', 502, true,
      error.code === 'CONTENT_PROVIDER_TIMEOUT' ? 'MOCKUP_PROVIDER_TIMEOUT' : 'MOCKUP_PROVIDER_ERROR');
    safe.usage = response?.usage || error.usage || null;
    safe.providerRequestId = response?.providerRequestId || error.providerRequestId || null;
    throw safe;
  }
}
module.exports = { analyzeMockup };
