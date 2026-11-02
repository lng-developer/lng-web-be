const AmazonTrackingSubmission = require('../models/amazonTrackingSubmission.model');
const { getPaginationOffset, toPaginatedResult } = require('../../../../shared/utils/pagination');

async function create(payload) {
  const doc = await AmazonTrackingSubmission.create(payload);
  return doc.toObject();
}

async function findById(id) {
  return AmazonTrackingSubmission.findById(id).lean();
}

async function findByCommandId(commandId) {
  return AmazonTrackingSubmission.findOne({ commandId }).lean();
}

async function updateById(id, patch) {
  return AmazonTrackingSubmission.findByIdAndUpdate(
    id,
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}

async function listSubmissions({ shopIds, page, limit }) {
  const filter = { ...(shopIds?.length ? { shopId: { $in: shopIds } } : {}) };
  const [items, total] = await Promise.all([
    AmazonTrackingSubmission.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .skip(getPaginationOffset({ page, limit }))
      .limit(limit)
      .lean(),
    AmazonTrackingSubmission.countDocuments(filter),
  ]);
  return toPaginatedResult({ items, total, page, limit });
}

module.exports = {
  create,
  findById,
  findByCommandId,
  updateById,
  listSubmissions,
};
