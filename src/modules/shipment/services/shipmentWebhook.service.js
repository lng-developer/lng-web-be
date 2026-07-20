const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const vendorSubmissionPublic = require('../../vendorSubmission/public');
const { shipmentPermissions, vendorWebhookOutcomes } = require('../constants/shipment.constants');
const { toWebhookLogPageDto } = require('../dtos/shipment.dto');
const webhookLogRepository = require('../repositories/vendorWebhookLog.repository');
const shipmentService = require('./shipment.service');
const { getTrackingAdapter } = require('./vendorTrackingAdapterRegistry.service');
const { normalizeProviderKey } = require('./vendorTrackingNormalizer.service');

const SHOP_SCOPE_TYPE = 'shop';

const UNSAFE_KEYS = new Set([
  'apikey',
  'apisecret',
  'authorization',
  'password',
  'secret',
  'token',
  'access_token',
  'accesstoken',
  'refresh_token',
  'refreshtoken',
]);

function appError(message, statusCode, code, details) {
  return new AppError(message, statusCode, true, code, details);
}

function forbidden() {
  return appError('Forbidden', httpStatus.FORBIDDEN, errorCodes.AUTHORIZATION_ERROR);
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.entries(value).reduce((result, [key, entry]) => {
    if (UNSAFE_KEYS.has(String(key).toLowerCase())) return result;
    result[key] = sanitize(entry);
    return result;
  }, {});
}

function providerSecretName(provider) {
  return `VENDOR_WEBHOOK_SECRET_${normalizeProviderKey(provider)}`;
}

function assertWebhookSecret(provider, req) {
  const expected = process.env[providerSecretName(provider)] || process.env.VENDOR_WEBHOOK_SECRET;
  const actual = req.headers['x-vendor-webhook-secret'] || req.query.token;
  if (!expected || !actual || String(actual) !== String(expected)) throw forbidden();
}

function webhookRequestMeta(req) {
  const rawPath = req.originalUrl || req.url || '';
  return {
    method: req.method || '',
    path: String(rawPath).split('?')[0],
    ip: req.ip || req.socket?.remoteAddress || '',
    userAgent: req.headers['user-agent'] || '',
  };
}

function hasReadPermission(authContext = {}) {
  const permissions = authContext.permissions || [];
  return permissions.includes(shipmentPermissions.READ) || permissions.includes(shipmentPermissions.WRITE);
}

function scopedShopIds(authContext = {}) {
  return [...new Set((authContext.scopes || [])
    .filter((scope) => (
      scope.scopeType === SHOP_SCOPE_TYPE
      && scope.scopeId
      && ((scope.permissions || []).includes(shipmentPermissions.READ)
        || (scope.permissions || []).includes(shipmentPermissions.WRITE))
    ))
    .map((scope) => String(scope.scopeId)))];
}

async function writeLog({
  provider,
  outcome,
  httpStatus: statusCode,
  message,
  normalized = {},
  submission = null,
  rawPayload = null,
  result = null,
  req = {},
}) {
  return webhookLogRepository.create({
    provider: normalizeProviderKey(provider),
    outcome,
    httpStatus: statusCode,
    message,
    shopId: submission?.shopId || null,
    vendorSubmissionId: submission?.id || submission?._id || normalized.vendorSubmissionId || null,
    orderItemId: submission?.orderItemId || normalized.orderItemId || null,
    trackingNumber: normalized.trackingNumber || null,
    carrier: normalized.carrier || null,
    vendorStatus: normalized.vendorStatus || null,
    request: webhookRequestMeta(req),
    rawPayload: sanitize(rawPayload),
    result: sanitize(result),
  });
}

async function resolveSubmission(normalized = {}, body = {}) {
  const vendorSubmissionId = normalized.vendorSubmissionId || body.vendorSubmissionId || body.vendor_submission_id;
  if (vendorSubmissionId) {
    assertValidObjectId(vendorSubmissionId, 'vendorSubmissionId');
    return vendorSubmissionPublic.getById(vendorSubmissionId);
  }

  const orderItemId = normalized.orderItemId || body.orderItemId || body.order_item_id;
  if (orderItemId) {
    assertValidObjectId(orderItemId, 'orderItemId');
    return vendorSubmissionPublic.getByOrderItemId(orderItemId);
  }

  const vendorExternalOrderId = normalized.vendorExternalOrderId || body.vendorExternalOrderId || body.vendor_external_order_id || body.order_id;
  if (vendorExternalOrderId && normalized.provider) {
    return vendorSubmissionPublic.getByProviderExternalOrderId({
      provider: normalized.provider,
      vendorExternalOrderId,
    });
  }

  return null;
}

