const DesignRequest = require('../models/designRequest.model');
const { activeDesignRequestStatuses } = require('../constants/design.constants');

async function findActiveByOrderItemAndType(orderItemId, requestType) {
  return DesignRequest.findOne({ orderItemId, requestType, status: { $in: activeDesignRequestStatuses } }).lean();
}
async function create(payload) {
  return (await DesignRequest.create(payload)).toObject();
}
async function findById(id) {
  return DesignRequest.findById(id).lean();
}
async function list(query = {}) {
  return DesignRequest.find(query).sort({ updatedAt: -1, _id: -1 }).lean();
}
async function update(id, patch) {
  return DesignRequest.findByIdAndUpdate(
    id,
    { $set: patch },
    { returnDocument: 'after', runValidators: true },
  ).lean();
}
module.exports = { findActiveByOrderItemAndType, create, findById, list, update };
