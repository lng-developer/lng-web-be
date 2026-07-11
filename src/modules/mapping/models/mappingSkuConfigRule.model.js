const mongoose = require('mongoose');
const { recordStatuses } = require('../constants/mappingRule.constants');

function cleanStringArray(values) {
  return (values || []).map((value) => String(value || '').trim()).filter(Boolean);
}

const mappingSkuConfigRuleSchema = new mongoose.Schema(
  {
    shopId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
    salesChannelCode: { type: String, default: null, uppercase: true, trim: true, index: true },
    marketplaceCode: { type: String, default: null, uppercase: true, trim: true, index: true },
    configCode: { type: String, required: true, uppercase: true, trim: true, index: true },
    productTypeAliases: {
      type: [String],
      default: () => [],
      set: (values) => (values || []).map((value) => String(value || '').trim().toUpperCase()).filter(Boolean),
    },
    platformProductType: { type: String, default: null, uppercase: true, trim: true, index: true },
    countryCode: { type: String, default: null, uppercase: true, trim: true, index: true },
    combinationProductTypeKey: { type: String, default: null, trim: true },
    sizeKeys: { type: [String], default: () => [], set: cleanStringArray },
    colorKeys: { type: [String], default: () => [], set: cleanStringArray },
    productTypeKeys: { type: [String], default: () => [], set: cleanStringArray },
    productTypeColorKeys: { type: [String], default: () => [], set: cleanStringArray },
    productTypeSizeKeys: { type: [String], default: () => [], set: cleanStringArray },
    combinationKeys: { type: [String], default: () => [], set: cleanStringArray },
    attributeKeyMap: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    defaultColor: { type: String, default: null, uppercase: true, trim: true },
    isSet: { type: Boolean, default: false },
    isPack: { type: Boolean, default: false },
    sizePosition: { type: Number, min: 0, default: 0 },
    colorPosition: { type: Number, min: 0, default: 0 },
    productTypeGroupId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    internalTemplateId: { type: mongoose.Schema.Types.ObjectId, default: null, index: true },
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

mappingSkuConfigRuleSchema.index({
  shopId: 1,
  salesChannelCode: 1,
  marketplaceCode: 1,
  configCode: 1,
  productTypeGroupId: 1,
  countryCode: 1,
}, { unique: true });

module.exports = mongoose.model('MappingSkuConfigRule', mappingSkuConfigRuleSchema);
