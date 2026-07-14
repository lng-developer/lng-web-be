const { toPaginatedResponse } = require('../../../shared/utils/pagination');

function toId(value) {
  return value === undefined || value === null ? null : String(value._id || value.id || value);
}

function toCommentDto(comment = {}) {
  return {
    body: comment.body || null,
    createdBy: toId(comment.createdBy),
    createdAt: comment.createdAt || null,
  };
}

function toOrderCaseDto(orderCase, { includeComments = true } = {}) {
  if (!orderCase) return null;
  const dto = {
    id: toId(orderCase),
    orderId: toId(orderCase.orderId),
    orderItemId: toId(orderCase.orderItemId),
    shopId: toId(orderCase.shopId),
    caseType: orderCase.caseType || null,
    status: orderCase.status || null,
    severity: orderCase.severity || null,
    title: orderCase.title || null,
    description: orderCase.description || null,
    resolutionNote: orderCase.resolutionNote || null,
    cancelReason: orderCase.cancelReason || null,
    createdBy: toId(orderCase.createdBy),
    resolvedBy: toId(orderCase.resolvedBy),
    resolvedAt: orderCase.resolvedAt || null,
    cancelledBy: toId(orderCase.cancelledBy),
    cancelledAt: orderCase.cancelledAt || null,
    createdAt: orderCase.createdAt || null,
    updatedAt: orderCase.updatedAt || null,
  };

  if (includeComments) {
    dto.comments = (orderCase.comments || []).map(toCommentDto);
  }

  return dto;
}

function toPaginatedOrderCaseDto(result) {
  return toPaginatedResponse(result, (orderCase) => toOrderCaseDto(orderCase, { includeComments: false }));
}

module.exports = {
  toOrderCaseDto,
  toPaginatedOrderCaseDto,
};
