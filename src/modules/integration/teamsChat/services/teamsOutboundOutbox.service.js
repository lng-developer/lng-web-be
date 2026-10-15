const repository = require('../repositories/teamsOutboundMessage.repository');
const teamsSync = require('./teamsSync.service');
const logger = require('../../../../shared/utils/logger');

const retryAt = (attempts) => new Date(Date.now() + Math.min(5 * 60 * 1000, 1000 * (2 ** Math.max(0, attempts || 0))));
async function enqueue({ conversation, message }) {
  if (conversation?.type !== 'DIRECT' || !message?.id || !message.body?.trim()) return null;
  return repository.enqueue({ lngMessageId: message.id, conversationId: conversation.id, senderAccountId: message.senderAccountId || null, body: message.body, participantAccountIds: conversation.participantAccountIds || [], title: conversation.title || null });
}
async function processDue({ limit = 25 } = {}) {
  let processed = 0;
  for (let index = 0; index < limit; index += 1) {
    const job = await repository.claimDue();
    if (!job) break;
    processed += 1;
    try {
      const result = await teamsSync.dispatchMessageToTeams({ conversation: { id: String(job.conversationId), type: 'DIRECT', participantAccountIds: job.participantAccountIds, title: job.title }, message: { id: String(job.lngMessageId), body: job.body, senderAccountId: job.senderAccountId } });
      if (['SYNCED', 'SKIPPED_ALREADY_MAPPED', 'SKIPPED_ECHO_PREVENTION'].includes(result.status)) await repository.markSent(job.id || job._id);
      else if (String(result.status || '').startsWith('SKIPPED_')) await repository.fail(job.id || job._id, result.status);
      else await repository.retry(job.id || job._id, retryAt(job.attempts), result.error || result.status);
    } catch (error) { await repository.retry(job.id || job._id, retryAt(job.attempts), error.message); }
  }
  return { processed };
}
async function runSafely() { try { return await processDue(); } catch (error) { logger.warn('teams_outbound_outbox_failed', { error: error.message }); return { processed: 0 }; } }
module.exports = { enqueue, processDue, runSafely };