function webhookAuthContext() {
  return {
    permissions: [shipmentPermissions.WRITE],
    system: true,
    source: 'VENDOR_WEBHOOK',
  };
}

async function verifyVendorWebhook(provider, req) {
  assertWebhookSecret(provider, req);
  return {
    provider: normalizeProviderKey(provider),
    status: 'ok',
  };
}

async function receiveVendorWebhook(provider, req) {
  assertWebhookSecret(provider, req);
  const adapter = getTrackingAdapter(provider);
  const body = req.body || {};
  const normalized = adapter.normalizeTracking(provider, body);

  let submission;
  try {
    submission = await resolveSubmission(normalized, body);
    if (!submission) {
      const result = { reason: 'SUBMISSION_NOT_FOUND' };
      await writeLog({
        provider,
        outcome: vendorWebhookOutcomes.SKIPPED,
        httpStatus: httpStatus.ACCEPTED,
        message: result.reason,
        normalized,
        rawPayload: body,
        result,
        req,
      });
      return { statusCode: httpStatus.ACCEPTED, data: result };
    }

    if (!normalized.trackingNumber) {
      const result = { reason: 'TRACKING_NOT_FOUND', vendorSubmissionId: submission.id };
      await writeLog({
        provider,
        outcome: vendorWebhookOutcomes.SKIPPED,
        httpStatus: httpStatus.ACCEPTED,
        message: result.reason,
        normalized,
        submission,
        rawPayload: body,
        result,
        req,
      });
      return { statusCode: httpStatus.ACCEPTED, data: result };
    }

    const shipment = await shipmentService.createFromVendorSubmission(submission.id, webhookAuthContext());
    const updated = await shipmentService.updateTracking(shipment.id, {
      carrier: normalized.carrier || normalizeProviderKey(provider),
      trackingNumber: normalized.trackingNumber,
      trackingUrl: normalized.trackingUrl || null,
      note: `Vendor webhook: ${normalizeProviderKey(provider)}`,
    }, webhookAuthContext());
    const finalShipment = normalized.delivered
      ? await shipmentService.updateStatus(updated.id, { status: 'DELIVERED' }, webhookAuthContext())
      : updated;

    const result = {
      shipmentId: finalShipment.id,
      vendorSubmissionId: submission.id,
      orderItemId: submission.orderItemId,
      status: finalShipment.status,
    };
    await writeLog({
      provider,
      outcome: vendorWebhookOutcomes.SUCCESS,
      httpStatus: httpStatus.OK,
      message: 'Webhook tracking applied',
      normalized,
      submission,
      rawPayload: body,
      result,
      req,
    });
    return { statusCode: httpStatus.OK, data: result };
  } catch (error) {
    await writeLog({
      provider,
      outcome: vendorWebhookOutcomes.ERROR,
      httpStatus: error.statusCode || httpStatus.INTERNAL_SERVER_ERROR,
      message: error.message || 'Webhook processing failed',
      normalized,
      submission,
      rawPayload: body,
      result: { code: error.code || errorCodes.INTERNAL_SERVER_ERROR },
      req,
    });
    throw error;
  }
}

async function listWebhookLogs(query = {}, authContext) {
  if (authContext && !authContext.system && !hasReadPermission(authContext)) {
    const shopIds = scopedShopIds(authContext);
    if (!shopIds.length) return toWebhookLogPageDto({
      items: [], total: 0, page: query.page || 1, limit: query.limit || 20,
    });
    query = { ...query, shopIds };
  }
  return toWebhookLogPageDto(await webhookLogRepository.list(query));
}

module.exports = {
  listWebhookLogs,
  receiveVendorWebhook,
  verifyVendorWebhook,
};
