const mongoose = require('mongoose');
const {
  listingQcStatuses,
  recordStatuses,
  salesChannelCodes,
} = require('../constants/catalog.constants');

const listingSchema = new mongoose.Schema(
  {
    shopId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Shop',
      required: true,
    },
    salesChannelCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      enum: Object.values(salesChannelCodes),
      index: true,
    },
    marketplaceCode: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    sku: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      index: true,
    },
    asin: {
      type: String,
      uppercase: true,
      trim: true,
      default: null,
      index: true,
    },
    etsyListingId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    productImageUrl: {
      type: String,
      trim: true,
      default: null,
    },
    defaultPsdTemplateAssetId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'MediaAsset',
      default: null,
      index: true,
    },
    baseCostAmount: {
      type: Number,
      min: 0,
      default: 0,
      validate: {
        validator: Number.isInteger,
        message: 'baseCostAmount must be an integer minor unit value',
      },
    },
    currency: {
      type: String,
      uppercase: true,
      trim: true,
      minlength: 3,
      maxlength: 3,
      default: 'USD',
    },
    status: {
      type: String,
      enum: Object.values(recordStatuses),
      default: recordStatuses.ACTIVE,
      index: true,
    },
    qcStatus: {
      type: String,
      enum: Object.values(listingQcStatuses),
      default: listingQcStatuses.DRAFT,
      index: true,
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    approvedAt: {
      type: Date,
      default: null,
    },
    rejectedBy: {
      type: mongoose.Schema.Types.ObjectId,
      default: null,
    },
    rejectedAt: {
      type: Date,
      default: null,
    },
    rejectionReason: {
      type: String,
      trim: true,
      default: null,
    },
  },
  { timestamps: true },
);

listingSchema.index({ shopId: 1, salesChannelCode: 1, marketplaceCode: 1, sku: 1 });
listingSchema.index(
  { salesChannelCode: 1, marketplaceCode: 1, asin: 1 },
  {
    unique: true,
    partialFilterExpression: {
      salesChannelCode: salesChannelCodes.AMAZON,
      asin: { $type: 'string', $ne: '' },
    },
  },
);
listingSchema.index({ shopId: 1, status: 1, sku: 1 });
listingSchema.index({ createdAt: -1, _id: -1 });
listingSchema.index({ shopId: 1, createdAt: -1, _id: -1 });
listingSchema.index(
  { salesChannelCode: 1, marketplaceCode: 1, etsyListingId: 1 },
  {
    unique: true,
    partialFilterExpression: {
      salesChannelCode: salesChannelCodes.ETSY,
      etsyListingId: { $type: 'string', $ne: '' },
    },
  },
);

module.exports = mongoose.model('Listing', listingSchema);
