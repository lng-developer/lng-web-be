const mongoose = require('mongoose');
const { activeDesignRequestStatuses, designRequestStatuses, designRequestTypes } = require('../constants/design.constants');

const { Schema } = mongoose;
const listingSnapshotSchema = new Schema({
  sku: { type: String, default: null },
  title: { type: String, default: null },
  listingId: { type: String, default: null },
  listingVariantId: { type: String, default: null },
}, { _id: false });
const schema = new Schema({
  orderId: { type: Schema.Types.ObjectId, required: true, index: true },
  orderItemId: { type: Schema.Types.ObjectId, required: true, index: true },
  shopId: { type: Schema.Types.ObjectId, required: true, index: true },
  requestType: { type: String, enum: Object.values(designRequestTypes), required: true },
  status: { type: String, enum: Object.values(designRequestStatuses), default: designRequestStatuses.PENDING_ASSIGNMENT, index: true },
  requestedByAccountId: { type: Schema.Types.ObjectId, required: true },
  assignedDesignerAccountId: { type: Schema.Types.ObjectId, default: null, index: true },
  note: { type: String, trim: true, default: null },
  listingSnapshot: { type: listingSnapshotSchema, default: null },
}, { timestamps: true });
schema.index({ orderItemId: 1, requestType: 1 }, { unique: true, partialFilterExpression: { status: { $in: activeDesignRequestStatuses } } });
schema.index({ assignedDesignerAccountId: 1, status: 1, updatedAt: -1 });
module.exports = mongoose.model('DesignRequest', schema);
