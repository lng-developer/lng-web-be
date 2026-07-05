const mongoose = require('mongoose');
const {
  recordStatuses,
  skuNormalizeOutputActions,
  skuNormalizePatternTypes,
  skuNormalizeSegmentRoles,
} = require('../constants/mappingRule.constants');

const mappingSkuNormalizeRuleSchema = new mongoose.Schema(
  {
    shopId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    salesChannelCode: { type: String, default: null, uppercase: true, trim: true, index: true },
    marketplaceCode: { type: String, default: null, uppercase: true, trim: true, index: true },
    configCode: { type: String, default: null, uppercase: true, trim: true, index: true },
    patternType: {
      type: String,
      enum: Object.values(skuNormalizePatternTypes),
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    segmentIndex: { type: Number, required: true, min: 0 },
    segmentRole: {
      type: String,
      enum: Object.values(skuNormalizeSegmentRoles),
      required: true,
      uppercase: true,
      trim: true,
    },
    appliesWhenValues: {
      type: [String],
      required: true,
      set: (values) => (values || []).map((value) => String(value || '').trim().toUpperCase()).filter(Boolean),
      validate: {
        validator: (values) => Array.isArray(values) && values.length > 0,
        message: 'appliesWhenValues must not be empty',
      },
    },
    outputAction: {
      type: String,
      enum: Object.values(skuNormalizeOutputActions),
      required: true,
      uppercase: true,
      trim: true,
    },
    replacementValue: {
      type: String,
      default: null,
      uppercase: true,
      trim: true,
    },
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

mappingSkuNormalizeRuleSchema.index({
  shopId: 1,
  salesChannelCode: 1,
  marketplaceCode: 1,
  configCode: 1,
  status: 1,
  priority: 1,
});

module.exports = mongoose.model('MappingSkuNormalizeRule', mappingSkuNormalizeRuleSchema);
