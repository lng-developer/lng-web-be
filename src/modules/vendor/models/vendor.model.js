const mongoose = require('mongoose');
const { recordStatuses, vendorFulfillmentTypes, vendorProviderKeys } = require('../constants/vendor.constants');

const vendorSchema = new mongoose.Schema(
  {
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      immutable: true,
      unique: true,
      index: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    providerKey: {
      type: String,
      uppercase: true,
      trim: true,
      enum: Object.values(vendorProviderKeys),
      default: null,
      index: true,
    },
    fulfillmentType: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
      enum: Object.values(vendorFulfillmentTypes),
      index: true,
    },
    status: {
      type: String,
      enum: Object.values(recordStatuses),
      default: recordStatuses.ACTIVE,
      index: true,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  { timestamps: true },
);

vendorSchema.index({ providerKey: 1, status: 1 });
vendorSchema.index({ fulfillmentType: 1, status: 1 });
vendorSchema.index({ status: 1, code: 1 });

module.exports = mongoose.model('Vendor', vendorSchema);
