const AppError = require('../../../shared/errors/appError');
const errorCodes = require('../../../shared/constants/errorCodes');
const httpStatus = require('../../../shared/constants/httpStatus');
const repository = require('../repositories/notification.repository');
const { toNotificationDto, toNotificationListDto } = require('../dtos/notification.dto');

async function notify(payload) {
  try {
    return toNotificationDto(await repository.create(payload));
  } catch (error) {
    if (error.code !== 11000) throw error;
    const existing = await repository.findByDeduplicationKey(
      payload.recipientAccountId,
      payload.deduplicationKey,
    );
    if (!existing) throw error;
    return toNotificationDto(existing);
  }
}

async function listInbox(recipientAccountId, query = {}) {
  return toNotificationListDto(await repository.listForRecipient({
    recipientAccountId,
    ...query,
  }));
}

async function getUnreadCount(recipientAccountId) {
  return { unreadCount: await repository.countUnreadForRecipient(recipientAccountId) };
}

async function markRead(id, recipientAccountId) {
  const notification = await repository.markReadForRecipient(id, recipientAccountId, new Date());
  if (!notification) {
    throw new AppError(
      'Notification not found',
      httpStatus.NOT_FOUND,
      true,
      errorCodes.RESOURCE_NOT_FOUND,
    );
  }
  return toNotificationDto(notification);
}

async function markAllRead(recipientAccountId) {
  const result = await repository.markAllReadForRecipient(recipientAccountId, new Date());
  return { updatedCount: result.modifiedCount || 0 };
}

module.exports = {
  getUnreadCount,
  listInbox,
  markAllRead,
  markRead,
  notify,
};
