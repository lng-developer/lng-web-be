const notificationPublic = require('../../notification/public');

function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

async function notifyAssignedStaff({
  order,
  actorAccountId = null,
  type,
  title,
  message,
  deduplicationScope = null,
}) {
  const orderId = toId(order);
  const recipients = [...new Set((order?.assignedStaffIds || []).map(String))]
    .filter((recipientId) => recipientId && recipientId !== String(actorAccountId || ''));
  if (!orderId || recipients.length === 0) return [];

  return notificationPublic.notifyMany({
    recipientAccountIds: recipients,
    type,
    title,
    message,
    relatedResource: { type: 'order', id: orderId },
    deduplicationKeyPrefix: [type, orderId, deduplicationScope].filter(Boolean).join(':'),
  });
}

module.exports = {
  notifyAssignedStaff,
};
