const repository = require('../repositories/auditEvent.repository');
const { toAuditEventDto } = require('../dtos/auditEvent.dto');
const { validateAndSanitizeAuditEvent } = require('../validators/auditEvent.validator');

async function record(payload, { session } = {}) {
  const value = validateAndSanitizeAuditEvent(payload);
  return toAuditEventDto(await repository.upsertByDeduplicationKey(value, { session }));
}

module.exports = { record };
