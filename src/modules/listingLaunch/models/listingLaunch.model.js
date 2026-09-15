const mongoose = require('mongoose');
const { states, salesChannelCode } = require('../constants/listingLaunch.constants');

const { ObjectId } = mongoose.Schema.Types;
const schema = new mongoose.Schema({
  shopId: { type: ObjectId, required: true, immutable: true },
  salesChannelCode: { type: String, required: true, enum: [salesChannelCode], immutable: true },
  marketplaceCode: { type: String, required: true, trim: true, uppercase: true, maxlength: 80, immutable: true },
  brief: { type: String, required: true, trim: true, maxlength: 5000 },
  workingTitle: { type: String, trim: true, maxlength: 500, default: null },
  productTypeGroupId: { type: ObjectId, default: null },
  internalTemplateId: { type: ObjectId, default: null },
  referenceAssetIds: { type: [ObjectId], default: [], validate: (ids) => ids.length <= 50 && new Set(ids.map(String)).size === ids.length },
  state: { type: String, enum: Object.values(states), default: states.BRIEF, required: true },
  selectedBy: { type: ObjectId, default: null },
  selectedAt: { type: Date, default: null },
  createdBy: { type: ObjectId, default: null, immutable: true },
}, { timestamps: true });

schema.index({ shopId: 1, state: 1, updatedAt: -1, _id: -1 });
schema.index({ shopId: 1, updatedAt: -1, _id: -1 });

module.exports = mongoose.model('ListingLaunch', schema);
