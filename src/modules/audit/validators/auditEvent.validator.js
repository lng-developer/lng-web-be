const Joi = require('joi');
const mongoose = require('mongoose');
const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');

const MAX_DETAIL_DEPTH = 5;
const MAX_DETAIL_BYTES = 16 * 1024;
const FORBIDDEN_KEY = /(password|token|secret|authorization|cookie)/i;
const DANGEROUS_KEYS = new Set([
  '__proto__', 'constructor', 'prototype', 'toJSON', 'toBSON',
]);

function assertSafeObjectPrototype() {
  for (const key of ['toJSON', 'toBSON']) {
    const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, key);
    if (descriptor && (typeof descriptor.value === 'function' || descriptor.get || descriptor.set)) {
      throw new AppError(
        'Audit metadata rejected: unsafe Object prototype serialization hook',
        httpStatus.BAD_REQUEST,
        true,
        errorCodes.VALIDATION_ERROR,
      );
    }
  }
}

function sanitize(value, depth = 0, seen = new WeakSet()) {
  if (depth > MAX_DETAIL_DEPTH) throw new Error('Audit metadata exceeds maximum depth');
  if (value === null || ['string', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (value instanceof Date) {
    const time = Date.prototype.getTime.call(value);
    if (Number.isNaN(time)) throw new Error('Audit metadata must contain plain data');
    return new Date(time);
  }
  if (value instanceof mongoose.Types.ObjectId) {
    const hex = mongoose.Types.ObjectId.prototype.toHexString.call(value);
    return new mongoose.Types.ObjectId(hex);
  }
  if (typeof value !== 'object') throw new Error('Audit metadata must contain plain data');

  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if (!array && prototype !== Object.prototype && prototype !== null) {
    throw new Error('Audit metadata must contain plain data');
  }
  if (seen.has(value)) throw new Error('Audit metadata must not be circular');
  seen.add(value);

  const sanitized = array ? [] : Object.create(null);
  if (array) {
    Object.defineProperties(sanitized, {
      toJSON: { value: undefined },
      toBSON: { value: undefined },
    });
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const numericKeys = [];
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (array && key === 'length') continue;
    if (FORBIDDEN_KEY.test(key) || DANGEROUS_KEYS.has(key)) continue;
    if (descriptor.get || descriptor.set) throw new Error('Audit metadata must contain plain data');
    if (!descriptor.enumerable) continue;
    if (array) {
      if (!/^(0|[1-9]\d*)$/.test(key)) throw new Error('Audit metadata must contain plain data');
      numericKeys.push(key);
    }
    sanitized[key] = sanitize(descriptor.value, depth + 1, seen);
  }
  if (array && numericKeys.length !== value.length) {
    throw new Error('Audit metadata must contain plain data');
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
  assertSafeObjectPrototype();
  const actorSnapshot = sanitize(payload.actorSnapshot || {});
  const changes = payload.changes == null ? payload.changes : sanitize(payload.changes);
  const metadata = sanitize(payload.metadata || {});
  const candidate = {
    ...payload,
    actorSnapshot,
    changes,
    metadata,
  };
  const details = Object.assign(Object.create(null), {
    actorSnapshot: candidate.actorSnapshot,
    changes: candidate.changes,
    metadata: candidate.metadata,
  });
  const detailsBytes = Buffer.byteLength(JSON.stringify(details));
  if (detailsBytes > MAX_DETAIL_BYTES) throw new Error('Audit metadata exceeds maximum serialized size');

  const { error, value } = schema.validate(candidate, { abortEarly: false, stripUnknown: true });
  if (error) throw error;
  return Object.assign(Object.create(null), value, { actorSnapshot, changes, metadata });
}

module.exports = { sanitizeAuditData: sanitize, validateAndSanitizeAuditEvent };
