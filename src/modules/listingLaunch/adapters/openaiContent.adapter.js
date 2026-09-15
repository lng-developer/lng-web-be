const config = require('../../../config');
const AppError = require('../../../shared/errors/appError');
const { buildRequest } = require('../prompts/amazonContent.v1');
const { validateContent } = require('../services/listingContentValidation');
const { requestStructuredResponse } = require('./openaiResponses.transport');
async function generateContent({ snapshot, model = config.listingContent.model, signal }) {
  const { enabled, apiKey, timeoutMs } = config.listingContent;
  if (!enabled || !apiKey || !model || !config.listingContent.model) throw new AppError('Content generation is not configured', 503, true, 'CONTENT_GENERATION_UNAVAILABLE');
  const response = await requestStructuredResponse({ body: buildRequest(snapshot, model), apiKey, timeoutMs, signal });
  try { return { content: validateContent(response.parsed, snapshot), usage: response.usage, providerRequestId: response.providerRequestId }; }
  catch (error) { error.usage = response.usage; error.providerRequestId = response.providerRequestId; throw error; }
}
module.exports = { generateContent };
