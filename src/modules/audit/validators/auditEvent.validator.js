const Joi = require('joi');
const mongoose = require('mongoose');

const MAX_DETAIL_DEPTH = 5;
const MAX_DETAIL_BYTES = 16 * 1024;
const FORBIDDEN_KEY = /(password|token|secret|authorization|cookie)/i;
const DANGEROUS_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function sanitize(value, depth = 0, seen = new WeakSet()) {
  if (depth > MAX_DETAIL_DEPTH) throw new Error('Audit metadata exceeds maximum depth');
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date || value instanceof mongoose.Types.ObjectId) return value;
  if (seen.has(value)) throw new Error('Audit metadata must not be circular');
  seen.add(value);

  const sanitized = Array.isArray(value) ? [] : {};
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_KEY.test(key) || DANGEROUS_KEYS.has(key)) continue;
    sanitized[key] = sanitize(entry, depth + 1, seen);
  }
  seen.delete(value);
  return sanitized;
}

const objectId = Joi.any().custom((value, helpers) => (
  mongoose.isObjectIdOrHexString(value) ? value : helpers.error('any.invalid')
));
const code = Joi.string().trim().max(100).pattern(/^[A-Z][A-Z0-9_]*$/);
const identifier = Joi.string().trim().min(1).max(200);

const schema = Joi.object({
  actorType: Joi.string().valid('ACCOUNT', 'SYSTEM', 'ANONYMOUS').required(),
  actorAccountId: objectId.allow(null),
  actorSnapshot: Joi.object().unknown(true).default({}),
  action: code.required(),
  entityType: code.required(),
  entityId: identifier.required(),
  scopeType: code.allow(null),
  scopeId: identifier.allow(null),
  outcome: Joi.string().valid('SUCCEEDED', 'FAILED').required(),
  source: Joi.string().valid('HTTP', 'WORKER', 'SYSTEM', 'IMPORT').required(),
  requestId: identifier.allow(null),
  ipAddress: Joi.string().trim().max(100).allow(null),
  userAgent: Joi.string().trim().max(500).allow(null),
  changes: Joi.object().unknown(true).allow(null),
  metadata: Joi.object().unknown(true).default({}),
  deduplicationKey: Joi.string().trim().min(1).max(300).required(),
}).custom((value, helpers) => {
  if (value.actorType === 'ACCOUNT' && !value.actorAccountId) {
    return helpers.error('any.custom', { message: 'actorAccountId is required for ACCOUNT events' });
  }
  if (value.scopeType && !value.scopeId) {
    return helpers.error('any.custom', { message: 'scopeId is required when scopeType is provided' });
  }
  if (value.scopeId && !value.scopeType) {
    return helpers.error('any.custom', { message: 'scopeType is required when scopeId is provided' });
  }
  return value;
});

function validateAndSanitizeAuditEvent(payload = {}) {
  const candidate = {
    ...payload,
    actorType: payload.actorType || (payload.actorAccountId ? 'ACCOUNT' : 'SYSTEM'),
    outcome: payload.outcome || 'SUCCEEDED',
    source: payload.source || 'SYSTEM',
    actorSnapshot: sanitize(payload.actorSnapshot || {}),
    changes: payload.changes == null ? payload.changes : sanitize(payload.changes),
    metadata: sanitize(payload.metadata || {}),
  };
  const detailsBytes = Buffer.byteLength(JSON.stringify({
    actorSnapshot: candidate.actorSnapshot,
    changes: candidate.changes,
    metadata: candidate.metadata,
  }));
  if (detailsBytes > MAX_DETAIL_BYTES) throw new Error('Audit metadata exceeds maximum serialized size');

  const { error, value } = schema.validate(candidate, { abortEarly: false, stripUnknown: true });
  if (error) throw error;
  return value;
}

module.exports = { validateAndSanitizeAuditEvent };
