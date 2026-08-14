const crypto = require('crypto');
const repository = require('../repositories/customer.repository');

const VIP_ORDER_THRESHOLD = 5;
const VIP_REVENUE_THRESHOLD = 50000;

function norm(value) {
  return value === undefined || value === null ? null : String(value).trim();
}

function hash(value) {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 16);
}

function deriveIdentityKey(snapshot = {}) {
  const channel = norm(snapshot.salesChannelCode)?.toUpperCase() || 'UNKNOWN';
  const marketplace = norm(snapshot.marketplaceCode)?.toUpperCase() || 'UNKNOWN';
  const buyer = snapshot.buyer || {};
  const stable =
    norm(buyer.externalBuyerId) ||
    norm(buyer.emailMasked) ||
    norm(buyer.phoneMasked) ||
    hash([
      norm(buyer.name) || 'unknown',
      norm(snapshot.shippingAddress?.countryCode) || norm(snapshot.shippingAddress?.country) || 'unknown',
    ].join('|'));
  return `${channel}:${marketplace}:${stable}`;
}

function mergeUnique(values = [], next) {
  if (!next) return values;
  return [...new Set([...values, next])];
}

function mergeShop(shops = [], shop = {}) {
  if (!shop.id) return shops;
  const shopId = String(shop.id);
  if (shops.some((entry) => String(entry.shopId) === shopId)) return shops;
  return [...shops, { shopId, name: shop.name || null }];
}

function upsertRiskFlag(flags = [], code, occurredAt) {
  if (!code) return flags;
  const existing = flags.find((flag) => flag.code === code);
  if (existing) {
    return flags.map((flag) => (
      flag.code === code
        ? { ...flag, count: (flag.count || 0) + 1, lastSeenAt: occurredAt }
        : flag
    ));
  }
  return [...flags, { code, count: 1, lastSeenAt: occurredAt }];
}

function deriveLifecycle(customer) {
  const hasIssue = (customer.riskFlags || []).some((flag) => (flag.count || 0) >= 2);
  if (hasIssue) return 'ISSUE_PRONE';
  if ((customer.riskFlags || []).length) return 'AT_RISK';
  if ((customer.totalRevenueAmount || 0) >= VIP_REVENUE_THRESHOLD || (customer.orderCount || 0) >= VIP_ORDER_THRESHOLD) return 'VIP';
  if ((customer.orderCount || 0) > 1) return 'RETURNING';
  return 'NEW';
}

function searchText(customer) {
  return [
    customer.identityKey,
    customer.name,
    customer.emailMasked,
    customer.phoneMasked,
    customer.externalBuyerId,
    ...(customer.projectedOrders || []).map((order) => order.externalOrderId),
  ].filter(Boolean).join(' ');
}

async function upsertFromOrderSnapshot(snapshot = {}) {
  const identityKey = deriveIdentityKey(snapshot);
  const orderId = norm(snapshot.orderId);
  const orderedAt = snapshot.orderedAt ? new Date(snapshot.orderedAt) : new Date();
  const buyer = snapshot.buyer || {};
  const pricing = snapshot.pricing || {};
  const shippingAddress = snapshot.shippingAddress || {};
  const existing = await repository.findByIdentityKey(identityKey);
  const isProjected = existing?.projectedOrders?.some((order) => String(order.orderId) === orderId);

  const base = existing || {
    identityKey,
    orderCount: 0,
    orderItemCount: 0,
    totalRevenueAmount: 0,
    totalCostAmount: 0,
    countries: [],
    shops: [],
    riskFlags: [],
    projectedOrders: [],
    status: 'ACTIVE',
    careStatus: 'NONE',
  };

  const next = {
    ...base,
    salesChannelCode: norm(snapshot.salesChannelCode)?.toUpperCase() || base.salesChannelCode,
    marketplaceCode: norm(snapshot.marketplaceCode)?.toUpperCase() || base.marketplaceCode,
    externalBuyerId: norm(buyer.externalBuyerId) || base.externalBuyerId,
    name: norm(buyer.name) || base.name,
    emailMasked: norm(buyer.emailMasked) || base.emailMasked,
    phoneMasked: norm(buyer.phoneMasked) || base.phoneMasked,
    currency: norm(pricing.currency)?.toUpperCase() || base.currency || 'USD',
    countries: mergeUnique(base.countries || [], norm(shippingAddress.countryCode) || norm(shippingAddress.country)),
    shops: mergeShop(base.shops || [], snapshot.shop || {}),
  };

  if (!isProjected && orderId) {
    next.firstOrderId = next.firstOrderId || orderId;
    next.firstOrderAt = next.firstOrderAt || orderedAt;
    next.lastOrderId = orderId;
    next.lastOrderAt = !next.lastOrderAt || orderedAt > new Date(next.lastOrderAt) ? orderedAt : next.lastOrderAt;
    next.orderCount = (next.orderCount || 0) + 1;
    next.orderItemCount = (next.orderItemCount || 0) + Number(snapshot.quantity || snapshot.itemCount || 0);
    next.totalRevenueAmount = (next.totalRevenueAmount || 0) + Number(pricing.customerPaidAmount || 0);
    next.totalCostAmount = (next.totalCostAmount || 0) + Number(pricing.totalCostAmount || 0);
    next.averageOrderValue = next.orderCount ? Math.round(next.totalRevenueAmount / next.orderCount) : 0;
    next.projectedOrders = [
      ...(next.projectedOrders || []),
      { orderId, externalOrderId: norm(snapshot.externalOrderId), orderedAt },
    ].slice(-100);
  }

  if (shippingAddress.addressValidationStatus && shippingAddress.addressValidationStatus !== 'VALID') {
    next.riskFlags = upsertRiskFlag(next.riskFlags || [], 'ADDRESS_ISSUE', orderedAt);
    next.lastIssueAt = orderedAt;
    if (next.careStatus === 'NONE') next.careStatus = 'NEEDS_FOLLOW_UP';
  }
  if (snapshot.caseStatus && snapshot.caseStatus !== 'CLOSED') {
    next.riskFlags = upsertRiskFlag(next.riskFlags || [], 'OPEN_CASE', orderedAt);
    next.lastIssueAt = orderedAt;
    if (next.careStatus === 'NONE') next.careStatus = 'NEEDS_FOLLOW_UP';
  }
  next.lifecycle = deriveLifecycle(next);
  next.searchText = searchText(next);

  const saved = existing ? await repository.saveCustomer(next) : await repository.createCustomer(next);
  if (!isProjected && orderId) {
    await repository.createEvent({
      customerId: saved._id,
      eventType: 'ORDER_CREATED',
      sourceModule: 'order',
      sourceId: orderId,
      message: `Order ${snapshot.externalOrderId || orderId} projected to customer`,
      occurredAt: orderedAt,
      metadata: { externalOrderId: snapshot.externalOrderId || null },
    });
  }
  return saved;
}

module.exports = {
  deriveIdentityKey,
  deriveLifecycle,
  upsertFromOrderSnapshot,
};
