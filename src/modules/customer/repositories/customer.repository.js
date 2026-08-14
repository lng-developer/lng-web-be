const { getPaginationOffset, toPaginatedResult } = require('../../../shared/utils/pagination');
const Customer = require('../models/customer.model');
const CustomerEvent = require('../models/customerEvent.model');
const CustomerNote = require('../models/customerNote.model');

function compact(filter) {
  return Object.fromEntries(Object.entries(filter).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

function buildCustomerFilter(params = {}) {
  const filter = compact({
    lifecycle: params.lifecycle,
    careStatus: params.careStatus,
    status: params.status,
    salesChannelCode: params.salesChannelCode,
  });
  if (params.countryCode) filter.countries = params.countryCode;
  if (params.shopId) filter['shops.shopId'] = params.shopId;
  if (params.minOrderCount) filter.orderCount = { $gte: Number(params.minOrderCount) };
  if (params.minRevenue) filter.totalRevenueAmount = { $gte: Number(params.minRevenue) };
  if (params.orderedFrom || params.orderedTo) {
    filter.lastOrderAt = {};
    if (params.orderedFrom) filter.lastOrderAt.$gte = new Date(params.orderedFrom);
    if (params.orderedTo) filter.lastOrderAt.$lte = new Date(params.orderedTo);
  }
  if (params.search) {
    const regex = new RegExp(String(params.search).trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    filter.$or = [
      { name: regex },
      { emailMasked: regex },
      { phoneMasked: regex },
      { externalBuyerId: regex },
      { identityKey: regex },
      { 'projectedOrders.externalOrderId': regex },
    ];
  }
  return filter;
}

function sortFor(sort) {
  if (sort === 'revenueDesc') return { totalRevenueAmount: -1, _id: -1 };
  if (sort === 'orderCountDesc') return { orderCount: -1, _id: -1 };
  if (sort === 'firstOrderDesc') return { firstOrderAt: -1, _id: -1 };
  return { lastOrderAt: -1, _id: -1 };
}

async function findByIdentityKey(identityKey) {
  return Customer.findOne({ identityKey }).lean();
}

async function findById(id) {
  return Customer.findById(id).lean();
}

async function saveCustomer(customer) {
  return Customer.findByIdAndUpdate(customer._id, customer, { returnDocument: 'after' }).lean();
}

async function createCustomer(payload) {
  const created = await Customer.create(payload);
  return Customer.findById(created._id).lean();
}

async function listCustomers(params = {}) {
  const page = Number(params.page || 1);
  const limit = Number(params.limit || 20);
  const filter = buildCustomerFilter(params);
  const [items, total] = await Promise.all([
    Customer.find(filter)
      .sort(sortFor(params.sort))
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    Customer.countDocuments(filter),
  ]);
  return toPaginatedResult({ items, total, page, limit });
}

async function summarize(params = {}) {
  const filter = buildCustomerFilter(params);
  const [base, byCountry, byLifecycle] = await Promise.all([
    Customer.aggregate([
      { $match: filter },
      {
        $group: {
          _id: null,
          total: { $sum: 1 },
          newCount: { $sum: { $cond: [{ $eq: ['$lifecycle', 'NEW'] }, 1, 0] } },
          returningCount: { $sum: { $cond: [{ $eq: ['$lifecycle', 'RETURNING'] }, 1, 0] } },
          vipCount: { $sum: { $cond: [{ $eq: ['$lifecycle', 'VIP'] }, 1, 0] } },
          atRiskCount: { $sum: { $cond: [{ $eq: ['$lifecycle', 'AT_RISK'] }, 1, 0] } },
          issueProneCount: { $sum: { $cond: [{ $eq: ['$lifecycle', 'ISSUE_PRONE'] }, 1, 0] } },
          needsFollowUpCount: { $sum: { $cond: [{ $eq: ['$careStatus', 'NEEDS_FOLLOW_UP'] }, 1, 0] } },
          totalRevenueAmount: { $sum: '$totalRevenueAmount' },
          totalOrderCount: { $sum: '$orderCount' },
        },
      },
    ]),
    Customer.aggregate([
      { $match: filter },
      { $unwind: '$countries' },
      { $group: { _id: '$countries', count: { $sum: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 10 },
    ]),
    Customer.aggregate([
      { $match: filter },
      { $group: { _id: '$lifecycle', count: { $sum: 1 } } },
    ]),
  ]);
  return {
    ...(base[0] || {}),
    byCountry: byCountry.map((item) => ({ countryCode: item._id, count: item.count })),
    byLifecycle: Object.fromEntries(byLifecycle.map((item) => [item._id, item.count])),
  };
}

async function createEvent(payload) {
  const event = await CustomerEvent.create(payload);
  return CustomerEvent.findById(event._id).lean();
}

async function listEvents(customerId, { page = 1, limit = 50 } = {}) {
  const [items, total] = await Promise.all([
    CustomerEvent.find({ customerId })
      .sort({ occurredAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    CustomerEvent.countDocuments({ customerId }),
  ]);
  return toPaginatedResult({ items, total, page, limit });
}

async function createNote(payload) {
  const note = await CustomerNote.create(payload);
  return CustomerNote.findById(note._id).lean();
}

async function listNotes(customerId, { limit = 20 } = {}) {
  return CustomerNote.find({ customerId }).sort({ createdAt: -1, _id: -1 }).limit(limit).lean();
}

module.exports = {
  createCustomer,
  createEvent,
  createNote,
  findById,
  findByIdentityKey,
  listCustomers,
  listEvents,
  listNotes,
  saveCustomer,
  summarize,
};
