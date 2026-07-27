const logger = require('../../shared/utils/logger');
const errorCodes = require('../../shared/constants/errorCodes');
const service = require('./services/notification.service');

async function notify(payload) {
  const correlationId = payload?.correlationId || null;
  try {
    const notification = await service.notify(payload);
    return { delivered: true, id: notification.id };
  } catch (error) {
    const errorCode = typeof error.code === 'string' ? error.code : errorCodes.INTERNAL_SERVER_ERROR;
    logger.warn('notification_delivery_failed', {
      correlationId,
      errorCode,
      error,
    });
    return {
      delivered: false,
      errorCode,
      correlationId,
    };
  }
}

async function notifyMany(payload = {}) {
  const { recipientAccountIds, deduplicationKeyPrefix, ...message } = payload || {};
  const recipients = Array.isArray(recipientAccountIds)
    ? [...new Set(recipientAccountIds.map(String))]
    : [];
  return Promise.all(recipients.map((recipientAccountId) => notify({
    ...message,
    recipientAccountId,
    deduplicationKey: `${deduplicationKeyPrefix}:${recipientAccountId}`,
  })));
}

async function migrateLegacyItems(items, options) {
  return service.migrateLegacyItems(items, options);
}

module.exports = {
  notify,
  notifyMany,
  migrateLegacyItems,
};
