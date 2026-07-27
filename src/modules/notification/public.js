const logger = require('../../shared/utils/logger');
const errorCodes = require('../../shared/constants/errorCodes');
const service = require('./services/notification.service');

async function notify(payload) {
  try {
    const notification = await service.notify(payload);
    return { delivered: true, id: notification.id };
  } catch (error) {
    const errorCode = typeof error.code === 'string' ? error.code : errorCodes.INTERNAL_SERVER_ERROR;
    logger.warn('notification_delivery_failed', {
      correlationId: payload.correlationId,
      errorCode,
      error,
    });
    return {
      delivered: false,
      errorCode,
      correlationId: payload.correlationId || null,
    };
  }
}

async function notifyMany({ recipientAccountIds = [], deduplicationKeyPrefix, ...message }) {
  const recipients = [...new Set(recipientAccountIds.map(String))];
  return Promise.all(recipients.map((recipientAccountId) => notify({
    ...message,
    recipientAccountId,
    deduplicationKey: `${deduplicationKeyPrefix}:${recipientAccountId}`,
  })));
}

module.exports = {
  notify,
  notifyMany,
};
