const config = require('../../../config');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { isDuplicateKeyError } = require('../../../shared/utils/mongo');
const orderAccess = require('./orderAccess.service');
const authPublic = require('../../auth/public');
const orderItemRepository = require('../repositories/orderItem.repository');
const repository = require('../repositories/orderRecheckJob.repository');
const queue = require('./orderRecheckJobQueue.service');

function toId(value) { return value === undefined || value === null ? null : String(value._id || value.id || value); }
function activeKey(type, orderItemId) { return `${type}:${orderItemId}`; }
const permissionsByType = { MAPPING: 'MAPPING:WRITE', PRODUCTION: 'PRODUCTION:WRITE' };
const PROCESSING_STALE_MS = 5 * 60 * 1000;
function toDto(job, reused = false) {
  return job && { id: toId(job), orderItemId: toId(job.orderItemId), type: job.type, status: job.status, result: job.result || null, errorMessage: job.errorMessage || null, startedAt: job.startedAt || null, finishedAt: job.finishedAt || null, reused };
}
function unavailable() { return new AppError('Recheck queue is unavailable', httpStatus.SERVICE_UNAVAILABLE, true, errorCodes.INTERNAL_SERVER_ERROR); }
function assertCanRequest(type, shopId, authContext = {}) {
  const permission = permissionsByType[type];
  if (!permission) throw new AppError('Unsupported recheck type', httpStatus.BAD_REQUEST, true, errorCodes.VALIDATION_ERROR);
  if (authContext.system || authPublic.canAccessScope(authContext, permission, { scopeType: 'shop', scopeId: shopId })) return;
  throw new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
}

async function enqueueExistingJob(job) {
  try {
    await queue.enqueue(job._id || job.id);
  } catch (_) {
    throw unavailable();
  }
}

async function requestRecheckJob(orderItemId, type, authContext = {}) {
  if (!config.redis.enabled) throw unavailable();
  const item = await orderItemRepository.findById(orderItemId);
  if (!item) throw new AppError('Order item not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  assertCanRequest(type, item.shopId, authContext);
  const key = activeKey(type, toId(item));
  const existing = await repository.findActive(key);
  if (existing) {
    const staleBefore = new Date(Date.now() - PROCESSING_STALE_MS);
    const recovered = existing.status === 'PROCESSING'
      && (!existing.startedAt || new Date(existing.startedAt) <= staleBefore)
      ? await repository.requeueStale(existing._id || existing.id, staleBefore)
      : existing;
    if (recovered?.status === 'QUEUED') await enqueueExistingJob(recovered);
    return toDto(recovered || existing, true);
  }
  let job;
  try {
    job = await repository.create({ orderItemId: toId(item), shopId: toId(item.shopId), type, activeKey: key, requestedBy: authContext.accountId || null });
  } catch (error) {
    if (!isDuplicateKeyError(error)) throw error;
    const existingJob = await repository.findActive(key);
    if (existingJob) return toDto(existingJob, true);
    throw error;
  }
  try {
    await enqueueExistingJob(job);
  } catch (error) {
    await repository.fail(job._id || job.id, 'Queue unavailable');
    throw unavailable();
  }
  return toDto(job);
}

async function getRecheckJob(jobId, authContext = {}) {
  const job = await repository.findById(jobId);
  if (!job) throw new AppError('Recheck job not found', httpStatus.NOT_FOUND, true, errorCodes.RESOURCE_NOT_FOUND);
  orderAccess.assertCanReadShop(job.shopId, authContext);
  return toDto(job);
}

async function processRecheckJob(jobId) {
  const job = await repository.claim(jobId);
  if (!job) return null;
  const authContext = { system: true, accountId: job.requestedBy || null, source: 'ORDER_RECHECK_JOB' };
  try {
    const result = job.type === 'MAPPING'
      ? await require('../../mapping/public').recheckFulfillmentPlan(toId(job.orderItemId), { deferSideEffects: true, refreshOrderStatus: true }, authContext)
      : await require('../../production/public').createOrRecheckTaskForOrderItem(toId(job.orderItemId), authContext);
    return toDto(await repository.complete(jobId, result));
  } catch (error) {
    await repository.fail(jobId, String(error.message || 'Recheck failed').slice(0, 500));
    throw error;
  }
}

module.exports = { requestRecheckJob, getRecheckJob, processRecheckJob };
