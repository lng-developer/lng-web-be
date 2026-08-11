function toId(value) {
  return value ? String(value._id || value.id || value) : null;
}

function toConversationDto(conversation) {
  if (!conversation) return null;
  return {
    id: toId(conversation),
    type: conversation.type,
    title: conversation.title || null,
    shopId: toId(conversation.shopId),
    relatedResource: conversation.relatedResource?.id ? {
      type: conversation.relatedResource.type,
      id: String(conversation.relatedResource.id),
    } : null,
    participantAccountIds: (conversation.participantAccountIds || []).map(toId),
    lastMessageAt: conversation.lastMessageAt || null,
    lastMessagePreview: conversation.lastMessagePreview || null,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
  };
}

function toAssetDto(asset) {
  const id = toId(asset);
  return {
    id,
    originalFilename: asset.originalFilename || null,
    mimeType: asset.mimeType || null,
    size: asset.size ?? null,
    downloadUrl: id ? `/api/media/assets/${id}/download` : null,
  };
}

function toMessageDto(message, assetsById = new Map()) {
  if (!message) return null;
  const assetIds = message.deletedAt ? [] : (message.assetIds || []).map(toId);
  return {
    id: toId(message),
    conversationId: toId(message.conversationId),
    senderAccountId: toId(message.senderAccountId),
    body: message.deletedAt ? '' : (message.body || ''),
    assetIds,
    assets: assetIds.map((assetId) => assetsById.get(String(assetId))).filter(Boolean).map(toAssetDto),
    mentions: message.deletedAt ? [] : (message.mentions || []).map(toId),
    replyToMessageId: toId(message.replyToMessageId),
    editedAt: message.editedAt || null,
    deletedAt: message.deletedAt || null,
    createdAt: message.createdAt,
    updatedAt: message.updatedAt,
  };
}

function toListDto(result, mapper) {
  return {
    items: (result.items || []).map(mapper),
    pagination: result.pagination,
  };
}

module.exports = {
  toConversationDto,
  toConversationListDto: (result) => toListDto(result, toConversationDto),
  toAssetDto,
  toMessageDto,
  toMessageListDto: (result, assetsById) => ({
    items: (result.items || []).map((message) => toMessageDto(message, assetsById)),
    pagination: result.pagination,
  }),
};
