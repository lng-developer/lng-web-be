const notificationPublic = require('../../notification/public');

function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

async function notifyAccount({
  recipientAccountId,
  actorAccountId = null,
  task,
  type,
  title,
  message,
  deduplicationScope = null,
}) {
  const recipient = toId(recipientAccountId);
  const taskId = toId(task);
  if (!recipient || recipient === toId(actorAccountId) || !taskId) return null;

  return notificationPublic.notify({
    recipientAccountId: recipient,
    type,
    title,
    message,
    relatedResource: { type: 'designTask', id: taskId },
    deduplicationKey: [type, taskId, deduplicationScope, recipient].filter(Boolean).join(':'),
  });
}

module.exports = {
  notifyAccount,
};
