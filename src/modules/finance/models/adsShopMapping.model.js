const mongoose = require('mongoose');

const adsShopMappingSchema = new mongoose.Schema({
  advertiserAccountId: { type: String, required: true, trim: true, index: true },
  matchType: { type: String, enum: ['CAMPAIGN', 'PORTFOLIO'], required: true },
  externalId: { type: String, required: true, trim: true },
  shopId: { type: mongoose.Schema.Types.ObjectId, ref: 'Shop', required: true, index: true },
  salesChannelCode: { type: String, required: true, uppercase: true, trim: true, index: true },
  marketplaceCode: { type: String, required: true, uppercase: true, trim: true, index: true },
  active: { type: Boolean, default: true, index: true },
}, { timestamps: true });

adsShopMappingSchema.index(
  { advertiserAccountId: 1, matchType: 1, externalId: 1, salesChannelCode: 1, marketplaceCode: 1 },
  { unique: true },
);

module.exports = mongoose.model('AdsShopMapping', adsShopMappingSchema);
