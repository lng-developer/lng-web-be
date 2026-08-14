function idOf(value) {
  return value ? String(value) : null;
}

function dayDiff(date) {
  if (!date) return null;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

function toCustomerDto(customer) {
  if (!customer) return null;
  return {
    id: idOf(customer._id || customer.id),
    identityKey: customer.identityKey,
    salesChannelCode: customer.salesChannelCode,
    marketplaceCode: customer.marketplaceCode,
    externalBuyerId: customer.externalBuyerId,
    name: customer.name,
    emailMasked: customer.emailMasked,
    phoneMasked: customer.phoneMasked,
    firstOrderId: idOf(customer.firstOrderId),
    firstOrderAt: customer.firstOrderAt,
    lastOrderId: idOf(customer.lastOrderId),
    lastOrderAt: customer.lastOrderAt,
    orderCount: customer.orderCount || 0,
    orderItemCount: customer.orderItemCount || 0,
    totalRevenueAmount: customer.totalRevenueAmount || 0,
    totalCostAmount: customer.totalCostAmount || 0,
    currency: customer.currency,
    averageOrderValue: customer.averageOrderValue || 0,
    countries: customer.countries || [],
    shops: (customer.shops || []).map((shop) => ({ shopId: idOf(shop.shopId), name: shop.name })),
    status: customer.status,
    lifecycle: customer.lifecycle,
    careStatus: customer.careStatus,
    riskFlags: customer.riskFlags || [],
    lastIssueAt: customer.lastIssueAt,
    lastCareNoteAt: customer.lastCareNoteAt,
    isNew: customer.lifecycle === 'NEW',
    isReturning: ['RETURNING', 'VIP', 'AT_RISK', 'ISSUE_PRONE'].includes(customer.lifecycle),
    isVip: customer.lifecycle === 'VIP',
    needsFollowUp: customer.careStatus === 'NEEDS_FOLLOW_UP',
    lastOrderAgeDays: dayDiff(customer.lastOrderAt),
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

function toCustomerEventDto(event) {
  return {
    id: idOf(event._id || event.id),
    customerId: idOf(event.customerId),
    eventType: event.eventType,
    sourceModule: event.sourceModule,
    sourceId: event.sourceId,
    message: event.message,
    occurredAt: event.occurredAt,
    metadata: event.metadata || {},
  };
}

function toCustomerNoteDto(note) {
  return {
    id: idOf(note._id || note.id),
    customerId: idOf(note.customerId),
    body: note.body,
    type: note.type,
    createdBy: idOf(note.createdBy),
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

function toCustomerSummaryDto(summary = {}) {
  const totalRevenueAmount = summary.totalRevenueAmount || 0;
  const totalOrderCount = summary.totalOrderCount || 0;
  return {
    total: summary.total || 0,
    newCount: summary.newCount || 0,
    returningCount: summary.returningCount || 0,
    vipCount: summary.vipCount || 0,
    atRiskCount: summary.atRiskCount || 0,
    issueProneCount: summary.issueProneCount || 0,
    needsFollowUpCount: summary.needsFollowUpCount || 0,
    totalRevenueAmount,
    averageOrderValue: totalOrderCount ? Math.round(totalRevenueAmount / totalOrderCount) : 0,
    byCountry: summary.byCountry || [],
    byLifecycle: summary.byLifecycle || {},
  };
}

module.exports = {
  toCustomerDto,
  toCustomerEventDto,
  toCustomerNoteDto,
  toCustomerSummaryDto,
};
