const repository = require('../repositories/listingContent.repository');
const adapter = require('../adapters/openaiContent.adapter');
const queue = require('../queues/listingContent.queue');
const { validateContent } = require('./listingContentValidation');
const AppError = require('../../../shared/errors/appError');
const logger = require('../../../shared/utils/logger');

const providerCodes = new Set(['REFUSED', 'INCOMPLETE', 'INVALID_RESPONSE', 'UNAUTHORIZED', 'RATE_LIMITED', 'UNAVAILABLE', 'ERROR', 'TIMEOUT', 'ABORTED'].map((code) => `CONTENT_PROVIDER_${code}`));
const fieldCodes = new Set(['INVALID_OBJECT', 'UNKNOWN_FIELDS', 'REQUIRED_TEXT', 'TEXT_LIMIT', 'ITEM_COUNT', 'DUPLICATE_TERM', 'UTF8_LIMIT', 'COLOR_NOT_ALLOWED', 'DUPLICATE_COLOR']);
function safeMetadata(value = {}) {
  const tokens = (count) => Number.isSafeInteger(count) && count >= 0 ? count : null;
  return {
    usage: value.usage ? { inputTokens: tokens(value.usage.inputTokens), outputTokens: tokens(value.usage.outputTokens), totalTokens: tokens(value.usage.totalTokens) } : null,
    providerRequestId: typeof value.providerRequestId === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(value.providerRequestId) ? value.providerRequestId : null,
  };
}

function safeFailure(error) {
  let errorCode = 'CONTENT_GENERATION_FAILED';
  let errorMessage = 'Content generation failed';
  let validationErrors = [];
  if (error instanceof AppError) {
    if (providerCodes.has(error.code)) { errorCode = error.code; errorMessage = 'Content provider request failed'; }
    if (error.code === 'CONTENT_GENERATION_UNAVAILABLE') { errorCode = error.code; errorMessage = 'Content generation is not configured'; }
    if (error.code === 'CONTENT_GENERATION_LEASE_EXPIRED') { errorCode = error.code; errorMessage = 'Content generation lease expired'; }
    if (error.code === 'CONTENT_VALIDATION_FAILED') {
      errorCode = error.code;
      errorMessage = 'Content failed validation';
      validationErrors = (Array.isArray(error.details?.fieldErrors) ? error.details.fieldErrors : []).slice(0, 20)
        .filter((item) => /^(content|title|bullets(?:\[\d{1,2}\])?|searchTerms(?:\[\d{1,2}\])?|recommendedColors(?:\[\d\](?:\.(?:code|reason))?)?)$/.test(item?.field) && fieldCodes.has(item?.code))
        .map(({ field, code }) => ({ field, code, message: code === 'COLOR_NOT_ALLOWED' ? 'Color code must exactly match an allowed color.' : 'Content field failed validation.' }));
    }
  }
  return { ...safeMetadata(error || {}), errorCode, errorMessage, validationErrors };
}

async function processGeneration(runId) {
  let run;
  let result;
  try {
    run = await repository.claimGeneration(runId);
    if (!run) return null;
    result = await adapter.generateContent({ snapshot: run.inputSnapshot, model: run.model });
    const content = validateContent(result.content, run.inputSnapshot);
    return await repository.completeGeneration(run, { content, ...safeMetadata(result) });
  } catch (error) {
    const failure = safeFailure(error);
    if (result) Object.assign(failure, safeMetadata(result));
    if (run) {
      try { await repository.failGeneration(run, failure); }
      catch { logger.error('listing_content_failure_persistence_failed', { runId: String(run._id) }); }
    }
    throw new AppError(failure.errorMessage, 502, true, failure.errorCode);
  }
}

async function dispatchGeneration(runId) {
  try {
    await queue.enqueueGeneration(runId);
    await repository.setDispatchError(runId, false);
    return null;
  } catch {
    try { await repository.setDispatchError(runId, true); }
    catch { logger.error('listing_content_dispatch_persistence_failed', { runId }); }
    return 'Content generation is queued; dispatch will be retried';
  }
}

async function recoverGenerationRuns({ signal } = {}) {
  if (signal?.aborted) return { expired: 0, queued: 0, dispatchFailures: 0 };
  const expired = await repository.failExpiredGenerations();
  if (signal?.aborted) return { expired, queued: 0, dispatchFailures: 0 };
  try { await queue.assertQueueReady(); }
  catch { return { expired, queued: 0, dispatchFailures: 0, unavailable: true }; }
  if (signal?.aborted) return { expired, queued: 0, dispatchFailures: 0 };
  const runs = await repository.findQueuedGenerations();
  let dispatchFailures = 0;
  for (const run of runs) {
    if (signal?.aborted) break;
    if (await dispatchGeneration(String(run._id))) dispatchFailures += 1;
  }
  return { expired, queued: runs.length, dispatchFailures };
}

module.exports = { processGeneration, dispatchGeneration, recoverGenerationRuns };
