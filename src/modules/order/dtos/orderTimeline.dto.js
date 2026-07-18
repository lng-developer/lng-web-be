function toId(value) {
  return value === undefined || value === null ? null : String(value);
}

function sanitizeMetadata(metadata = {}) {
  const {
    localPath,
    providerPath,
    rawPayload,
    rawRecordId,
    rawRecordIds,
    signedUrl,
    sourceUrl,
    ...safeMetadata
  } = metadata || {};
  return safeMetadata;
}

function toOrderTimelineDto(event) {
  if (!event) {
    return null;
  }

  return {
    id: toId(event._id || event.id),
    orderId: toId(event.orderId),
    orderItemId: toId(event.orderItemId),
    shopId: toId(event.shopId),
    salesChannelCode: event.salesChannelCode,
    marketplaceCode: event.marketplaceCode,
    eventType: event.eventType,
    message: event.message,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    source: event.source,
    actorId: toId(event.actorId),
    actor: event.actor ? {
      accountId: toId(event.actor.accountId),
      fullName: event.actor.fullName || null,
      employeeCode: event.actor.employeeCode || null,
      displayName: event.actor.displayName || event.actor.fullName || event.actor.employeeCode || null,
    } : null,
    metadata: sanitizeMetadata(event.metadata),
    createdAt: event.createdAt,
  };
}

function toPaginatedOrderTimelineDto(result = {}) {
  return {
    items: (result.items || []).map(toOrderTimelineDto),
    pagination: {
      total: result.total,
      page: result.page,
      limit: result.limit,
    },
  };
}

module.exports = {
  toOrderTimelineDto,
  toPaginatedOrderTimelineDto,
};
