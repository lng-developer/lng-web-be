const AppError = require('../../../shared/errors/appError');
const authPublic = require('../../auth/public');
const crypto = require('crypto');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const { assertValidObjectId } = require('../../../shared/utils/objectId');
const vendorSubmissionPublic = require('../../vendorSubmission/public');
const { shipmentPermissions, shipmentStatuses, vendorWebhookOutcomes } = require('../constants/shipment.constants');
const { toWebhookLogPageDto } = require('../dtos/shipment.dto');
const webhookLogRepository = require('../repositories/vendorWebhookLog.repository');
const shipmentRepository = require('../repositories/shipment.repository');
const shipmentService = require('./shipment.service');
const { deriveTrackingIdentity } = require('./shipmentIdentity.service');
const { getTrackingAdapter } = require('./vendorTrackingAdapterRegistry.service');
const { verifyVendorWebhook: verifyWebhookRequest } = require('./vendorWebhookVerifierRegistry.service');
const { normalizeProviderKey, normalizeShipmentStatus } = require('./vendorTrackingNormalizer.service');

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
    if (UNSAFE_KEYS.has(String(key).toLowerCase().replace(/[^a-z0-9]/g, ''))) return result;
    result[key] = sanitize(entry);
    return result;
  }, {});
}

function assertWebhookSecret(provider, req) {
  if (!verifyWebhookRequest(provider, req)) throw forbidden();
}

function webhookRequestMeta(req) {
  const rawPath = req.originalUrl || req.url || '';
  return {
    method: req.method || '',
    path: String(rawPath).split('?')[0],
  };
}

function payloadHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload || {})).digest('hex');
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
    payloadHash: payloadHash(rawPayload),
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
    source: 'HTTP',
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
  const shipmentStatus = normalizeShipmentStatus(normalized.shipmentStatus || normalized.vendorStatus);

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
    const identity = deriveTrackingIdentity(submission);
    if (identity.provider !== normalizeProviderKey(provider)) {
      throw appError(
        'Webhook provider does not match vendor submission',
        httpStatus.BAD_REQUEST,
        errorCodes.VALIDATION_ERROR,
      );
    }

    const existing = await shipmentRepository.findActiveByVendorSubmission(submission.id);
    if (existing?.status === shipmentStatuses.CANCELLED) {
      const result = {
        shipmentId: existing._id || existing.id,
        vendorSubmissionId: submission.id,
        orderItemId: submission.orderItemId,
        status: existing.status,
      };
      await writeLog({
        provider,
        outcome: vendorWebhookOutcomes.SUCCESS,
        httpStatus: httpStatus.OK,
        message: 'Webhook shipment already cancelled',
        normalized,
        submission,
        rawPayload: body,
        result,
        req,
      });
      return { statusCode: httpStatus.OK, data: result };
    }
    const isLateCancellation = shipmentStatus === shipmentStatuses.CANCELLED
      && [shipmentStatuses.DELIVERED, shipmentStatuses.RETURNED].includes(existing?.status);
    const canApplyStatus = existing && (
      existing.status === shipmentStatus
      || isLateCancellation
      || (shipmentStatus === shipmentStatuses.DELIVERED && existing.status === shipmentStatuses.SHIPPED)
      || (shipmentStatus === shipmentStatuses.RETURNED && existing.status === shipmentStatuses.EXCEPTION)
      || (
        shipmentStatus === shipmentStatuses.CANCELLED
        && [shipmentStatuses.TRACKING_PENDING, shipmentStatuses.SHIPPED, shipmentStatuses.EXCEPTION].includes(existing.status)
      )
    );
    if (canApplyStatus) {
      const finalShipment = existing.status === shipmentStatus || isLateCancellation
        ? existing
        : await shipmentService.updateStatus(
          existing._id || existing.id,
          { status: shipmentStatus },
          webhookAuthContext(),
        );
      const result = {
        shipmentId: finalShipment._id || finalShipment.id,
        vendorSubmissionId: submission.id,
        orderItemId: submission.orderItemId,
        status: finalShipment.status,
      };
      await writeLog({
        provider,
        outcome: vendorWebhookOutcomes.SUCCESS,
        httpStatus: httpStatus.OK,
        message: 'Webhook shipment status applied',
        normalized,
        submission,
        rawPayload: body,
        result,
        req,
      });
      return { statusCode: httpStatus.OK, data: result };
    }

    if (shipmentStatus === shipmentStatuses.CANCELLED) {
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

    if (!normalized.trackingNumber) {
      if ([shipmentStatuses.EXCEPTION, shipmentStatuses.RETURNED].includes(shipmentStatus)) {
        if (existing?.status === shipmentStatuses.SHIPPED) {
          const finalShipment = await shipmentService.updateStatus(
            existing._id || existing.id,
            { status: shipmentStatus },
            webhookAuthContext(),
          );
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
            message: 'Webhook shipment status applied',
            normalized,
            submission,
            rawPayload: body,
            result,
            req,
          });
          return { statusCode: httpStatus.OK, data: result };
        }
      }
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
    const finalShipment = shipmentStatus && shipmentStatus !== shipmentStatuses.SHIPPED
      ? await shipmentService.updateStatus(updated.id, { status: shipmentStatus }, webhookAuthContext())
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
  if (authPublic.personalSellerAccountId?.(authContext)) {
    throw new AppError('Forbidden', httpStatus.FORBIDDEN, true, errorCodes.AUTHORIZATION_ERROR);
  }
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
