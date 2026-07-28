function toId(value) {
  return value ? String(value._id || value.id || value) : null;
}

function toAnnouncementDto(announcement) {
  if (!announcement) return null;
  return {
    id: toId(announcement),
    title: announcement.title,
    content: announcement.content,
    category: announcement.category,
    priority: announcement.priority,
    attachments: announcement.attachments || [],
    authorAccountId: toId(announcement.authorAccountId),
    sendToAll: Boolean(announcement.sendToAll),
    targetDepartmentIds: (announcement.targetDepartmentIds || []).map(toId),
    targetProfileIds: (announcement.targetProfileIds || []).map(toId),
    status: announcement.status,
    isPinned: Boolean(announcement.isPinned),
    scheduledAt: announcement.scheduledAt || null,
    publishedAt: announcement.publishedAt || null,
    remindAt: announcement.remindAt || null,
    eventDetails: announcement.eventDetails || null,
    capabilities: announcement.capabilities || undefined,
    createdAt: announcement.createdAt || null,
    updatedAt: announcement.updatedAt || null,
  };
}

function toAnnouncementListDto(result, capabilities) {
  return {
    items: (result.items || []).map((item) => toAnnouncementDto({ ...item, capabilities })),
    pagination: result.pagination,
  };
}

module.exports = { toAnnouncementDto, toAnnouncementListDto };
