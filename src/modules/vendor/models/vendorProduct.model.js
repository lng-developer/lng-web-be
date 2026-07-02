const mongoose = require('mongoose');
const { recordStatuses } = require('../constants/vendor.constants');

function nonNegativeInteger(pathName) {
  return {
    type: Number,
    min: 0,
    default: null,
    validate: {
      validator: (value) => value === null || value === undefined || Number.isInteger(value),
      message: `${pathName} must be an integer value`,
    },
  };
}

const vendorProductSchema = new mongoose.Schema(
  {
    vendorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Vendor',
      required: true,
      index: true,
    },
    productTypeGroupId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ProductTypeGroup',
      required: true,
      index: true,
    },
    code: {
      type: String,
      required: true,
      uppercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    externalProductId: {
      type: String,
      trim: true,
      default: null,
      index: true,
    },
    imageUrl: {
      type: String,
      trim: true,
      default: null,
    },
    productUrl: {
      type: String,
      trim: true,
      default: null,
    },
    designTemplateUrl: {
      type: String,
      trim: true,
      default: null,
    },
    minProductionDays: nonNegativeInteger('minProductionDays'),
    maxProductionDays: nonNegativeInteger('maxProductionDays'),
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
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: () => ({}),
    },
  },
  { timestamps: true },
);

vendorProductSchema.index({ vendorId: 1, code: 1 }, { unique: true });
vendorProductSchema.index({ productTypeGroupId: 1, status: 1 });
vendorProductSchema.index({ vendorId: 1, status: 1 });

module.exports = mongoose.model('VendorProduct', vendorProductSchema);
