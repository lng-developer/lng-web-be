const Joi = require('joi');
const { shipmentStatuses } = require('../constants/shipment.constants');

const objectId = Joi.string().hex().length(24);
const dateOnly = Joi.string().pattern(/^\d{4}-\d{2}-\d{2}$/);

function validate(schema, payload) {
  const result = schema.validate(payload, {
    abortEarly: false,
    stripUnknown: true,
    convert: true,
  });

  if (!result.error) return { value: result.value };

  return {
    value: result.value,
    details: result.error.details.map((detail) => ({
      message: detail.message,
      path: detail.path,
      type: detail.type,
    })),
  };
}

const listShipmentsQuerySchema = Joi.object({
  id: objectId,
  status: Joi.string().trim().uppercase().valid(...Object.values(shipmentStatuses)),
  vendorSubmissionId: objectId,
  orderId: objectId,
  orderItemId: objectId,
  shopId: objectId,
  externalOrderId: Joi.string().trim().max(160),
  vendorExternalOrderId: Joi.string().trim().max(160),
  trackingNumber: Joi.string().trim().max(160),
  carrier: Joi.string().trim().max(80),
  dateFrom: dateOnly,
  dateTo: dateOnly,
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const exportShipmentsQuerySchema = listShipmentsQuerySchema.keys({
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(5000).default(5000),
});

const summaryQuerySchema = Joi.object({
  id: objectId,
  status: Joi.string().trim().uppercase().valid(...Object.values(shipmentStatuses)),
  shopId: objectId,
  externalOrderId: Joi.string().trim().max(160),
  vendorExternalOrderId: Joi.string().trim().max(160),
  trackingNumber: Joi.string().trim().max(160),
  carrier: Joi.string().trim().max(80),
  dateFrom: dateOnly,
  dateTo: dateOnly,
});

const updateTrackingSchema = Joi.object({
  carrier: Joi.string().trim().min(1).max(80).required(),
  trackingNumber: Joi.string().trim().min(1).max(160).required(),
  trackingUrl: Joi.string().trim().uri().max(1000).allow(null, ''),
  note: Joi.string().trim().max(1000).allow(null, ''),
});

const updateStatusSchema = Joi.object({
  status: Joi.string().trim().uppercase().valid(
    shipmentStatuses.DELIVERED,
    shipmentStatuses.EXCEPTION,
    shipmentStatuses.RETURNED,
    shipmentStatuses.CANCELLED,
  ).required(),
  note: Joi.string().trim().max(1000).allow(null, ''),
});

const listWebhookLogsQuerySchema = Joi.object({
  provider: Joi.string().trim().uppercase().max(80),
  outcome: Joi.string().trim().uppercase().valid('SUCCESS', 'ERROR', 'SKIPPED'),
  vendorSubmissionId: objectId,
  orderItemId: objectId,
  dateFrom: dateOnly,
  dateTo: dateOnly,
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const vendorTrackingRecheckSchema = Joi.object({
  provider: Joi.string().trim().uppercase().valid('LENFUL', 'MERCHIZE', 'PRINTWAY'),
  externalOrderId: Joi.string().trim().min(1).max(120),
  dateFrom: dateOnly,
  dateTo: dateOnly,
  vendorSubmissionId: objectId.required(),
});

const vendorTrackingBatchRecheckSchema = Joi.object({
  provider: Joi.string().trim().uppercase().valid('LENFUL', 'MERCHIZE', 'PRINTWAY'),
  shopId: objectId,
  limit: Joi.number().integer().min(1),
});

module.exports = {
  exportShipmentsQuerySchema,
  listWebhookLogsQuerySchema,
  listShipmentsQuerySchema,
  summaryQuerySchema,
  updateStatusSchema,
  updateTrackingSchema,
  vendorTrackingBatchRecheckSchema,
  vendorTrackingRecheckSchema,
  validate,
};
