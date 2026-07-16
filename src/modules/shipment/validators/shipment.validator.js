const Joi = require('joi');
const { shipmentStatuses } = require('../constants/shipment.constants');

const objectId = Joi.string().hex().length(24);

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
  status: Joi.string().trim().uppercase().valid(...Object.values(shipmentStatuses)),
  vendorSubmissionId: objectId,
  orderId: objectId,
  orderItemId: objectId,
  shopId: objectId,
  carrier: Joi.string().trim().max(80),
  dateFrom: Joi.date(),
  dateTo: Joi.date(),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

const summaryQuerySchema = Joi.object({
  status: Joi.string().trim().uppercase().valid(...Object.values(shipmentStatuses)),
  shopId: objectId,
  carrier: Joi.string().trim().max(80),
  dateFrom: Joi.date(),
  dateTo: Joi.date(),
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
    shipmentStatuses.CANCELLED,
  ).required(),
  note: Joi.string().trim().max(1000).allow(null, ''),
});

const listWebhookLogsQuerySchema = Joi.object({
  provider: Joi.string().trim().uppercase().max(80),
  outcome: Joi.string().trim().uppercase().valid('SUCCESS', 'ERROR', 'SKIPPED'),
  vendorSubmissionId: objectId,
  orderItemId: objectId,
  dateFrom: Joi.date(),
  dateTo: Joi.date(),
  page: Joi.number().integer().min(1),
  limit: Joi.number().integer().min(1).max(100),
});

module.exports = {
  listWebhookLogsQuerySchema,
  listShipmentsQuerySchema,
  summaryQuerySchema,
  updateStatusSchema,
  updateTrackingSchema,
  validate,
};
