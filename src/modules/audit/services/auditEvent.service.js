const repository = require('../repositories/auditEvent.repository');
const { toAuditEventDto } = require('../dtos/auditEvent.dto');
const { validateAndSanitizeAuditEvent } = require('../validators/auditEvent.validator');

async function record(payload, { session } = {}) {
  const value = validateAndSanitizeAuditEvent(payload);
  if (session) {
    const existing = await repository.findByDeduplicationKey(value.deduplicationKey, { session });
    if (existing) return toAuditEventDto(existing);
  }
  try {
    return toAuditEventDto(await repository.create(value, { session }));
  } catch (error) {
    if (error?.code !== 11000 || session) throw error;
    const existing = await repository.findByDeduplicationKey(value.deduplicationKey);
    if (!existing) throw error;
    return toAuditEventDto(existing);
  }
}

module.exports = { record };
