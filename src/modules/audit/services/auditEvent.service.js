const repository = require('../repositories/auditEvent.repository');
const { toAuditEventDto } = require('../dtos/auditEvent.dto');

async function record(payload) {
  try {
    return toAuditEventDto(await repository.create(payload));
  } catch (error) {
    if (error?.code !== 11000) throw error;
    const existing = await repository.findByDeduplicationKey(payload.deduplicationKey);
    if (!existing) throw error;
    return toAuditEventDto(existing);
  }
}

module.exports = { record };
