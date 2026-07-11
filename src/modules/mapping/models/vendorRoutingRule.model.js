const mongoose = require('mongoose');
const { recordStatuses } = require('../constants/mappingRule.constants');

const vendorRoutingRuleSchema = new mongoose.Schema(
  {
    shopId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    salesChannelCode: { type: String, default: null, uppercase: true, trim: true, index: true },
    marketplaceCode: { type: String, default: null, uppercase: true, trim: true, index: true },
    productTypeGroupId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    vendorId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    asin: { type: String, default: null, uppercase: true, trim: true, index: true },
    configCode: { type: String, default: null, uppercase: true, trim: true, index: true },
    normalizedSize: { type: String, default: null, uppercase: true, trim: true, index: true },
    normalizedColor: { type: String, default: null, uppercase: true, trim: true, index: true },
    priority: { type: Number, default: 100, min: 0 },
    status: {
      type: String,
      enum: Object.values(recordStatuses),
      default: recordStatuses.ACTIVE,
      uppercase: true,
      trim: true,
      index: true,
    },
  },
  { timestamps: true },
);

vendorRoutingRuleSchema.index({
  shopId: 1,
  salesChannelCode: 1,
  marketplaceCode: 1,
  productTypeGroupId: 1,
  status: 1,
  priority: 1,
});

module.exports = mongoose.model('VendorRoutingRule', vendorRoutingRuleSchema);
