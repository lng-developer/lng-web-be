function toId(value) {
  return value ? String(value._id || value.id || value) : null;
}

function toNotificationDto(notification) {
  if (!notification) return null;
  return {
    id: toId(notification),
    type: notification.type,
    title: notification.title,
    message: notification.message,
    relatedResource: notification.relatedResource ? {
      type: notification.relatedResource.type,
      id: toId(notification.relatedResource.id),
    } : null,
    readAt: notification.readAt || null,
    createdAt: notification.createdAt,
    updatedAt: notification.updatedAt,
  };
}

function toNotificationListDto(result) {
  return {
    items: (result.items || []).map(toNotificationDto),
    pagination: result.pagination,
  };
}

module.exports = {
  toNotificationDto,
  toNotificationListDto,
};
