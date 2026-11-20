const mongoose = require('mongoose');
const { addressValidationStatuses } = require('../constants/orderStatuses');

const addressValidationCacheSchema = new mongoose.Schema(
  {
    addressKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    rawAddress: {
      street: { type: String, trim: true, default: '' },
      city: { type: String, trim: true, default: '' },
      state: { type: String, trim: true, default: '' },
      postalCode: { type: String, trim: true, default: '' },
      countryCode: { type: String, trim: true, default: 'US' },
    },
    provider: {
      type: String,
      trim: true,
      default: 'smarty',
    },
    status: {
      type: String,
      required: true,
      trim: true,
      enum: Object.values(addressValidationStatuses),
    },
    reason: {
      type: String,
      trim: true,
      default: null,
    },
    normalizedAddress: {
      addressLine1: { type: String, trim: true, default: null },
      addressLine2: { type: String, trim: true, default: null },
      city: { type: String, trim: true, default: null },
      stateOrProvince: { type: String, trim: true, default: null },
      stateOrProvinceCode: { type: String, trim: true, default: null },
      postalCode: { type: String, trim: true, default: null },
      countryCode: { type: String, trim: true, default: 'US' },
    },
    analysis: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    candidates: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    hitCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastHitAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model('AddressValidationCache', addressValidationCacheSchema);
