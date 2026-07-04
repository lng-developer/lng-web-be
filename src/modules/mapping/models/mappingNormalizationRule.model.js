const mongoose = require('mongoose');
const {
  matchTargets,
  matchTypes,
  recordStatuses,
  semanticRoles,
} = require('../constants/mappingRule.constants');

const mappingNormalizationRuleSchema = new mongoose.Schema(
  {
    shopId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    salesChannelCode: { type: String, default: null, uppercase: true, trim: true, index: true },
    marketplaceCode: { type: String, default: null, uppercase: true, trim: true, index: true },
    productTypeGroupId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    semanticRole: {
      type: String,
      enum: Object.values(semanticRoles),
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    matchTarget: {
      type: String,
      enum: Object.values(matchTargets),
      required: true,
      uppercase: true,
      trim: true,
    },
    matchType: {
      type: String,
      enum: Object.values(matchTypes),
      required: true,
      uppercase: true,
      trim: true,
    },
    matchValue: { type: String, required: true, trim: true, maxlength: 200 },
    normalizedValue: { type: String, default: null, trim: true },
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

mappingNormalizationRuleSchema.index({
  shopId: 1,
  salesChannelCode: 1,
  marketplaceCode: 1,
  productTypeGroupId: 1,
  status: 1,
  priority: 1,
});

module.exports = mongoose.model('MappingNormalizationRule', mappingNormalizationRuleSchema);
