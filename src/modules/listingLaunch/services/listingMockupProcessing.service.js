const crypto = require('node:crypto');
const repository = require('../repositories/listingMockupAnalysis.repository');
const media = require('../../media/public');
const adapter = require('../adapters/openaiMockup.adapter');
const queue = require('../queues/listingMockup.queue');
const { assertSourceAsset } = require('./listingMockupAnalysis.service');
const { validateMockupAnalysis } = require('./listingMockupValidation');
const { maxBytes } = require('../constants/listingMockup.constants');
const AppError = require('../../../shared/errors/appError');
const logger = require('../../../shared/utils/logger');
function safeMetadata(value = {}) {
  const count = x => Number.isSafeInteger(x) && x >= 0 ? x : null;
  return { usage: value.usage ? { inputTokens: count(value.usage.inputTokens), outputTokens: count(value.usage.outputTokens), totalTokens: count(value.usage.totalTokens) } : null,
    providerRequestId: /^[a-zA-Z0-9_-]{1,200}$/.test(value.providerRequestId || '') ? value.providerRequestId : null };
}
async function processAnalysis(runId) {
  let run, response;
  try {
    run = await repository.claimAnalysis(runId);
    if (!run) return null;
    const { buffer, mediaAsset } = await media.readAuthenticatedAssetBuffer(String(run.assetId), { maxBytes, timeoutMs: 15000 });
    assertSourceAsset(mediaAsset, { _id: run.launchId, shopId: run.shopId, mockupAssetId: run.assetId });
    if (mediaAsset.sha256 !== run.assetHash || crypto.createHash('sha256').update(buffer).digest('hex') !== run.assetHash) throw new AppError('Mockup changed', 409, true, 'MOCKUP_ASSET_CHANGED');
    response = await adapter.analyzeMockup({ buffer, model: run.model });
    const result = validateMockupAnalysis(response.result);
    const completed = await repository.completeAnalysis(run, { result, ...safeMetadata(response) });
    if (!completed) throw new AppError('Analysis lease expired', 409, true, 'WORKER_INTERRUPTED');
    return completed;
  } catch (error) {
    const allowed = ['MOCKUP_ASSET_CHANGED', 'MOCKUP_PROVIDER_TIMEOUT', 'MOCKUP_PROVIDER_ERROR', 'MOCKUP_VALIDATION_FAILED', 'MOCKUP_ANALYSIS_UNAVAILABLE', 'WORKER_INTERRUPTED'];
    const errorCode = error instanceof AppError && allowed.includes(error.code) ? error.code : 'MOCKUP_PROVIDER_ERROR';
    const validationErrors = errorCode === 'MOCKUP_VALIDATION_FAILED' ? (error.details?.fieldErrors || []).slice(0, 20)
      .filter(x => ['result', 'detectedText', 'theme', 'designDescription', 'suggestedKeyword', 'warnings'].includes(x.field) && ['INVALID_OBJECT', 'TEXT_LIMIT', 'INVALID_ENUM'].includes(x.code))
      .map(({ field, code }) => ({ field, code, message: 'Analysis field failed validation' })) : [];
    if (run) {
      try { await repository.failAnalysis(run, { errorCode, errorMessage: 'Mockup analysis failed; review the error code before retrying', validationErrors, ...safeMetadata(response || error) }); }
      catch { logger.error('mockup_failure_persistence_failed', { runId: String(run._id) }); }
    }
    throw new AppError('Mockup analysis failed', 502, true, errorCode);
  }
}
async function dispatchAnalysis(runId) {
  try { await queue.enqueueAnalysis(runId); await repository.setDispatchError(runId, false); return null; }
  catch {
    try { await repository.setDispatchError(runId, true); } catch { logger.error('mockup_dispatch_persistence_failed', { runId }); }
    return 'Analysis is queued; dispatch will be retried';
  }
}
async function recoverAnalyses({ signal } = {}) {
  if (signal?.aborted) return;
  await repository.failExpiredAnalyses();
  if (signal?.aborted) return;
  try { await queue.assertQueueReady(); } catch { return; }
  if (signal?.aborted) return;
  for (const run of await repository.findQueuedAnalyses()) {
    if (signal?.aborted) break;
    await dispatchAnalysis(String(run._id));
  }
}
module.exports = { processAnalysis, dispatchAnalysis, recoverAnalyses };
