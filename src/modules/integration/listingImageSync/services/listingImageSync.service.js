const { randomUUID } = require('crypto');
const AppError = require('../../../../shared/errors/appError');
const errorCodes = require('../../../../shared/constants/errorCodes');
const { hashString } = require('../../../../shared/utils/crypto');
const logger = require('../../../../shared/utils/logger');
const authPublic = require('../../../auth/public');
const catalog = require('../../../catalog/public');
const media = require('../../../media/public');
const commands = require('../../extensionCommand/repositories/extensionCommand.repository');
const repository = require('../repositories/listingImageSync.repository');
const { jobDto, scheduleDto, itemDto } = require('../dtos/listingImageSync.dto');

const conflict = (message) => new AppError(message, 409, true, errorCodes.CONFLICT_ERROR);
const forbidden = () => new AppError('Forbidden', 403, true, errorCodes.AUTHORIZATION_ERROR);
const notFound = () => new AppError('Image sync job or agent not found', 404, true, errorCodes.RESOURCE_NOT_FOUND);
const scope = (shopId) => ({ scopeType: 'shop', scopeId: String(shopId) });
const allowed = (auth, shopId, permission) => auth?.tokenType !== 'EXTENSION' && authPublic.canAccessScope(auth, permission, scope(shopId));
function assertWrite(auth, shopId) { if (!allowed(auth, shopId, 'CATALOG:WRITE')) throw forbidden(); }
function assertSupported(agent, now) {
  if (!agent?.listingImageSync) throw conflict('AGENT_UNSUPPORTED');
  if (!agent.lastSeenAt || now - new Date(agent.lastSeenAt) > 90000) throw conflict('AGENT_OFFLINE');
}
async function visibleShopIds(auth) {
  if (auth?.tokenType === 'EXTENSION') throw forbidden();
  return [...new Set((await commands.listAgents({})).filter((agent) => allowed(auth, agent.shopId, 'CATALOG:READ') || allowed(auth, agent.shopId, 'CATALOG:WRITE')).map((agent) => String(agent.shopId)))];
}
async function listJobs(input, auth) {
  const result = await repository.listJobs({ ...input, shopIds: await visibleShopIds(auth) });
  return { ...result, items: result.items.map(jobDto) };
}
async function listSchedules(auth) { return { items: (await repository.listSchedules(await visibleShopIds(auth))).map(scheduleDto) }; }
async function upsertSchedule(agentId, { enabled }, auth) {
  const agent = await commands.findAgentById(agentId);
  if (!agent) throw notFound();
  assertWrite(auth, agent.shopId);
  if (enabled && !agent.listingImageSync) throw conflict('AGENT_UNSUPPORTED');
  return scheduleDto(await repository.upsertSchedule(agent, enabled, new Date()));
}
async function enqueue(agent, manual, now, asins) {
  const candidates = await catalog.findImageSyncCandidates({ shopId: agent.shopId, now, manual, asins });
  if (candidates.length > 10000) throw conflict('JOB_TOO_LARGE: image sync supports at most 10000 listings per job');
  if (!candidates.length) {
    if (manual) throw conflict('NO_ELIGIBLE_LISTINGS');
    return null;
  }
  try { return await repository.createJob({ shopId: agent.shopId, agentId: agent._id, candidates }); }
  catch (error) { if (error.code === 11000) throw conflict('An image sync job is already active for this shop'); throw error; }
}
async function createJob({ shopId, agentId, asins }, auth) {
  assertWrite(auth, shopId);
  const agent = await commands.findAgentById(agentId);
  if (!agent || String(agent.shopId) !== String(shopId)) throw notFound();
  assertSupported(agent, new Date());
  const job = await enqueue(agent, true, new Date(), asins);
  await dispatchJob(job._id);
  return jobDto(await repository.findJob(job._id));
}
async function dispatchJob(jobId, now = new Date()) {
  const token = randomUUID();
  let job = await repository.acquireDispatch(jobId, token, now);
  if (!job) return;
  try {
    const agent = await commands.findAgentById(job.agentId);
    await commands.releaseExpired(job.agentId, now);
    if (job.batchCommandId) {
      const command = await commands.findCommandById(job.batchCommandId);
      if (command && ['QUEUED', 'CLAIMED', 'RUNNING'].includes(command.status)) return;
      if (command) job = await repository.clearBatch(job, token);
    }
    if (!job) return;
    const pending = job.items.filter((item) => item.status === 'PENDING');
    if (!pending.length) { await repository.finishJob(job._id); return; }
    if (!agent?.listingImageSync || String(agent.shopId) !== String(job.shopId) || !agent.lastSeenAt || now - new Date(agent.lastSeenAt) > 90000) return;
    if (await commands.hasActiveImportCommand(job.agentId)) return;
    if (!job.batchCommandId) job = await repository.reserveBatch(job, token, pending.slice(0, 25).map((item) => item._id));
    if (!job) return;
    try {
      await commands.createCommand({ _id: job.batchCommandId, type: 'SYNC_LISTING_IMAGES', shopId: job.shopId, agentId: job.agentId,
        imageSyncJobId: job._id, imageSyncItemIds: job.items.filter((item) => String(item.commandId) === String(job.batchCommandId)).map((item) => item._id), activeOrderKey: String(job.agentId) });
    } catch (error) { if (error.code !== 11000) throw error; }
  } finally { await repository.releaseDispatch(jobId, token); }
}
async function dispatch(now = new Date()) {
  for (const schedule of await repository.dueSchedules(now)) {
    if (!await repository.claimSchedule(schedule._id, now)) continue;
    try {
      const agent = await commands.findAgentById(schedule.agentId);
      assertSupported(agent, now);
      if (String(agent.shopId) !== String(schedule.shopId)) throw forbidden();
      await enqueue(agent, false, now);
    } catch (error) { await repository.scheduleError(schedule._id, String(error.message).slice(0, 1000)); }
  }
  for (const job of await repository.listActiveJobs()) {
    try { await dispatchJob(job._id, now); }
    catch (error) { logger.error('listing_image_sync_dispatch_failed', { jobId: String(job._id), error }); }
  }
}
async function changeJob(jobId, action, auth) {
  const job = await repository.findJob(jobId);
  if (!job) throw notFound();
  assertWrite(auth, job.shopId);
  if (action === 'pause' && !['QUEUED', 'RUNNING', 'PAUSED'].includes(job.status)) throw conflict('Only active jobs can be paused');
  if (action === 'resume' && job.status !== 'PAUSED') throw conflict('Only paused jobs can be resumed');
  if (action === 'retry' && !['PAUSED', 'COMPLETED_WITH_ERRORS'].includes(job.status)) throw conflict('Pause or finish the job before retrying failed items');
  try {
    if (!await repository.changeJob(job, action)) throw conflict('Job changed or has no failed items');
  } catch (error) { if (error.code === 11000) throw conflict('Another image sync job is active for this shop'); throw error; }
  if (action !== 'pause') await dispatchJob(jobId);
  return jobDto(await repository.findJob(jobId));
}
async function ownedCommand(commandId, input, auth) {
  if (auth?.tokenType !== 'EXTENSION' || !auth.extensionTokenId) throw forbidden();
  const agent = await commands.findAgentForToken(auth.extensionTokenId, input.clientId);
  if (!agent || !authPublic.canAccessScope(auth, 'ORDERS:WRITE', scope(agent.shopId))) throw forbidden();
  const command = await commands.findCommandById(commandId);
  if (!command || command.type !== 'SYNC_LISTING_IMAGES' || String(command.agentId) !== String(agent._id) || String(command.shopId) !== String(agent.shopId)
    || command.status !== 'RUNNING' || !command.leaseExpiresAt || new Date(command.leaseExpiresAt) <= new Date()
    || command.leaseTokenHash !== hashString(input.leaseToken)) throw conflict('Command lease expired or does not own this batch');
  const job = await repository.findJob(command.imageSyncJobId);
  if (!job || String(job.shopId) !== String(command.shopId) || String(job.agentId) !== String(command.agentId)) throw conflict('Command job ownership mismatch');
  return { command, job };
}
async function getCommandItems(commandId, input, auth) {
  const { command, job } = await ownedCommand(commandId, input, auth);
  const ids = new Set((command.imageSyncItemIds || []).map(String));
  return { jobId: String(job._id), status: job.status, items: job.status === 'PAUSED' ? [] : job.items.filter((item) => ids.has(String(item._id)) && String(item.commandId) === String(commandId) && item.status === 'PENDING').map(itemDto) };
}
async function pauseCommand(commandId, input, auth) {
  const { job } = await ownedCommand(commandId, input, auth);
  if (['QUEUED', 'RUNNING', 'PAUSED'].includes(job.status)) await repository.changeJob(job, 'pause', input.errorMessage || 'Amazon requires attention');
  return jobDto(await repository.findJob(job._id));
}
async function recordResult(commandId, itemId, input, file, auth) {
  const { command, job } = await ownedCommand(commandId, input, auth);
  const item = job.items.find((row) => String(row._id) === String(itemId));
  if (!item || !(command.imageSyncItemIds || []).some((id) => String(id) === String(itemId)) || String(item.commandId) !== String(commandId) || item.asin !== input.asin) throw conflict('Item or ASIN does not belong to this command');
  if (item.status !== 'PENDING') return { status: item.status };
  const token = randomUUID();
  if (!await repository.acquireItem(job._id, item._id, commandId, token, command.leaseExpiresAt)) throw conflict('Item result is already processing');
  try {
    return await processResult({ commandId, item, input, file, auth, job, token });
  } finally { await repository.releaseItem(job._id, item._id, token); }
}
async function processResult({ commandId, item, input, file, auth, job, token }) {
  let result;
  if (input.errorCode) result = { status: 'FAILED', errorCode: input.errorCode, errorMessage: (input.errorMessage || input.errorCode).slice(0, 300) };
  else {
    try { result = await processImage({ commandId, item, input, file, auth, job }); }
    catch (error) {
      if (error.code === 'MEDIA_CLOUDINARY_CONFIG_MISSING') {
        await pauseCommand(commandId, { ...input, errorMessage: error.message }, auth);
        throw error;
      }
      if (![errorCodes.VALIDATION_ERROR, 'MEDIA_CLOUDINARY_UPLOAD_FAILED', 'MEDIA_UPLOAD_FAILED'].includes(error.code)) throw error;
      result = { status: 'FAILED', errorCode: error.code, errorMessage: error.message.slice(0, 300) };
    }
  }
  await ownedCommand(commandId, input, auth);
  const updated = await repository.acknowledge(job._id, item._id, commandId, result, token);
  const saved = updated || await repository.findJob(job._id);
  return { status: saved.items.find((row) => String(row._id) === String(item._id)).status };
}
async function processImage({ commandId, item, input, file, auth, job }) {
  if (!catalog.isAmazonImageUrl(input.sourceUrl)) throw new AppError('Untrusted Amazon image source URL', 400, true, errorCodes.VALIDATION_ERROR);
  const { hash } = media.validateListingImageBuffer(file?.buffer);
  const listing = await catalog.getImageSyncListing({ listingId: item.listingId, shopId: job.shopId, asin: item.asin });
  if (!listing) return { status: 'SKIPPED' };
  const unchanged = listing.imageSync?.hash === hash;
  const status = unchanged && String(listing.imageSync?.resultItemId) === String(item._id)
    ? listing.imageSync.resultStatus : (unchanged ? 'UNCHANGED' : 'SUCCEEDED');
  const asset = unchanged ? null : await media.storeListingImage({ buffer: file.buffer, shopId: job.shopId, listingId: item.listingId, sourceUrl: input.sourceUrl });
  await ownedCommand(commandId, input, auth);
  const updated = await catalog.applySyncedListingImage(listing, {
    ...(asset ? { productImageUrl: asset.secureUrl, 'imageSync.mediaAssetId': asset._id } : {}),
    'imageSync.source': 'AMAZON_SYNC', 'imageSync.hash': hash, 'imageSync.sourceUrl': input.sourceUrl, 'imageSync.lastCheckedAt': new Date(),
    'imageSync.resultItemId': item._id, 'imageSync.resultStatus': status,
  });
  return { status: updated ? status : 'SKIPPED' };
}
module.exports = { createJob, listJobs, listSchedules, upsertSchedule, changeJob, dispatch, dispatchJob, getCommandItems, recordResult, pauseCommand };
